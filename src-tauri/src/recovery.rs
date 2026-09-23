//! Crash-recovery snapshots (plan §7.10, AD-21).
//!
//! The promise: a power cut, a `kill -9`, a Windows logoff or a WebKit crash costs
//! at most the last 30 seconds of typing. The webview sends every dirty document
//! whose version changed, and Rust writes it to `<data>/recovery/<session>/` as an
//! atomic `<key>.txt` / `<key>.json` pair — the text as raw bytes, the metadata
//! beside it. Nothing here ever touches the user's own file.
//!
//! **Why the pair is written text first.** Both halves go through
//! [`crate::atomic::write_atomic`], so each one is either the old file or the new
//! one and never half of either. The pair as a whole is not atomic, and the order
//! decides what a process killed between the two writes leaves behind: the *new*
//! text beside the *previous* metadata. That still restores, and it errs the safe
//! way — the metadata's `savedAt` and disk stamp are then older than the text, so
//! the external-change check of AD-21 shows its banner rather than letting a
//! restore overwrite a file that changed meanwhile. The other order would claim a
//! newer stamp for older text, which is the one combination that could lose work on
//! disk. `the_pair_is_written_in_the_order_that_survives_a_kill` pins it.
//!
//! On a document's **first** snapshot there is no previous sidecar, so the same kill
//! leaves a `.txt` with nothing beside it. That is still the user's only copy of that
//! work, so [`entries_in`] walks the text files and offers such a snapshot with
//! [`orphan_meta`] — untitled, unbound, no disk stamp. It used to be skipped, which
//! meant the restore dialog said there was nothing to recover and the 14-day prune
//! deleted it in silence (G8 M7).
//!
//! **Liveness, not a lock file.** At start Rust creates a session folder and a thread
//! touches `<session>/alive` every [`HEARTBEAT_SECS`] seconds. A session whose
//! `alive` is older than [`STALE_AFTER_SECS`] is a *leftover*; a fresh one belongs to
//! a gEdit that is still running. That is why a second window never offers the first
//! one's documents as a crash, and why no single-instance plugin is needed. The cost
//! is a blind window: for up to [`STALE_AFTER_SECS`] after a crash the snapshots are
//! on disk but not yet offered, so a restart within two minutes sees no dialog until
//! [`recovery_list`] is asked again. It is a timestamp and nothing else — a crashed
//! process cannot be distinguished from a slow one by looking at its files.
//!
//! **Clearing.** An entry is dropped on save, on close and on discard. The current
//! session is cleared from `files.onWillQuit`, *after* the user's quit decision, and
//! never from `RunEvent::Exit` — a Windows logoff also ends in `Exit`, and clearing
//! there would throw away the snapshots of the session the logoff is killing (F29).
//! `the_exit_path_never_clears_the_snapshots` reads `lib.rs` and fails if that ever
//! changes.
//!
//! **The boundary.** `recovery_put` is the one command that takes a raw body, so the
//! whole of a 10 MB program does not have to be JSON-escaped through the IPC
//! argument path (F30). Everything that arrives with it is bounded *before* anything
//! is allocated or written: [`MAX_HEADER_BYTES`] for the metadata, [`MAX_BODY_BYTES`]
//! for the text, and [`valid_key`] for the file name, which is what keeps a `..` or a
//! separator from turning a key into a path. Every function that turns a session or a
//! key into a path validates it again, so the command's check is a first line of
//! defence and not the only one.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde_json::{Map, Value};
use tauri::ipc::InvokeBody;
use tauri::AppHandle;

use crate::atomic::write_atomic;
use crate::paths;

/// The header `recovery_put` reads its metadata from. A header rather than an
/// argument because the body is raw bytes, and a raw-body invoke has no other place
/// to put a second value.
pub const RECOVERY_HEADER: &str = "x-gedit-recovery";

/// The largest snapshot text accepted, in bytes. Matches the runner's stdout cap and
/// sits above `MAX_OPEN_BYTES` (50 MB) so any document that could be opened can also
/// be snapshotted.
pub const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

/// The largest metadata header accepted, in bytes. The metadata is a handful of
/// scalars plus one path; 8 KiB is room to spare and small enough that a malformed
/// header is rejected before it is parsed.
pub const MAX_HEADER_BYTES: usize = 8 * 1024;

/// The longest a key (and a session id) may be. Both become file or folder names.
pub const MAX_KEY_LENGTH: usize = 64;

/// `<session>/alive`, touched by the heartbeat thread.
pub const ALIVE_FILE_NAME: &str = "alive";

/// How often the heartbeat touches `alive`.
pub const HEARTBEAT_SECS: u64 = 30;

/// How stale `alive` has to be before the session counts as a leftover. Four missed
/// heartbeats: a machine that swapped hard, or a laptop that slept, must not make a
/// running gEdit look like a crashed one.
pub const STALE_AFTER_SECS: u64 = 120;

/// Leftover sessions older than this are pruned at start (AD-21).
pub const PRUNE_AFTER_DAYS: u64 = 14;

/// The whole recovery folder is capped; oldest sessions go first.
pub const MAX_TOTAL_BYTES: u64 = 200 * 1024 * 1024;

/// The snapshot text. Plain `.txt` on purpose: when gEdit is the thing that broke,
/// the user opening `<data>/recovery/` by hand must be able to read their program in
/// anything, without gEdit and without a converter.
const TEXT_EXT: &str = "txt";

/// The metadata that sits beside it.
const META_EXT: &str = "json";

/// Whether `key` may become a file name under a session folder: `^[a-z0-9-]{1,64}$`,
/// and not one of DOS's device names.
///
/// This is the only thing between a webview-supplied string and the file system, so
/// it is an allow-list and not a deny-list: `..`, `/`, `\`, a drive letter, a NUL, a
/// leading dot and every Unicode look-alike of a separator all fail it by not being
/// in the alphabet. Session ids are checked with the same rule, because a session id
/// from `recovery_read`, `recovery_discard` or a hand-edited folder name is a path
/// component in exactly the same way.
///
/// The alphabet alone is not enough on Windows (M8): `con`, `nul`, `aux`, `com1` and
/// `lpt1` are all spelled with it, and each of them names a device rather than a file
/// however it is extended — `nul.txt` and `nul.json` are the bit bucket. A snapshot
/// filed under one would be written to nothing and read back as nothing, which is the
/// one failure a crash-recovery folder may not have. No key the webview builds today
/// is one of them, so this closes a hole rather than fixing a symptom.
pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_KEY_LENGTH
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !crate::paths::is_device_name(key)
}

/// The ages and the size the folder is kept to, in one value so that a test can
/// shrink them instead of sleeping for two minutes or writing 200 MB. Everything
/// outside the tests uses [`Limits::default`], which is the plan's numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Silence longer than this makes a session a leftover.
    pub stale_after: Duration,
    /// A leftover nobody came back for in this long is deleted.
    pub max_age: Duration,
    /// The whole recovery folder, all sessions together.
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            stale_after: Duration::from_secs(STALE_AFTER_SECS),
            max_age: Duration::from_secs(PRUNE_AFTER_DAYS * 24 * 60 * 60),
            max_total_bytes: MAX_TOTAL_BYTES,
        }
    }
}

/// One leftover snapshot, as the restore dialog reads it. Serialized in camelCase,
/// matching `RecoveryEntry` in `src/lib/app/types.ts`.
///
/// `meta` is the header the webview wrote, kept **verbatim** and flattened into the
/// same object: Rust never interprets the document's encoding, EOL, NUL info, disk
/// stamp, profile or machine, so a member a later milestone adds (M10's `channelId`)
/// comes back from an older snapshot untouched instead of being dropped by a struct
/// that had not heard of it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    /// The folder the snapshot sits in; `recovery_read` and `recovery_discard` take it.
    pub session: String,
    pub key: String,
    /// Size of the `.txt` file, for the dialog's "how much would be restored".
    pub bytes: u64,
    #[serde(flatten)]
    pub meta: Map<String, Value>,
}

/// One snapshot as it arrived: the file name it goes under, the metadata to write
/// beside it, and the text itself.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub key: String,
    /// The header verbatim, `key` included, so the sidecar is exactly what the
    /// webview sent and a member this build does not know survives.
    pub meta: Map<String, Value>,
    pub text: String,
}

/// Everything `recovery_put` has to decide before it writes anything, split out so
/// the whole boundary can be tested without an app handle or a webview.
///
/// The order is the point: the header is length-checked before it is parsed, the key
/// is validated before it can become a file name, and the body is length-checked
/// before it is turned into a `String`. A caller that gets a `Snapshot` back has a
/// key that cannot leave the session folder and a text that fits the cap.
pub fn parse_snapshot(header: Option<&str>, body: &InvokeBody) -> Result<Snapshot, String> {
    let header = header.ok_or_else(|| format!("recovery: no {RECOVERY_HEADER} header"))?;
    if header.len() > MAX_HEADER_BYTES {
        return Err(format!(
            "recovery: the {RECOVERY_HEADER} header is larger than {MAX_HEADER_BYTES} bytes"
        ));
    }
    let meta: Map<String, Value> = match serde_json::from_str::<Value>(header) {
        Ok(Value::Object(object)) => object,
        Ok(_) => return Err("recovery: the metadata is not a JSON object".to_owned()),
        Err(err) => return Err(format!("recovery: the metadata is not JSON ({err})")),
    };
    let key = match meta.get("key").and_then(Value::as_str) {
        Some(key) if valid_key(key) => key.to_owned(),
        Some(key) => return Err(format!("recovery: {key} is not a usable key")),
        None => return Err("recovery: the metadata has no key".to_owned()),
    };
    let InvokeBody::Raw(bytes) = body else {
        return Err("recovery: the snapshot text must be a raw body".to_owned());
    };
    if bytes.len() > MAX_BODY_BYTES {
        return Err(format!(
            "recovery: the snapshot is larger than {MAX_BODY_BYTES} bytes"
        ));
    }
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| "recovery: the snapshot text is not UTF-8".to_owned())?;
    Ok(Snapshot { key, meta, text })
}

// --- this run's session -----------------------------------------------------

/// The folder name this process writes its snapshots to, set once by
/// [`start_session`]. A process global rather than managed state because the
/// heartbeat thread and every command need the same answer, and because a run
/// without one (no data directory) has to be able to say so.
static CURRENT_SESSION: Mutex<Option<String>> = Mutex::new(None);

/// The lock, never poisoned away: a thread that panicked while holding it would
/// otherwise take the session id with it and every later snapshot would be refused.
fn current() -> std::sync::MutexGuard<'static, Option<String>> {
    CURRENT_SESSION
        .lock()
        .unwrap_or_else(|err| err.into_inner())
}

/// This run's session folder name, or `None` when [`start_session`] could not make
/// one (no data directory, a read-only home). Snapshots are then refused rather than
/// written somewhere else.
pub fn current_session() -> Option<String> {
    current().clone()
}

/// `s-<epoch millis>-<pid>`: digits and dashes only, so it passes [`valid_key`], and
/// sortable by name for free. No date formatting, because the name is a folder key
/// and not something the user reads.
fn new_session_id(now: SystemTime) -> String {
    let millis = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or(0);
    format!("s-{millis}-{}", std::process::id())
}

/// Creates a folder no other run is using and answers with its name and path.
/// `create_dir` rather than `create_dir_all` on the session itself: "it already
/// exists" has to be a collision to retry, not a success that would let two runs
/// write over each other's snapshots.
fn create_session(root: &Path, now: SystemTime) -> io::Result<(String, PathBuf)> {
    fs::create_dir_all(root)?;
    let _ = paths::restrict(root);
    let base = new_session_id(now);
    for attempt in 0..100 {
        let id = if attempt == 0 {
            base.clone()
        } else {
            format!("{base}-{attempt}")
        };
        if !valid_key(&id) {
            break;
        }
        let dir = root.join(&id);
        match fs::create_dir(&dir) {
            Ok(()) => {
                let _ = paths::restrict(&dir);
                return Ok((id, dir));
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no free session folder",
    ))
}

/// Says "this gEdit is still running" by rewriting `<session>/alive`. Only the file's
/// timestamp is read back; the content is deliberately empty, so that nothing can
/// come to depend on a value a killed process may have written half of.
///
/// Re-creates the folder when it has gone: a user who cleared `<data>/recovery` by
/// hand while gEdit runs should get snapshots again, not silence until the restart.
fn touch_alive(dir: &Path) -> io::Result<()> {
    if !dir.is_dir() {
        fs::create_dir_all(dir)?;
        let _ = paths::restrict(dir);
    }
    fs::write(dir.join(ALIVE_FILE_NAME), b"")
}

/// One session folder on disk, as the list and the prune see it.
#[derive(Debug, Clone)]
struct Session {
    id: String,
    dir: PathBuf,
    /// When its owner last said it was alive.
    alive: SystemTime,
}

impl Session {
    /// How long this session has said nothing. A timestamp in the future — a home
    /// directory restored from a machine whose clock was ahead — counts as "just
    /// now", so clock skew can never make a *running* gEdit look crashed. The price
    /// is that such a folder is never pruned either, which costs disk and no work.
    fn quiet_for(&self, now: SystemTime) -> Duration {
        now.duration_since(self.alive).unwrap_or(Duration::ZERO)
    }

    fn is_leftover(&self, limits: Limits, now: SystemTime) -> bool {
        self.quiet_for(now) > limits.stale_after
    }
}

/// When a session last reported in: its `alive` file, or the folder itself while that
/// file has not been written yet (the few milliseconds between `create_dir` and the
/// first touch, in which another gEdit must not mistake it for a leftover).
/// Unreadable either way means "very old", which makes it a leftover and prunable —
/// a folder whose metadata cannot be read holds nothing anyone can restore.
fn alive_time(dir: &Path) -> SystemTime {
    fs::metadata(dir.join(ALIVE_FILE_NAME))
        .or_else(|_| fs::metadata(dir))
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

/// Every session folder under `root`. A name that is not a [`valid_key`] is not one
/// of ours and is left alone — the folder belongs to the user, and gEdit deletes only
/// what it wrote. `file_type` does not follow symlinks, so a link planted in the
/// recovery folder is never walked into and never removed.
fn sessions_in(root: &Path) -> Vec<Session> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut sessions = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let Some(id) = name.to_str().filter(|id| valid_key(id)) else {
            continue;
        };
        let dir = entry.path();
        sessions.push(Session {
            id: id.to_owned(),
            alive: alive_time(&dir),
            dir,
        });
    }
    sessions
}

/// `<root>/<session>`, with the same name check the commands do. Every path in this
/// module is built through here, so no caller can hand a `..` to the file system by
/// forgetting one line.
fn session_dir(root: &Path, session: &str) -> Result<PathBuf, String> {
    if !valid_key(session) {
        return Err(format!("recovery: {session} is not a usable session"));
    }
    Ok(root.join(session))
}

/// `<root>/<session>/<key>.<ext>`, both names checked.
fn snapshot_file(root: &Path, session: &str, key: &str, ext: &str) -> Result<PathBuf, String> {
    if !valid_key(key) {
        return Err(format!("recovery: {key} is not a usable key"));
    }
    Ok(session_dir(root, session)?.join(format!("{key}.{ext}")))
}

/// The metadata beside one snapshot, or `None` when there is none to read: a sidecar
/// that is not there, one too large to be one of ours, unreadable, or not a JSON
/// object. A broken sidecar is never deleted, and the snapshot is still listed — with
/// [`orphan_meta`] in place of what it should have said, because the text next to it
/// is the user's unsaved work whatever its label says.
fn read_meta(path: &Path) -> Option<Map<String, Value>> {
    let len = fs::metadata(path).ok()?.len();
    if len > MAX_HEADER_BYTES as u64 {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let Ok(Value::Object(mut meta)) = serde_json::from_str::<Value>(&text) else {
        return None;
    };
    // The folder and the file name are the truth about which snapshot this is. A
    // stored copy of either would win over the struct's own fields once `meta` is
    // flattened into the same object, so a hand-edited sidecar could otherwise make
    // the dialog ask for a snapshot that is not the one it is showing.
    for owned in ["session", "key", "bytes"] {
        meta.remove(owned);
    }
    Some(meta)
}

/// When the webview took this snapshot, for the "newest first" order. Missing or
/// unreadable sorts last rather than failing the listing: an entry with a broken
/// `savedAt` is still a document someone may want back.
fn saved_at(meta: &Map<String, Value>) -> i64 {
    meta.get("savedAt")
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_f64().map(|millis| millis as i64))
        })
        .unwrap_or(0)
}

/// What an entry says about itself when its sidecar is not there, or cannot be read.
///
/// **The text is the only copy of that work, so it is offered whatever the metadata
/// says.** The listing used to walk the `.json` files and skip anything without one,
/// which meant a crash in the gap between [`put_in`]'s two writes hid the snapshot for
/// good: the restore dialog said there was nothing to recover, `is_spent` kept the
/// folder (correctly) but nothing ever surfaced it, and the 14-day prune then deleted
/// the only copy. The gap is not exotic — it is every document's **first** snapshot,
/// so every dirty document in the first thirty seconds after it is touched, and
/// `put_in`'s own comment already said the text is left "for the user to find" (G8 M7).
///
/// Everything here is the answer "gEdit does not know": no path (so a restore reopens
/// it untitled and only Save As can reach the disk), no disk stamp, no title, and a
/// profile id the webview will replace with the default. `metaLost` is what the
/// restore dialog reads to say so in the row instead of claiming the document was
/// never saved to a file (§7.9; the one member this build adds to `RecoveryEntry`).
fn orphan_meta() -> Map<String, Value> {
    let mut meta = Map::new();
    meta.insert("metaLost".to_owned(), Value::Bool(true));
    meta.insert("path".to_owned(), Value::Null);
    meta.insert("title".to_owned(), Value::String(String::new()));
    meta.insert("profileId".to_owned(), Value::String(String::new()));
    meta.insert(
        "encoding".to_owned(),
        serde_json::json!({ "encoding": "utf-8", "hasBom": false }),
    );
    meta.insert("eol".to_owned(), Value::String("crlf".to_owned()));
    meta.insert(
        "nul".to_owned(),
        serde_json::json!({ "leader": 0, "trailer": 0, "stripped": 0 }),
    );
    meta.insert("diskStamp".to_owned(), Value::Null);
    meta.insert("savedAt".to_owned(), Value::Number(0.into()));
    meta
}

/// Every restorable snapshot in one session folder.
///
/// The `.txt` files are what is walked, because the text is what there is to restore:
/// a `.json` without one is nothing (the entry would offer an empty document), while a
/// `.txt` without one is unsaved work that has lost its label — see [`orphan_meta`].
fn entries_in(dir: &Path, session: &str) -> Vec<RecoveryEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let text = entry.path();
        if text.extension().and_then(|ext| ext.to_str()) != Some(TEXT_EXT) {
            continue;
        }
        let Some(key) = text
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|key| valid_key(key))
        else {
            continue;
        };
        // `symlink_metadata`: a link planted in the folder is not a snapshot, and
        // `read_in` refuses one for the same reason.
        let Ok(stat) = fs::symlink_metadata(&text) else {
            continue;
        };
        if !stat.is_file() {
            continue;
        }
        let meta = read_meta(&dir.join(format!("{key}.{META_EXT}"))).unwrap_or_else(orphan_meta);
        out.push(RecoveryEntry {
            session: session.to_owned(),
            key: key.to_owned(),
            bytes: stat.len(),
            meta,
        });
    }
    out
}

/// The bytes one session occupies. Flat: this module writes no subfolders, and a
/// folder someone else put there is not ours to measure or delete.
fn session_bytes(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .filter(|stat| stat.is_file())
        .map(|stat| stat.len())
        .sum()
}

/// Whether a leftover holds nothing that could ever be restored: no text and no
/// metadata, which is what a session cleared by a clean quit leaves behind (its
/// `alive` file and nothing else). An orphan `.txt` is *not* spent — it is unsaved
/// work whose sidecar never made it to disk, so it waits for the age prune instead.
fn is_spent(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    !entries.flatten().any(|entry| {
        let path = entry.path();
        matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some(TEXT_EXT) | Some(META_EXT)
        )
    })
}

/// Whether a session may be deleted at all: never the one this run is writing to,
/// and never one another gEdit is still touching.
fn is_prunable(session: &Session, current: Option<&str>, limits: Limits, now: SystemTime) -> bool {
    current != Some(session.id.as_str()) && session.is_leftover(limits, now)
}

fn remove_session(dir: &Path) -> bool {
    match fs::remove_dir_all(dir) {
        Ok(()) => true,
        Err(err) => {
            eprintln!("gEdit: could not prune {} ({err})", dir.display());
            false
        }
    }
}

// --- the command bodies, split from the commands so that the whole round trip
// --- can be tested against a scratch folder instead of an app handle.

/// Writes the snapshot text. Called first by [`put_in`]; see the module header for
/// why the order matters.
fn write_text(dir: &Path, key: &str, text: &str) -> io::Result<()> {
    write_atomic(&dir.join(format!("{key}.{TEXT_EXT}")), text.as_bytes())
}

/// Writes the metadata beside it.
fn write_meta(dir: &Path, key: &str, meta: &Map<String, Value>) -> io::Result<()> {
    let bytes = serde_json::to_vec(meta).map_err(io::Error::other)?;
    write_atomic(&dir.join(format!("{key}.{META_EXT}")), &bytes)
}

/// Creates the session folder if it has gone, owner-only. Only when it is missing:
/// re-applying the mode on every snapshot would fight a user who widened it on
/// purpose, and `paths::ensure` already re-applies it to the recovery root at every
/// start.
fn ensure_session_dir(dir: &Path) -> io::Result<()> {
    if dir.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dir)?;
    paths::restrict(dir)
}

/// The body of [`recovery_put`]: one snapshot into `<root>/<session>/`.
pub fn put_in(root: &Path, session: &str, snapshot: &Snapshot) -> Result<(), String> {
    let dir = session_dir(root, session)?;
    ensure_session_dir(&dir)
        .map_err(|err| format!("recovery: no session folder {} ({err})", dir.display()))?;
    write_text(&dir, &snapshot.key, &snapshot.text)
        .map_err(|err| format!("recovery: could not write the snapshot ({err})"))?;
    // A failure here leaves the text where it is on purpose. On an update the
    // previous sidecar still restores it; on a first snapshot the bytes stay on disk
    // for the user to find, which beats deleting unsaved work to keep the folder tidy.
    write_meta(&dir, &snapshot.key, &snapshot.meta)
        .map_err(|err| format!("recovery: could not write the snapshot metadata ({err})"))
}

/// The body of [`recovery_drop`]: the document was saved or closed, so both halves go.
/// A half that is not there is not an error — a save right after a close asks twice.
pub fn drop_in(root: &Path, session: &str, key: &str) -> Result<(), String> {
    let mut failures = Vec::new();
    for ext in [TEXT_EXT, META_EXT] {
        let path = snapshot_file(root, session, key, ext)?;
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => failures.push(format!("{}: {err}", path.display())),
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "recovery: could not drop {key} ({})",
            failures.join("; ")
        ))
    }
}

/// The body of [`recovery_clear_current`]: every pair of this session goes, the
/// `alive` file stays. The session is still running at that moment — it is being
/// quit — and taking its heartbeat away would let the next start mistake the folder
/// for something to prune while this one is still writing to it.
pub fn clear_in(root: &Path, session: &str) -> Result<(), String> {
    let dir = session_dir(root, session)?;
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(());
    };
    let mut failures = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some(TEXT_EXT) | Some(META_EXT)
        ) {
            continue;
        }
        if let Err(err) = fs::remove_file(&path) {
            failures.push(format!("{}: {err}", path.display()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "recovery: could not clear {session} ({})",
            failures.join("; ")
        ))
    }
}

/// The body of [`recovery_list`]: every snapshot of every leftover session, newest
/// first. Infallible — the restore dialog runs during startup, and a recovery folder
/// that cannot be read has to mean "nothing to offer", never "gEdit will not start".
pub fn list_in(
    root: &Path,
    current: Option<&str>,
    limits: Limits,
    now: SystemTime,
) -> Vec<RecoveryEntry> {
    let mut out = Vec::new();
    for session in sessions_in(root) {
        if current == Some(session.id.as_str()) || !session.is_leftover(limits, now) {
            continue;
        }
        out.extend(entries_in(&session.dir, &session.id));
    }
    out.sort_by(|a, b| {
        saved_at(&b.meta)
            .cmp(&saved_at(&a.meta))
            .then_with(|| a.session.cmp(&b.session))
            .then_with(|| a.key.cmp(&b.key))
    });
    out
}

/// The body of [`recovery_read`]: the bytes of one snapshot. `symlink_metadata`, so a
/// link planted in the recovery folder cannot turn this into "read any file the user
/// can read" — the folder is 0700, but a command that hands bytes to the webview is
/// not the place to rely on that alone.
pub fn read_in(root: &Path, session: &str, key: &str) -> Result<Vec<u8>, String> {
    let path = snapshot_file(root, session, key, TEXT_EXT)?;
    let stat = fs::symlink_metadata(&path)
        .map_err(|err| format!("recovery: {session}/{key} cannot be read ({err})"))?;
    if !stat.is_file() {
        return Err(format!("recovery: {session}/{key} is not a snapshot"));
    }
    if stat.len() > MAX_BODY_BYTES as u64 {
        return Err(format!(
            "recovery: {session}/{key} is larger than {MAX_BODY_BYTES} bytes"
        ));
    }
    fs::read(&path).map_err(|err| format!("recovery: {session}/{key} cannot be read ({err})"))
}

/// The body of [`recovery_discard`]: a whole leftover session. The current session is
/// refused — discarding it would delete the snapshots of the documents that are open
/// right now — and so is anything that is not a real folder.
pub fn discard_in(root: &Path, current: Option<&str>, session: &str) -> Result<(), String> {
    let dir = session_dir(root, session)?;
    if current == Some(session) {
        return Err("recovery: the current session cannot be discarded".to_owned());
    }
    match fs::symlink_metadata(&dir) {
        Ok(stat) if stat.is_dir() => fs::remove_dir_all(&dir)
            .map_err(|err| format!("recovery: could not discard {session} ({err})")),
        Ok(_) => Err(format!("recovery: {session} is not a session folder")),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("recovery: could not discard {session} ({err})")),
    }
}

/// Deletes what the folder may not keep: leftovers nobody came back for, leftovers a
/// clean quit emptied, and — only if the folder is still over its cap — the oldest
/// leftovers until it is under. Answers with how many sessions went.
///
/// Two things are never touched: this run's own folder, and a session another gEdit
/// is still heartbeating. Everything else is ordered oldest first, so the size pass
/// gives up the least recent work rather than whatever `read_dir` happened to yield.
pub fn prune_in(root: &Path, current: Option<&str>, limits: Limits, now: SystemTime) -> usize {
    let mut sessions = sessions_in(root);
    sessions.sort_by_key(|session| session.alive);
    let sizes: Vec<u64> = sessions
        .iter()
        .map(|session| session_bytes(&session.dir))
        .collect();
    let mut total: u64 = sizes.iter().sum();
    let mut gone = vec![false; sessions.len()];
    let mut removed = 0;

    for (n, session) in sessions.iter().enumerate() {
        if !is_prunable(session, current, limits, now) {
            continue;
        }
        if (session.quiet_for(now) > limits.max_age || is_spent(&session.dir))
            && remove_session(&session.dir)
        {
            gone[n] = true;
            removed += 1;
            total = total.saturating_sub(sizes[n]);
        }
    }

    for (n, session) in sessions.iter().enumerate() {
        if total <= limits.max_total_bytes {
            break;
        }
        if gone[n] || !is_prunable(session, current, limits, now) {
            continue;
        }
        if remove_session(&session.dir) {
            gone[n] = true;
            removed += 1;
            total = total.saturating_sub(sizes[n]);
        }
    }
    removed
}

// --- the commands -----------------------------------------------------------

/// Writes one snapshot: the raw body as `<key>.txt`, the header as `<key>.json`,
/// both atomically, under the current session folder.
#[tauri::command]
pub fn recovery_put(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let snapshot = parse_snapshot(
        request
            .headers()
            .get(RECOVERY_HEADER)
            .and_then(|value| value.to_str().ok()),
        request.body(),
    )?;
    let session =
        current_session().ok_or_else(|| "recovery: this run has no session folder".to_owned())?;
    put_in(&paths::app_dirs(&app)?.recovery_dir(), &session, &snapshot)
}

/// Forgets one snapshot of the **current** session: the document was saved or closed,
/// so there is nothing left to recover.
#[tauri::command]
pub fn recovery_drop(app: AppHandle, key: String) -> Result<(), String> {
    if !valid_key(&key) {
        return Err(format!("recovery: {key} is not a usable key"));
    }
    let Some(session) = current_session() else {
        return Ok(());
    };
    drop_in(&paths::app_dirs(&app)?.recovery_dir(), &session, &key)
}

/// Empties the current session's folder. Called from `files.onWillQuit`, after the
/// user's quit decision — never from `RunEvent::Exit` (F29).
#[tauri::command]
pub fn recovery_clear_current(app: AppHandle) -> Result<(), String> {
    let Some(session) = current_session() else {
        return Ok(());
    };
    clear_in(&paths::app_dirs(&app)?.recovery_dir(), &session)
}

/// Every snapshot of every **leftover** session, newest first. The current session is
/// never listed, so gEdit cannot offer the user their own open documents as a crash.
/// Infallible: a recovery folder that cannot be read is an empty list, because the
/// restore dialog runs during startup.
#[tauri::command]
pub fn recovery_list(app: AppHandle) -> Vec<RecoveryEntry> {
    match paths::app_dirs(&app) {
        Ok(dirs) => list_in(
            &dirs.recovery_dir(),
            current_session().as_deref(),
            Limits::default(),
            SystemTime::now(),
        ),
        Err(_) => Vec::new(),
    }
}

/// The raw bytes of one snapshot. A raw response, for the same reason the write is a
/// raw body: a 10 MB program does not go through JSON twice.
#[tauri::command]
pub fn recovery_read(
    app: AppHandle,
    session: String,
    key: String,
) -> Result<tauri::ipc::Response, String> {
    if !valid_key(&session) || !valid_key(&key) {
        return Err("recovery: unusable session or key".to_owned());
    }
    let bytes = read_in(&paths::app_dirs(&app)?.recovery_dir(), &session, &key)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Removes a whole leftover session, which is what "Discard" in the restore dialog
/// does. The current session is refused: discarding it would delete the snapshots of
/// the documents that are open right now.
#[tauri::command]
pub fn recovery_discard(app: AppHandle, session: String) -> Result<(), String> {
    if !valid_key(&session) {
        return Err(format!("recovery: {session} is not a usable session"));
    }
    discard_in(
        &paths::app_dirs(&app)?.recovery_dir(),
        current_session().as_deref(),
        &session,
    )
}

/// Creates this run's session folder (owner-only), starts the heartbeat thread and
/// prunes what is too old or too big. Called from `setup_app`, before the window
/// appears, because a snapshot may arrive as soon as the first keystroke does.
/// Never fails and never panics: no recovery folder means no snapshots, not no app.
pub fn start_session(app: &AppHandle) {
    let Ok(dirs) = paths::app_dirs(app) else {
        eprintln!("gEdit: no recovery folder (no data directory)");
        return;
    };
    let root = dirs.recovery_dir();
    let now = SystemTime::now();
    let dir = match create_session(&root, now) {
        Ok((id, dir)) => {
            *current() = Some(id);
            dir
        }
        Err(err) => {
            eprintln!("gEdit: no recovery session ({err})");
            return;
        }
    };
    if let Err(err) = touch_alive(&dir) {
        eprintln!("gEdit: the recovery heartbeat could not be written ({err})");
    }
    // Before the window, not on the heartbeat thread: the restore dialog asks for the
    // leftovers as soon as the webview has rendered, and a prune running beside that
    // could delete a session while the user is deciding about it.
    prune_in(&root, current_session().as_deref(), Limits::default(), now);
    let beat = std::thread::Builder::new()
        .name("gedit-recovery-alive".to_owned())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(HEARTBEAT_SECS));
            if let Err(err) = touch_alive(&dir) {
                eprintln!("gEdit: the recovery heartbeat failed ({err})");
            }
        });
    if let Err(err) = beat {
        eprintln!("gEdit: no recovery heartbeat ({err})");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_scan;

    /// The alphabet is the whole of the path defence, so the cases that matter are
    /// the ones that would escape the session folder.
    #[test]
    fn a_key_that_could_leave_its_folder_is_refused() {
        for good in ["d1", "a", "0", "doc-12-ab", &"a".repeat(MAX_KEY_LENGTH)] {
            assert!(valid_key(good), "{good} should be usable");
        }
        for bad in [
            "",
            "..",
            ".",
            "../etc/passwd",
            "a/b",
            "a\\b",
            "C:",
            ".hidden",
            "D1",
            "a_b",
            "a b",
            "a.txt",
            "a\0b",
            "ä",
            "a\u{2215}b",
            &"a".repeat(MAX_KEY_LENGTH + 1),
        ] {
            assert!(!valid_key(bad), "{bad:?} should be refused");
        }
    }

    /// M8: the alphabet spells the DOS device names too, and a key becomes
    /// `<key>.txt` and `<key>.json` — both of which are the device on Windows, with
    /// or without the extension. A snapshot filed under `nul` would be written to
    /// nothing and read back as nothing, and the session id is checked by the same
    /// rule because it becomes a folder name.
    #[test]
    fn a_key_that_names_a_windows_device_is_refused() {
        for device in ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"] {
            assert!(!valid_key(device), "{device} names a device");
        }
        // The ids gEdit builds itself are unaffected, and so are ordinary keys that
        // only start like a device.
        for good in ["console", "com10", "nulled", "d1", "s-1750000000000-4711"] {
            assert!(valid_key(good), "{good} should still be usable");
        }
    }

    /// Every command that takes a session or a key validates it before it does
    /// anything else — that check has to survive WP7.2 filling the bodies in.
    #[test]
    fn every_command_that_takes_a_name_validates_it_first() {
        let source = source_scan::lf(include_str!("recovery.rs"));
        for (signature, check) in [
            (
                concat!("pub fn recovery_", "drop(app: AppHandle, key: String)"),
                "valid_key(&key)",
            ),
            (
                concat!(
                    "pub fn recovery_",
                    "discard(app: AppHandle, session: String)"
                ),
                "valid_key(&session)",
            ),
        ] {
            let at = source.find(signature).expect(signature);
            let body = &source[at..];
            let guard = body.find(check).expect(check);
            let end = body.find("\n}\n").expect("no end of function");
            assert!(guard < end, "{check} is not inside {signature}");
        }
        // `recovery_read` takes both.
        let at = source
            .find(concat!("pub fn recovery_", "read("))
            .expect("recovery_read changed");
        let body = &source[at..at + source[at..].find("\n}\n").unwrap()];
        assert!(body.contains("valid_key(&session)") && body.contains("valid_key(&key)"));
    }

    /// The caps are read before anything is allocated, so they are part of the
    /// contract rather than an implementation detail WP7.2 may pick.
    #[test]
    fn the_caps_are_the_ones_the_plan_names() {
        assert_eq!(MAX_BODY_BYTES, 64 * 1024 * 1024);
        assert_eq!(MAX_HEADER_BYTES, 8 * 1024);
        assert_eq!(MAX_KEY_LENGTH, 64);
        assert_eq!(RECOVERY_HEADER, "x-gedit-recovery");
        // A missed heartbeat must not look like a crash, and a real crash must be
        // noticed by the next start: four beats is the documented margin.
        assert_eq!(STALE_AFTER_SECS, 4 * HEARTBEAT_SECS);
        assert_eq!(PRUNE_AFTER_DAYS, 14);
        assert_eq!(MAX_TOTAL_BYTES, 200 * 1024 * 1024);
        // And the limits everything outside the tests runs with are those numbers.
        let limits = Limits::default();
        assert_eq!(limits.stale_after, Duration::from_secs(STALE_AFTER_SECS));
        assert_eq!(limits.max_age, Duration::from_secs(14 * 24 * 60 * 60));
        assert_eq!(limits.max_total_bytes, MAX_TOTAL_BYTES);
    }

    /// The webview and Rust have to agree on the header name, or a snapshot would be
    /// written with no metadata and could never be restored.
    #[test]
    fn the_header_name_matches_the_typescript_wrapper() {
        let ts = source_scan::lf(include_str!("../../src/lib/platform/commands.ts"));
        assert!(
            ts.contains(&format!("'{RECOVERY_HEADER}'")),
            "platform/commands.ts must send the {RECOVERY_HEADER} header"
        );
    }

    fn header(key: &str) -> String {
        serde_json::json!({ "key": key, "title": "O1234.nc", "savedAt": 1 }).to_string()
    }

    fn raw(text: &str) -> InvokeBody {
        InvokeBody::Raw(text.as_bytes().to_vec())
    }

    /// The happy path, and the one thing that must come out of it: the metadata is
    /// kept verbatim, so what is written beside the text is what the webview sent.
    #[test]
    fn a_well_formed_snapshot_keeps_its_metadata_verbatim() {
        let snapshot = parse_snapshot(Some(&header("d1")), &raw("G0 X0\nG1 Z-5\n")).unwrap();
        assert_eq!(snapshot.key, "d1");
        assert_eq!(snapshot.text, "G0 X0\nG1 Z-5\n");
        assert_eq!(snapshot.meta["title"], Value::from("O1234.nc"));
        assert_eq!(snapshot.meta["key"], Value::from("d1"));
    }

    /// Every way the boundary can be pushed, refused. A key that could leave the
    /// folder is the one that matters most, because it is the only value from the
    /// webview that becomes a file name.
    #[test]
    fn a_snapshot_that_breaks_a_rule_is_refused() {
        let cases: [(Option<String>, InvokeBody, &str); 8] = [
            (None, raw("G0"), "no x-gedit-recovery header"),
            (
                Some("x".repeat(MAX_HEADER_BYTES + 1)),
                raw("G0"),
                "larger than",
            ),
            (Some("[1,2]".to_owned()), raw("G0"), "not a JSON object"),
            (Some("{oops".to_owned()), raw("G0"), "not JSON"),
            (Some("{}".to_owned()), raw("G0"), "no key"),
            (
                Some(header("../../etc/passwd")),
                raw("G0"),
                "not a usable key",
            ),
            (
                Some(header("d1")),
                InvokeBody::Json(serde_json::json!("G0")),
                "must be a raw body",
            ),
            (
                Some(header("d1")),
                InvokeBody::Raw(vec![0xff, 0xfe, 0x00]),
                "not UTF-8",
            ),
        ];
        for (head, body, expected) in cases {
            let err = parse_snapshot(head.as_deref(), &body)
                .expect_err(&format!("accepted a snapshot that should fail: {expected}"));
            assert!(err.contains(expected), "{err} does not mention {expected}");
        }
    }

    /// The body cap is checked on the bytes that arrived, before they are turned
    /// into a `String` and before anything is written.
    #[test]
    fn a_body_over_the_cap_is_refused() {
        let over = InvokeBody::Raw(vec![b'G'; MAX_BODY_BYTES + 1]);
        let err =
            parse_snapshot(Some(&header("d1")), &over).expect_err("accepted an oversized body");
        assert!(err.contains("larger than"), "{err}");
        // And exactly at the cap is still accepted: the limit is inclusive, so a
        // document that could be opened can also be snapshotted.
        let at = InvokeBody::Raw(vec![b'G'; MAX_BODY_BYTES]);
        assert_eq!(
            parse_snapshot(Some(&header("d1")), &at).unwrap().text.len(),
            MAX_BODY_BYTES
        );
    }

    /// An unknown member of a stored snapshot survives the round trip: a later
    /// milestone adds one (M10's `channelId`), and an entry written by that build
    /// still has to restore in one that does not know it.
    #[test]
    fn an_entry_keeps_metadata_members_it_does_not_understand() {
        let mut meta = serde_json::Map::new();
        meta.insert("title".to_owned(), serde_json::json!("O1234.nc"));
        meta.insert("channelId".to_owned(), serde_json::json!("ch2"));
        meta.insert(
            "savedAt".to_owned(),
            serde_json::json!(1_700_000_000_000i64),
        );
        let entry = RecoveryEntry {
            session: "s-1".to_owned(),
            key: "d1".to_owned(),
            bytes: 12,
            meta,
        };
        assert_eq!(
            serde_json::to_value(&entry).unwrap(),
            serde_json::json!({
                "session": "s-1",
                "key": "d1",
                "bytes": 12,
                "title": "O1234.nc",
                "channelId": "ch2",
                "savedAt": 1_700_000_000_000i64,
            })
        );
    }

    // --- the folder, end to end over a scratch recovery root -----------------

    fn scratch(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("gedit-recovery-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn object(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            other => panic!("not an object: {other}"),
        }
    }

    /// A snapshot as `recovery_put` would have parsed one.
    fn snapshot(key: &str, text: &str, saved_at: i64) -> Snapshot {
        Snapshot {
            key: key.to_owned(),
            meta: object(serde_json::json!({
                "key": key,
                "path": "/nc/O1234.nc",
                "title": "O1234.nc",
                "profileId": "fanuc-lathe",
                "diskStamp": { "size": 12, "modified": saved_at - 1000 },
                "savedAt": saved_at,
            })),
            text: text.to_owned(),
        }
    }

    /// A session folder with a heartbeat, as [`start_session`] leaves one.
    fn session_with(root: &Path, id: &str, snapshots: &[Snapshot]) -> PathBuf {
        let dir = root.join(id);
        fs::create_dir_all(&dir).unwrap();
        touch_alive(&dir).unwrap();
        for snapshot in snapshots {
            put_in(root, id, snapshot).unwrap();
        }
        dir
    }

    /// Moves a session's heartbeat into the past, which is the only way to make one
    /// session older than another without sleeping through the test.
    fn quiet_since(dir: &Path, ago: Duration) {
        let when = SystemTime::now() - ago;
        let file = fs::OpenOptions::new()
            .write(true)
            .open(dir.join(ALIVE_FILE_NAME))
            .unwrap();
        file.set_times(fs::FileTimes::new().set_modified(when))
            .unwrap();
    }

    fn keys(entries: &[RecoveryEntry]) -> Vec<String> {
        entries.iter().map(|entry| entry.key.clone()).collect()
    }

    /// The whole promise in one test: 5 MB of unsaved program goes in, and after the
    /// process that wrote it is gone it comes back byte for byte, with the metadata
    /// the webview sent — unknown members included.
    #[test]
    fn a_five_megabyte_snapshot_round_trips_through_the_folder() {
        let root = scratch("round-trip");
        let text = "G1 X12.345 Z-6.789 F0.25\n".repeat(220_000);
        assert!(text.len() >= 5 * 1024 * 1024, "{} bytes", text.len());
        let mut put = snapshot("d1", &text, 1_700_000_000_000);
        put.meta
            .insert("channelId".to_owned(), serde_json::json!("ch2"));
        let dir = session_with(&root, "s-1", &[put]);
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        let entries = list_in(&root, None, Limits::default(), SystemTime::now());
        assert_eq!(keys(&entries), vec!["d1".to_owned()]);
        let entry = &entries[0];
        assert_eq!(entry.session, "s-1");
        assert_eq!(entry.bytes, text.len() as u64);
        assert_eq!(entry.meta["title"], Value::from("O1234.nc"));
        assert_eq!(entry.meta["path"], Value::from("/nc/O1234.nc"));
        // Nothing in the metadata is interpreted, so a member from a later build
        // survives and the disk stamp comes back exactly as it went in.
        assert_eq!(entry.meta["channelId"], Value::from("ch2"));
        assert_eq!(
            entry.meta["diskStamp"],
            serde_json::json!({ "size": 12, "modified": 1_699_999_999_000i64 })
        );
        // The file name and the folder win over anything a sidecar claims about them.
        assert!(!entry.meta.contains_key("key"));

        let bytes = read_in(&root, "s-1", "d1").unwrap();
        assert_eq!(bytes.len(), text.len());
        assert_eq!(String::from_utf8(bytes).unwrap(), text);
        let _ = fs::remove_dir_all(&root);
    }

    /// The disk stamp comes back bit for bit, fraction and all (M7 integration, mergeA).
    ///
    /// `files_stat` reports `mtimeMs` with a fraction, and the restore dialog decides
    /// "has this file changed since the snapshot?" by comparing that number with the one
    /// a fresh stat gives. serde_json's float parser is **not** correctly rounded unless
    /// the `float_roundtrip` feature is on: without it this number comes back one ULP
    /// away from the one the webview sent, every restore is announced as "the file
    /// changed on disk", and the one case that really matters stops standing out.
    /// Deleting the feature from `Cargo.toml` fails this test.
    #[test]
    fn a_fractional_disk_stamp_comes_back_exactly_as_it_went_in() {
        let root = scratch("stamp-precision");
        let mtime = 1_790_138_808_145.755_9_f64;
        let mut put = snapshot("d1", "G0 X1\n", 1_700_000_000_000);
        put.meta.insert(
            "diskStamp".to_owned(),
            serde_json::json!({ "mtimeMs": mtime, "size": 29, "hash": 3_145_239_745u32 }),
        );
        let dir = session_with(&root, "s-1", &[put]);
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        let entries = list_in(&root, None, Limits::default(), SystemTime::now());
        let back = entries[0].meta["diskStamp"]["mtimeMs"].as_f64().unwrap();
        assert_eq!(
            back.to_bits(),
            mtime.to_bits(),
            "the stamp came back as {back} instead of {mtime}"
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// A second gEdit must never be offered the first one's open documents, and the
    /// first one must never be offered its own: the dialog is for crashes only.
    #[test]
    fn the_current_session_is_never_offered_as_a_crash() {
        let root = scratch("current");
        let mine = session_with(&root, "s-mine", &[snapshot("d1", "G0\n", 2)]);
        let theirs = session_with(&root, "s-theirs", &[snapshot("d2", "G1\n", 1)]);
        // Even a session of ours that has been silent for hours stays out of the list.
        quiet_since(&mine, Duration::from_secs(3 * 3600));
        quiet_since(&theirs, Duration::from_secs(3 * 3600));

        let entries = list_in(&root, Some("s-mine"), Limits::default(), SystemTime::now());
        assert_eq!(keys(&entries), vec!["d2".to_owned()]);
        assert_eq!(entries[0].session, "s-theirs");
        let _ = fs::remove_dir_all(&root);
    }

    /// The liveness rule, with the clock injected instead of waited out: the same
    /// folder is not a leftover now and is one two minutes later.
    #[test]
    fn a_session_is_a_leftover_only_once_its_heartbeat_has_gone_quiet() {
        let root = scratch("stale");
        session_with(&root, "s-other", &[snapshot("d1", "G0\n", 1)]);
        let now = SystemTime::now();
        let limits = Limits::default();

        assert!(
            list_in(&root, None, limits, now).is_empty(),
            "a gEdit that is still running was offered as a crash"
        );
        // One beat missed is not a crash; four are.
        let one_beat = now + Duration::from_secs(HEARTBEAT_SECS + 1);
        assert!(list_in(&root, None, limits, one_beat).is_empty());
        let four_beats = now + Duration::from_secs(STALE_AFTER_SECS + 1);
        assert_eq!(keys(&list_in(&root, None, limits, four_beats)), ["d1"]);
        let _ = fs::remove_dir_all(&root);
    }

    /// Newest first, so the dialog's first row is the last thing the user typed.
    #[test]
    fn the_leftovers_come_back_newest_first() {
        let root = scratch("order");
        let dir = session_with(
            &root,
            "s-1",
            &[
                snapshot("d1", "G0\n", 1_700_000_000_000),
                snapshot("d2", "G1\n", 1_700_000_500_000),
                snapshot("d3", "G2\n", 1_700_000_100_000),
            ],
        );
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));
        assert_eq!(
            keys(&list_in(&root, None, Limits::default(), SystemTime::now())),
            ["d2", "d3", "d1"]
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// A process killed between the two halves of the pair leaves the new text beside
    /// the old metadata. That has to still restore — and the stamp it restores with
    /// has to be the *older* one, because a stamp newer than the text is what would
    /// let a restore overwrite a file that changed in the meantime.
    #[test]
    fn a_pair_torn_by_a_crash_restores_the_newer_text_with_the_older_stamp() {
        let root = scratch("torn");
        let dir = session_with(&root, "s-1", &[snapshot("d1", "G0 X0\n", 1_000)]);

        // The crash: the text write went through, the metadata write never ran.
        write_text(&dir, "d1", "G0 X0\nG1 X25.4\n").unwrap();
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        let entries = list_in(&root, None, Limits::default(), SystemTime::now());
        assert_eq!(keys(&entries), ["d1"]);
        assert_eq!(saved_at(&entries[0].meta), 1_000);
        assert_eq!(
            entries[0].meta["diskStamp"],
            serde_json::json!({ "size": 12, "modified": 0 })
        );
        assert_eq!(
            String::from_utf8(read_in(&root, "s-1", "d1").unwrap()).unwrap(),
            "G0 X0\nG1 X25.4\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// And the order itself, read from the source: the test above passes under either
    /// order, because it writes the halves by hand. This is what makes the swap fail.
    #[test]
    fn the_pair_is_written_in_the_order_that_survives_a_kill() {
        let source = source_scan::lf(include_str!("recovery.rs"));
        let at = source
            .find(concat!("pub fn put_", "in(root: &Path"))
            .expect("put_in changed");
        let body = &source[at..at + source[at..].find("\n}\n").expect("no end of function")];
        let text = body.find("write_text(").expect("put_in writes no text");
        let meta = body.find("write_meta(").expect("put_in writes no metadata");
        assert!(
            text < meta,
            "the metadata is written before the text: a crash between the two would \
             claim a newer disk stamp for older text"
        );
    }

    /// A snapshot write that fails must leave the previous snapshot exactly as it was.
    /// An in-place write would have truncated it before finding out it could not
    /// finish, and the crash it was meant to survive would cost the whole document.
    #[cfg(unix)]
    #[test]
    fn a_failed_write_leaves_the_previous_snapshot_whole() {
        use std::os::unix::fs::PermissionsExt;

        let root = scratch("write-fails");
        let dir = session_with(&root, "s-1", &[snapshot("d1", "G0 X0\n", 1_000)]);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        // root ignores the mode bits, so only assert when the folder really is closed.
        let closed = fs::write(dir.join("probe"), b"").is_err();
        if closed {
            let err = put_in(&root, "s-1", &snapshot("d1", "G1 X99\n", 2_000))
                .expect_err("the write went through");
            assert!(err.contains("could not write the snapshot"), "{err}");
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(
                String::from_utf8(read_in(&root, "s-1", "d1").unwrap()).unwrap(),
                "G0 X0\n"
            );
            quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));
            let entries = list_in(&root, None, Limits::default(), SystemTime::now());
            assert_eq!(saved_at(&entries[0].meta), 1_000);
            // And no temp file of the failed attempt is left lying next to it.
            let leftovers: Vec<String> = fs::read_dir(&dir)
                .unwrap()
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| name.contains(".tmp-"))
                .collect();
            assert_eq!(leftovers, Vec::<String>::new());
        } else {
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// G8 M7. A `kill -9` between [`put_in`]'s two writes leaves a `.txt` with no
    /// sidecar, and on a document's **first** snapshot there is no previous sidecar to
    /// fall back on — so this is every dirty document in the first thirty seconds after
    /// it is touched. The listing used to walk the `.json` files and skip such a text
    /// entirely: the restore dialog said there was nothing to recover, nothing ever
    /// named the file, and the 14-day prune then deleted the only copy of that work.
    ///
    /// It is offered instead, as what it is: text with no label. Untitled, unbound, no
    /// disk stamp — so restoring it can only ever reach the disk through Save As.
    #[test]
    fn a_snapshot_without_metadata_is_still_offered_as_untitled_work() {
        let root = scratch("orphan");
        let dir = session_with(&root, "s-1", &[]);
        write_text(&dir, "d1", "G0 X0\n").unwrap();
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        let entries = list_in(&root, None, Limits::default(), SystemTime::now());
        assert_eq!(keys(&entries), vec!["d1".to_owned()]);
        let entry = &entries[0];
        assert_eq!(entry.bytes, 6);
        assert_eq!(entry.meta["metaLost"], Value::Bool(true));
        assert_eq!(entry.meta["path"], Value::Null);
        assert_eq!(entry.meta["diskStamp"], Value::Null);
        assert_eq!(entry.meta["title"], Value::from(""));
        // And the text really comes back.
        assert_eq!(
            String::from_utf8(read_in(&root, "s-1", "d1").unwrap()).unwrap(),
            "G0 X0\n"
        );
        assert_eq!(
            prune_in(&root, None, Limits::default(), SystemTime::now()),
            0
        );
        assert!(dir.join("d1.txt").is_file(), "the text was thrown away");
        let _ = fs::remove_dir_all(&root);
    }

    /// The same for a sidecar that is there but unreadable: the label is gone, the
    /// work is not.
    #[test]
    fn a_broken_sidecar_costs_the_label_and_not_the_text() {
        let root = scratch("broken-meta");
        let dir = session_with(&root, "s-1", &[snapshot("d1", "G0 X0\n", 1)]);
        fs::write(dir.join("d1.json"), b"{not json").unwrap();
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        let entries = list_in(&root, None, Limits::default(), SystemTime::now());
        assert_eq!(keys(&entries), vec!["d1".to_owned()]);
        assert_eq!(entries[0].meta["metaLost"], Value::Bool(true));
        assert_eq!(
            prune_in(&root, None, Limits::default(), SystemTime::now()),
            0
        );
        assert_eq!(
            String::from_utf8(read_in(&root, "s-1", "d1").unwrap()).unwrap(),
            "G0 X0\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// A `.json` with no `.txt` is still nothing: there is no text to restore, and an
    /// entry for it would offer the user an empty document.
    #[test]
    fn a_sidecar_without_its_text_is_not_an_entry() {
        let root = scratch("lone-meta");
        let dir = session_with(&root, "s-1", &[snapshot("d1", "G0 X0\n", 1)]);
        fs::remove_file(dir.join("d1.txt")).unwrap();
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        assert!(list_in(&root, None, Limits::default(), SystemTime::now()).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    /// The failure `put_in`'s own comment describes: the text lands, the metadata does
    /// not, and the command says so. What is on disk is offered at the next start.
    #[test]
    fn a_put_whose_metadata_failed_leaves_work_that_is_still_listed() {
        let root = scratch("meta-fails");
        let dir = session_with(&root, "s-1", &[]);
        // A directory where the sidecar wants to be: the text write succeeds, the
        // metadata write cannot.
        fs::create_dir_all(dir.join("d1.json")).unwrap();

        let failed = put_in(&root, "s-1", &snapshot("d1", "G0 X0\n", 1)).unwrap_err();
        assert!(failed.contains("metadata"), "{failed}");
        assert!(dir.join("d1.txt").is_file());

        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));
        let entries = list_in(&root, None, Limits::default(), SystemTime::now());
        assert_eq!(keys(&entries), vec!["d1".to_owned()]);
        assert_eq!(entries[0].meta["metaLost"], Value::Bool(true));
        let _ = fs::remove_dir_all(&root);
    }

    /// Age pruning: a leftover nobody came back for in a fortnight goes; one from an
    /// hour ago stays, whatever else is in the folder.
    #[test]
    fn pruning_removes_a_leftover_nobody_came_back_for() {
        let root = scratch("prune-age");
        let old = session_with(&root, "s-old", &[snapshot("d1", "G0\n", 1)]);
        let recent = session_with(&root, "s-recent", &[snapshot("d2", "G1\n", 2)]);
        quiet_since(&old, Duration::from_secs(15 * 24 * 3600));
        quiet_since(&recent, Duration::from_secs(3600));

        assert_eq!(
            prune_in(&root, None, Limits::default(), SystemTime::now()),
            1
        );
        assert!(!old.exists(), "the old session survived");
        assert!(recent.join("d2.txt").is_file(), "the recent session went");
        let _ = fs::remove_dir_all(&root);
    }

    /// Size pruning: oldest leftovers first, until the folder is under its cap — and
    /// never the session this run is writing to, nor one another gEdit is still
    /// heartbeating, however old and however large the folder has become.
    #[test]
    fn pruning_by_size_gives_up_the_oldest_and_never_a_running_session() {
        let root = scratch("prune-size");
        let mine = session_with(&root, "s-mine", &[snapshot("d1", &"G".repeat(1000), 1)]);
        let live = session_with(&root, "s-live", &[snapshot("d2", &"G".repeat(1000), 2)]);
        let old = session_with(&root, "s-old", &[snapshot("d3", &"G".repeat(1000), 3)]);
        let newer = session_with(&root, "s-newer", &[snapshot("d4", &"G".repeat(1000), 4)]);
        // `s-mine` is this run's and the oldest of all; `s-live` is another gEdit that
        // is still beating. Only the two leftovers may go, oldest first.
        quiet_since(&mine, Duration::from_secs(9 * 3600));
        quiet_since(&old, Duration::from_secs(3 * 3600));
        quiet_since(&newer, Duration::from_secs(3600));

        let one = session_bytes(&old);
        let limits = Limits {
            max_total_bytes: 3 * one,
            ..Limits::default()
        };
        assert_eq!(
            prune_in(&root, Some("s-mine"), limits, SystemTime::now()),
            1,
            "more than the one session over the cap was deleted"
        );
        assert!(!old.exists(), "the oldest leftover survived");
        assert!(mine.join("d1.txt").is_file(), "this run's session went");
        assert!(live.join("d2.txt").is_file(), "a running session went");
        assert!(newer.join("d4.txt").is_file(), "the newer leftover went");
        let _ = fs::remove_dir_all(&root);
    }

    /// A clean quit empties its session but leaves the heartbeat, so the next start
    /// finds a folder with nothing in it and takes it away. An empty folder is the
    /// only thing pruned before its time.
    #[test]
    fn a_session_a_clean_quit_emptied_is_pruned_at_the_next_start() {
        let root = scratch("prune-spent");
        let dir = session_with(&root, "s-1", &[snapshot("d1", "G0\n", 1)]);
        clear_in(&root, "s-1").unwrap();
        assert!(dir.join(ALIVE_FILE_NAME).is_file(), "the heartbeat went");
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        assert_eq!(
            prune_in(&root, None, Limits::default(), SystemTime::now()),
            1
        );
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// Clearing takes the pairs of one session and nothing else: not the heartbeat,
    /// and not another session's work.
    #[test]
    fn clearing_the_current_session_leaves_every_other_session_alone() {
        let root = scratch("clear");
        let mine = session_with(
            &root,
            "s-mine",
            &[snapshot("d1", "G0\n", 1), snapshot("d2", "G1\n", 2)],
        );
        let theirs = session_with(&root, "s-theirs", &[snapshot("d3", "G2\n", 3)]);

        clear_in(&root, "s-mine").unwrap();
        assert!(!mine.join("d1.txt").exists() && !mine.join("d1.json").exists());
        assert!(!mine.join("d2.txt").exists() && !mine.join("d2.json").exists());
        assert!(mine.join(ALIVE_FILE_NAME).is_file());
        assert!(theirs.join("d3.txt").is_file() && theirs.join("d3.json").is_file());
        // And clearing a folder that is already gone is not an error.
        fs::remove_dir_all(&mine).unwrap();
        clear_in(&root, "s-mine").unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    /// Dropping is what a save does, and a save can happen twice.
    #[test]
    fn dropping_forgets_both_halves_and_a_missing_one_is_not_an_error() {
        let root = scratch("drop");
        let dir = session_with(
            &root,
            "s-1",
            &[snapshot("d1", "G0\n", 1), snapshot("d2", "G1\n", 2)],
        );
        drop_in(&root, "s-1", "d1").unwrap();
        assert!(!dir.join("d1.txt").exists() && !dir.join("d1.json").exists());
        assert!(dir.join("d2.txt").is_file());
        drop_in(&root, "s-1", "d1").unwrap();
        drop_in(&root, "s-1", "never-there").unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    /// "Discard" empties a leftover. The current session is refused: its snapshots
    /// belong to documents that are open right now.
    #[test]
    fn discarding_takes_a_leftover_and_refuses_the_running_session() {
        let root = scratch("discard");
        let mine = session_with(&root, "s-mine", &[snapshot("d1", "G0\n", 1)]);
        let theirs = session_with(&root, "s-theirs", &[snapshot("d2", "G1\n", 2)]);

        let err = discard_in(&root, Some("s-mine"), "s-mine").expect_err("discarded our own");
        assert!(err.contains("current session"), "{err}");
        assert!(mine.join("d1.txt").is_file());

        discard_in(&root, Some("s-mine"), "s-theirs").unwrap();
        assert!(!theirs.exists());
        // A session that is already gone is not an error: two clicks, one dialog.
        discard_in(&root, Some("s-mine"), "s-theirs").unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    /// The name checks are not the commands' alone. Every body that turns a session
    /// or a key into a path refuses one that could leave the folder, so a later
    /// caller that forgets the check cannot reach `<data>` or anything above it.
    #[test]
    fn a_name_that_could_leave_the_folder_is_refused_by_every_body() {
        let root = scratch("escape");
        let victim = root.join("s-1");
        session_with(&root, "s-1", &[snapshot("d1", "G0\n", 1)]);

        for bad in ["..", "../s-1", "s 1", ".", "S-1"] {
            assert!(discard_in(&root, None, bad).is_err(), "discard {bad}");
            assert!(read_in(&root, bad, "d1").is_err(), "read {bad}");
            assert!(read_in(&root, "s-1", bad).is_err(), "read key {bad}");
            assert!(drop_in(&root, bad, "d1").is_err(), "drop {bad}");
            assert!(drop_in(&root, "s-1", bad).is_err(), "drop key {bad}");
            assert!(clear_in(&root, bad).is_err(), "clear {bad}");
            assert!(
                put_in(&root, bad, &snapshot("d1", "G0\n", 1)).is_err(),
                "put {bad}"
            );
        }
        assert!(
            victim.join("d1.txt").is_file(),
            "a refused name still wrote"
        );
        assert!(root.is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    /// A folder in `<data>/recovery` that gEdit did not create is the user's. It is
    /// never listed, never pruned and never counted as a session.
    #[test]
    fn a_folder_that_is_not_ours_is_left_where_it_is() {
        let root = scratch("foreign");
        for name in ["not a session", "Snapshots", ".Trash"] {
            let dir = root.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("d1.txt"), b"G0\n").unwrap();
            fs::write(dir.join("d1.json"), br#"{"title":"x","savedAt":1}"#).unwrap();
        }
        let far_future = SystemTime::now() + Duration::from_secs(400 * 24 * 3600);

        assert!(list_in(&root, None, Limits::default(), far_future).is_empty());
        assert_eq!(prune_in(&root, None, Limits::default(), far_future), 0);
        for name in ["not a session", "Snapshots", ".Trash"] {
            assert!(
                root.join(name).join("d1.txt").is_file(),
                "{name} was touched"
            );
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// `recovery_read` hands bytes to the webview, so it reads a file and not
    /// whatever a link in the folder points at.
    #[cfg(unix)]
    #[test]
    fn reading_never_follows_a_link_out_of_the_folder() {
        let root = scratch("symlink");
        let dir = session_with(&root, "s-1", &[]);
        let secret = root.join("secret.txt");
        fs::write(&secret, b"not a snapshot\n").unwrap();
        std::os::unix::fs::symlink(&secret, dir.join("d1.txt")).unwrap();
        fs::write(dir.join("d1.json"), br#"{"title":"x","savedAt":1}"#).unwrap();
        quiet_since(&dir, Duration::from_secs(STALE_AFTER_SECS + 1));

        let err = read_in(&root, "s-1", "d1").expect_err("followed the link");
        assert!(err.contains("not a snapshot"), "{err}");
        assert!(list_in(&root, None, Limits::default(), SystemTime::now()).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    /// The session folder this run writes to: a name that is a usable key, owner-only
    /// on Unix, a heartbeat in it, and a different folder for a second run even when
    /// the clock says the same millisecond.
    #[test]
    fn a_session_folder_is_unique_and_owner_only() {
        let root = scratch("create");
        let now = SystemTime::now();
        let (first, first_dir) = create_session(&root, now).unwrap();
        let (second, second_dir) = create_session(&root, now).unwrap();

        assert!(valid_key(&first), "{first} is not a usable folder name");
        assert!(valid_key(&second), "{second} is not a usable folder name");
        assert_ne!(first, second, "two runs shared a session folder");
        assert!(first_dir.is_dir() && second_dir.is_dir());

        touch_alive(&first_dir).unwrap();
        assert!(first_dir.join(ALIVE_FILE_NAME).is_file());
        // A heartbeat after someone cleared the folder brings it back.
        fs::remove_dir_all(&first_dir).unwrap();
        touch_alive(&first_dir).unwrap();
        assert!(first_dir.join(ALIVE_FILE_NAME).is_file());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&root, &first_dir, &second_dir] {
                let mode = fs::metadata(dir).unwrap().permissions().mode() & 0o777;
                assert_eq!(mode, paths::OWNER_ONLY, "{} is {mode:o}", dir.display());
            }
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// AD-21, F29: a Windows logoff also ends in `RunEvent::Exit`, and a logoff is
    /// exactly what the snapshots are for. Clearing them there would throw away the
    /// work of the session the logoff is killing, so the exit path may not mention
    /// recovery at all — the webview clears, after the user's own quit decision.
    #[test]
    fn the_exit_path_never_clears_the_snapshots() {
        let lib = source_scan::lf(include_str!("lib.rs"));
        let at = lib
            .find(concat!("fn on_run_", "event(app: &AppHandle"))
            .expect("on_run_event changed");
        let body = &lib[at..at + lib[at..].find("\n}\n").expect("no end of function")];
        assert!(
            !body.contains("recovery"),
            "the exit path touches recovery: a Windows logoff would delete the \
             snapshots it is meant to protect"
        );
    }
}

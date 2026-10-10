//! `files_stat`: one batched stat call for the webview (plan §7.6, AD-10).
//!
//! The webview polls this while the window has focus to notice files that changed
//! on disk, to skip a save that would write identical bytes, and to tell dropped
//! folders from dropped files. It exists so that the app needs **no** `fs:allow-stat`
//! capability: a path is answered only when the fs scope already allows it, which
//! happens when the user picked or dropped it. A path outside the scope comes back
//! as `allowed: false` with everything else empty, so the webview cannot use this
//! command to probe the file system.
//!
//! **A stat can hang.** A program on an SMB or DNC share whose server has gone away
//! does not fail, it blocks — for as long as the OS keeps retrying, which can be
//! minutes. So the command is `async` (Tauri runs a plain `fn` command on the main
//! thread, and the external-change poll calls this one every 2 s), each call answers
//! at most [`MAX_STAT_PATHS`] paths, and every path is stat'd on a thread of its own
//! with a shared [`STAT_BUDGET`] (see [`run_bounded`]). A path that has not answered
//! by then comes back `unavailable`: **unknown, never gone** — every other field is
//! empty, `allowed` included, and a caller must decide nothing from it.

use std::collections::{BTreeMap, HashMap};
use std::fs::Metadata;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, UNIX_EPOCH};

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

/// The most paths one `files_stat` call answers. Any beyond it come back
/// `unavailable`, so the answer still has one entry per input. The callers ask for
/// the open documents, the recent list, the session or a drop — far fewer than this.
pub const MAX_STAT_PATHS: usize = 256;

/// How long one `files_stat` call waits for its stats, all of them together. A local
/// disk answers in microseconds and a healthy share in milliseconds; this is for the
/// share that does not answer at all.
pub const STAT_BUDGET: Duration = Duration::from_millis(1500);

/// The most worker threads that may be left waiting on hung paths, all calls
/// together. Past it nothing new is started and everything answers "unknown": a last
/// resort, because [`run_bounded`] already starts no second thread for a path whose
/// first one is still stuck.
const MAX_ABANDONED: usize = 128;

/// One entry of the `files_stat` answer. Serialized in camelCase, matching
/// `FileStat` in `src/lib/platform/commands.ts`.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    /// The path exactly as it was passed in, so the caller can match answers to
    /// requests without normalizing anything.
    pub path: String,
    /// Whether the fs scope allows this path. When false, every other field is
    /// empty regardless of what is on disk.
    pub allowed: bool,
    pub exists: bool,
    pub is_dir: bool,
    /// Modification time in milliseconds since the epoch, or `None` when the
    /// platform does not report one. Fractional milliseconds are kept: an editor
    /// save and a CAM post can land in the same millisecond.
    pub mtime_ms: Option<f64>,
    /// The size in bytes of a regular file; `None` for a directory.
    pub size: Option<u64>,
    /// **Whether this user may not write the file**, which is the question AD-23
    /// asks and not the one `Permissions::readonly()` answers. See [`not_writable`].
    pub readonly: bool,
    /// The stat did not answer within [`STAT_BUDGET`] (a hung share), answered with an
    /// error that does not say "not there" (a timeout, a host that is down, EIO), or the
    /// call asked for more than [`MAX_STAT_PATHS`] paths. Every other field is empty then,
    /// and **empty does not mean gone**: nothing about this path is known.
    pub unavailable: bool,
    /// **Which file this is**: the path with every symlink, `..` and mapped-drive
    /// spelling resolved (`std::fs::canonicalize`, `\\?\` folded away by
    /// [`crate::paths::plain`]). Two spellings of one file answer the same string, so the
    /// webview can tell that a second tab, or a Save As, would take a file another tab
    /// already owns. `None` unless the call asked for it (`canonical: true`), for a
    /// directory, for a path that is not there, and when resolving it failed — then only the lexical comparison is left.
    pub canonical: Option<String>,
}

impl FileStat {
    /// The answer for a path nothing is known about.
    pub fn unavailable(path: String) -> Self {
        FileStat {
            path,
            unavailable: true,
            ..FileStat::default()
        }
    }
}

/// Whether the file at `path` is one the process may not write.
///
/// On Windows this is the `FILE_ATTRIBUTE_READONLY` flag, which is exactly right:
/// `std`'s `Permissions::readonly()` reads that attribute.
///
/// On macOS and Linux it is **not**. There `readonly()` is `mode & 0o222 == 0`, which
/// asks "may *nobody* write this file" — so a program owned by another operator, or by
/// root, or exported read-only by an NFS or SMB server, sits at mode 0644 and answers
/// `false`. That is the commonest read-only case on a shop share, and it was the one
/// AD-23 did not catch: the file opened unlocked with no padlock and no notice, typing
/// was allowed, Save did not go to Save As, and the user found out when the write
/// failed after a shift's editing (G8 M7). No file was damaged — `open(O_TRUNC)` is
/// refused before it truncates — but "protects archive copies" was not true.
///
/// So on Unix the question is asked of the operating system, with the *effective* ids
/// (`AT_EACCESS`) because that is who the write will be attempted as. Directories keep
/// the attribute answer: `readonly` is consumed per file, and a directory nobody may
/// write is not a locked document.
#[cfg(unix)]
fn not_writable(path: &str, meta: &Metadata) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    if meta.is_dir() {
        return meta.permissions().readonly();
    }
    let Ok(c_path) = CString::new(std::ffi::OsStr::new(path).as_bytes()) else {
        // A path with an interior NUL cannot be a file we opened; fall back rather
        // than claim anything about it.
        return meta.permissions().readonly();
    };
    // SAFETY: `c_path` is a valid NUL-terminated C string for the length of the call,
    // and `faccessat` only reads it.
    let answer = unsafe {
        libc::faccessat(
            libc::AT_FDCWD,
            c_path.as_ptr(),
            libc::W_OK,
            libc::AT_EACCESS,
        )
    };
    answer != 0
}

#[cfg(not(unix))]
fn not_writable(_path: &str, meta: &Metadata) -> bool {
    meta.permissions().readonly()
}

/// Stats every path in one round trip. The answer has one entry per input, in the
/// same order, so the caller can zip it with its own list.
///
/// `async` so that Tauri runs it off the main thread (a plain `fn` command is run on
/// it, `tauri-macros` 2.6 `ExecutionContext::Blocking`), and the waiting is done on
/// the blocking pool rather than on an async worker.
#[tauri::command]
pub async fn files_stat(
    app: AppHandle,
    paths: Vec<String>,
    canonical: Option<bool>,
) -> Vec<FileStat> {
    let scope = app.fs_scope();
    let asked = paths.clone();
    let canonical = canonical.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        stat_all(paths, canonical, move |path| scope.is_allowed(path))
    })
    .await
    // The pool task panicked: nothing is known about any of them.
    .unwrap_or_else(|_| asked.into_iter().map(FileStat::unavailable).collect())
}

/// The command's body with the scope predicate injected, so the rules can be
/// tested without an app handle. The predicate runs on the worker thread too:
/// `Scope::is_allowed` canonicalizes, which touches the share as well.
///
/// `canonical` asks for [`FileStat::canonical`]: resolving a path is one lookup per
/// component (a network round trip each on a share), so only the callers that need a
/// file's identity ask (Open, Save As, restore); the 2 s poll never does.
pub fn stat_all(
    paths: Vec<String>,
    canonical: bool,
    is_allowed: impl Fn(&Path) -> bool + Send + Sync + 'static,
) -> Vec<FileStat> {
    stat_all_within(paths, STAT_BUDGET, canonical, is_allowed)
}

/// [`stat_all`] with the time budget injected, for the tests.
pub fn stat_all_within(
    mut paths: Vec<String>,
    budget: Duration,
    canonical: bool,
    is_allowed: impl Fn(&Path) -> bool + Send + Sync + 'static,
) -> Vec<FileStat> {
    let over = paths.split_off(paths.len().min(MAX_STAT_PATHS));
    let answers = run_bounded(paths.clone(), budget, move |path| {
        stat_one(path, canonical, &is_allowed)
    });
    paths
        .into_iter()
        .zip(answers)
        .map(|(path, answer)| answer.unwrap_or_else(|| FileStat::unavailable(path)))
        .chain(over.into_iter().map(FileStat::unavailable))
        .collect()
}

fn stat_one(path: &str, canonical: bool, is_allowed: &impl Fn(&Path) -> bool) -> FileStat {
    // Symlinks are followed: the document's identity is the file the user
    // opened through the link, and that is what a save rewrites.
    stat_one_with(path, canonical, is_allowed, |path| std::fs::metadata(path))
}

/// [`stat_one`] with the metadata call injected, so the error cases can be tested.
fn stat_one_with(
    path: &str,
    canonical: bool,
    is_allowed: &impl Fn(&Path) -> bool,
    metadata: impl Fn(&Path) -> io::Result<Metadata>,
) -> FileStat {
    let path = path.to_owned();
    if !is_allowed(Path::new(&path)) {
        return FileStat {
            path,
            ..FileStat::default()
        };
    }
    match metadata(Path::new(&path)) {
        Ok(meta) => of_metadata(path, &meta, canonical),
        // Missing, or unreadable because a parent directory lost its
        // permissions; either way there is nothing to report.
        Err(err) if is_absent(err.kind()) => FileStat {
            path,
            allowed: true,
            ..FileStat::default()
        },
        // Anything else is the share answering that it cannot answer — a soft mount's
        // ETIMEDOUT, a host that is down, an I/O error. That is unknown, never gone: read
        // as "missing", the poll would mark the tab deleted and a save would write over
        // the file without its changed-on-disk question.
        Err(_) => FileStat::unavailable(path),
    }
}

/// The errors of a stat that say the path is not there (or cannot be, as named).
fn is_absent(kind: io::ErrorKind) -> bool {
    matches!(
        kind,
        io::ErrorKind::NotFound
            | io::ErrorKind::NotADirectory
            | io::ErrorKind::PermissionDenied
            | io::ErrorKind::InvalidFilename
    )
}

// --- the time budget ----------------------------------------------------------

/// The worker threads whose caller stopped waiting, by path. While a path is in
/// here its share is known to be hung, and a new request for it answers "unknown"
/// at once instead of leaving one more thread behind every 2 s.
struct Abandoned {
    by_path: BTreeMap<String, usize>,
    total: usize,
}

static ABANDONED: Mutex<Abandoned> = Mutex::new(Abandoned {
    by_path: BTreeMap::new(),
    total: 0,
});

fn abandoned() -> MutexGuard<'static, Abandoned> {
    // Nothing in here can be left half-updated by a panic.
    ABANDONED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// One worker's two flags, both read and written under [`ABANDONED`]'s lock so a
/// worker that finishes just as its caller gives up cannot leave its path marked
/// hung for ever.
#[derive(Default)]
struct Flags {
    done: AtomicBool,
    abandoned: AtomicBool,
}

/// Runs `work` for every key, each on a thread of its own, and waits at most
/// `budget` for all of them together. Answers one entry per key, in order: the
/// result, or `None` for a key that did not answer in time — or that was not even
/// tried, because a thread from an earlier call is still stuck on it.
///
/// A thread that does not answer in time is left to finish on its own (a blocked
/// `stat` cannot be cancelled) and its result is dropped. Repeated keys are run once.
pub fn run_bounded<R, F>(keys: Vec<String>, budget: Duration, work: F) -> Vec<Option<R>>
where
    R: Clone + Send + 'static,
    F: Fn(&str) -> R + Send + Sync + 'static,
{
    let deadline = Instant::now() + budget;
    let work = Arc::new(work);
    let (tx, rx) = mpsc::channel::<(usize, R)>();

    // The first position of every distinct key, and where each key's answer goes.
    let mut first: HashMap<&str, usize> = HashMap::new();
    let slot: Vec<usize> = keys
        .iter()
        .enumerate()
        .map(|(at, key)| *first.entry(key.as_str()).or_insert(at))
        .collect();

    let mut running: Vec<(usize, Arc<Flags>)> = Vec::new();
    for (at, key) in keys.iter().enumerate() {
        if slot[at] != at {
            continue;
        }
        {
            let stuck = abandoned();
            if stuck.by_path.contains_key(key) || stuck.total >= MAX_ABANDONED {
                continue;
            }
        }
        let flags = Arc::new(Flags::default());
        let (key_owned, flags_worker, tx, work) = (
            key.clone(),
            Arc::clone(&flags),
            tx.clone(),
            Arc::clone(&work),
        );
        let spawned = std::thread::Builder::new()
            .name("gedit-stat".into())
            .spawn(move || {
                // Dropped on unwind as well, so a panicking `work` cannot leave its
                // path marked hung.
                let finished = Finish(&key_owned, &flags_worker);
                let answer = work(&key_owned);
                drop(finished);
                let _ = tx.send((at, answer));
            });
        if spawned.is_ok() {
            running.push((at, flags));
        }
    }
    drop(tx);

    let mut answers: Vec<Option<R>> = vec![None; keys.len()];
    let mut waiting = running.len();
    while waiting > 0 {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok((at, answer)) => {
                answers[at] = Some(answer);
                waiting -= 1;
            }
            // Out of time, or every sender is gone (a worker panicked).
            Err(_) => break,
        }
    }

    if waiting > 0 {
        let mut stuck = abandoned();
        for (at, flags) in &running {
            if answers[*at].is_none() && !flags.done.load(Ordering::Relaxed) {
                flags.abandoned.store(true, Ordering::Relaxed);
                *stuck.by_path.entry(keys[*at].clone()).or_insert(0) += 1;
                stuck.total += 1;
            }
        }
    }

    (0..keys.len())
        .map(|at| answers[slot[at]].clone())
        .collect()
}

/// A worker's last step: a path its caller gave up on is not hung any more.
struct Finish<'a>(&'a str, &'a Flags);

impl Drop for Finish<'_> {
    fn drop(&mut self) {
        let Finish(key, flags) = *self;
        let mut stuck = abandoned();
        flags.done.store(true, Ordering::Relaxed);
        if flags.abandoned.load(Ordering::Relaxed) {
            stuck.total -= 1;
            if let Some(count) = stuck.by_path.get_mut(key) {
                *count -= 1;
                if *count == 0 {
                    stuck.by_path.remove(key);
                }
            }
        }
    }
}

/// Whether a thread from an earlier call is still stuck on `key`.
#[cfg(test)]
fn is_stuck(key: &str) -> bool {
    abandoned().by_path.contains_key(key)
}

fn of_metadata(path: String, meta: &Metadata, with_canonical: bool) -> FileStat {
    let is_dir = meta.is_dir();
    let readonly = not_writable(&path, meta);
    let canonical = (with_canonical && !is_dir)
        .then(|| canonical_of(&path))
        .flatten();
    FileStat {
        path,
        allowed: true,
        exists: true,
        is_dir,
        mtime_ms: mtime_ms(meta),
        size: (!is_dir).then_some(meta.len()),
        readonly,
        unavailable: false,
        canonical,
    }
}

/// [`FileStat::canonical`] for a path that was just stat-ed. It runs on the same
/// worker thread as the stat, so the time budget of [`run_bounded`] covers it too.
fn canonical_of(path: &str) -> Option<String> {
    let resolved = std::fs::canonicalize(path).ok()?;
    crate::paths::plain(&resolved).to_str().map(str::to_owned)
}

/// `SystemTime` as epoch milliseconds. A modification time before 1970 is
/// negative rather than clamped, so a comparison with the stored stamp still sees
/// a change.
fn mtime_ms(meta: &Metadata) -> Option<f64> {
    let modified = meta.modified().ok()?;
    Some(match modified.duration_since(UNIX_EPOCH) {
        Ok(since) => since.as_secs_f64() * 1000.0,
        Err(before) => -(before.duration().as_secs_f64() * 1000.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gedit-stat-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.nc"), "G0 X0\n").unwrap();
        fs::write(dir.join("secret.nc"), "G0 X1\n").unwrap();
        dir
    }

    fn s(path: &Path) -> String {
        path.to_str().unwrap().to_owned()
    }

    /// Everything under the scratch directory is allowed except `secret.nc`.
    fn allow_except_secret(path: &Path) -> bool {
        path.file_name().is_none_or(|name| name != "secret.nc")
    }

    /// Makes `path` read-only, or writable again, the way this platform says it.
    ///
    /// `Permissions::set_readonly` is the one way of saying it that means the same thing
    /// on all three targets: it clears the write bits on Unix and sets (or clears)
    /// `FILE_ATTRIBUTE_READONLY` on Windows. Clearing it widens a Unix file to `0o666`
    /// rather than putting `0o644` back, which is of no consequence to a file in a
    /// scratch directory that the test then deletes.
    fn set_readonly(path: &Path, readonly: bool) {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(readonly);
        fs::set_permissions(path, permissions).unwrap();
    }

    /// The single answer for one path.
    fn one(path: String) -> FileStat {
        let mut stats = stat_all(vec![path], true, allow_except_secret);
        assert_eq!(stats.len(), 1);
        stats.remove(0)
    }

    #[test]
    fn answers_one_entry_per_path_in_order() {
        let dir = scratch_dir("order");
        let paths = vec![s(&dir.join("a.nc")), s(&dir.join("gone.nc")), s(&dir)];
        let stats = stat_all(paths.clone(), true, allow_except_secret);
        assert_eq!(
            stats.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
            paths
        );
        assert_eq!(stat_all(vec![], true, allow_except_secret), vec![]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_an_allowed_file() {
        let dir = scratch_dir("file");
        let stat = one(s(&dir.join("a.nc")));
        assert!(stat.allowed && stat.exists && !stat.is_dir && !stat.readonly);
        assert_eq!(stat.size, Some(6));
        // Within an hour of now, so the clock source is plausible.
        let now_ms = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            * 1000.0;
        let mtime = stat.mtime_ms.expect("no mtime");
        assert!(
            (now_ms - mtime).abs() < 3_600_000.0,
            "mtime {mtime} vs now {now_ms}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// A forbidden path must not leak whether it exists.
    #[test]
    fn a_forbidden_path_is_answered_empty() {
        let dir = scratch_dir("forbidden");
        let path = s(&dir.join("secret.nc"));
        let stat = one(path.clone());
        assert_eq!(
            stat,
            FileStat {
                path,
                ..FileStat::default()
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_path_is_allowed_but_absent() {
        let dir = scratch_dir("missing");
        let path = s(&dir.join("gone.nc"));
        let stat = one(path.clone());
        assert_eq!(
            stat,
            FileStat {
                path,
                allowed: true,
                ..FileStat::default()
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_reports_no_size() {
        let dir = scratch_dir("dir");
        let stat = one(s(&dir.join("sub")));
        assert!(stat.allowed && stat.exists && stat.is_dir);
        assert_eq!(stat.size, None);
        assert!(stat.mtime_ms.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    /// B1 A1. Two spellings of one file must answer one `canonical`: a `..` hop and a
    /// symlink both reach `a.nc`, and a tab opened through either must find the other.
    #[cfg(unix)]
    #[test]
    fn canonical_is_the_same_for_every_spelling_of_a_file() {
        let dir = scratch_dir("canonical");
        std::os::unix::fs::symlink(dir.join("a.nc"), dir.join("link.nc")).unwrap();
        let direct = one(s(&dir.join("a.nc")));
        let through_link = one(s(&dir.join("link.nc")));
        let through_dots = one(s(&dir.join("sub").join("..").join("a.nc")));
        let canonical = direct.canonical.clone().expect("no canonical path");
        assert!(canonical.ends_with("a.nc"), "{canonical}");
        assert_eq!(through_link.canonical.as_deref(), Some(canonical.as_str()));
        assert_eq!(through_dots.canonical.as_deref(), Some(canonical.as_str()));
        // The answer to the stat itself is untouched: the path is the one passed in.
        assert_eq!(through_link.path, s(&dir.join("link.nc")));
        // Another file is another identity.
        let other = one(s(&dir.join("secret.nc")));
        assert_ne!(other.canonical, direct.canonical);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn canonical_is_empty_for_a_directory_a_missing_path_and_a_refusal() {
        let dir = scratch_dir("canonical-none");
        assert_eq!(one(s(&dir.join("sub"))).canonical, None);
        assert_eq!(one(s(&dir.join("gone.nc"))).canonical, None);
        assert_eq!(one(s(&dir.join("secret.nc"))).canonical, None);
        let _ = fs::remove_dir_all(&dir);
    }

    /// B1 CODE-07. The 2 s poll stats every open file; resolving each path again on
    /// every tick is a round trip per folder level on a share. Only a call that asks
    /// gets the canonical path.
    #[test]
    fn canonical_is_only_resolved_when_the_call_asks_for_it() {
        let dir = scratch_dir("canonical-option");
        let path = s(&dir.join("a.nc"));
        let plain = stat_all(vec![path.clone()], false, allow_except_secret).remove(0);
        assert!(plain.exists && plain.allowed, "{plain:?}");
        assert_eq!(plain.canonical, None);
        // Everything else about the answer is the same.
        let asked = stat_all(vec![path], true, allow_except_secret).remove(0);
        assert!(asked.canonical.is_some());
        assert_eq!(
            FileStat {
                canonical: None,
                ..asked
            },
            plain
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn canonical_is_serialized_in_camel_case() {
        let dir = scratch_dir("canonical-json");
        let json = serde_json::to_value(one(s(&dir.join("a.nc")))).unwrap();
        assert!(json["canonical"].is_string(), "{json}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The flag the padlock, the read-only banner and "Save goes to Save As" read
    /// (AD-23) — on **every** platform gEdit ships on, which is why this one is not
    /// gated.
    ///
    /// [`not_writable`] has two bodies, and the `#[cfg(not(unix))]` one is the body that
    /// runs on Windows. Both read-only tests used to be `#[cfg(unix)]`, so the Windows
    /// leg of an M7 feature was described in a doc comment and executed by nothing: the
    /// whole of AD-23 could have answered `false` on Windows and all three CI legs would
    /// still have been green.
    #[test]
    fn a_read_only_file_is_flagged() {
        let dir = scratch_dir("readonly");
        let file = dir.join("a.nc");
        set_readonly(&file, true);
        let stat = one(s(&file));
        assert!(stat.readonly, "{stat:?}");
        set_readonly(&file, false);
        let stat = one(s(&file));
        assert!(!stat.readonly, "{stat:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// G8 M7. `Permissions::readonly()` asks "may **nobody** write this file", not
    /// "may **I**". On a shop share the commonest read-only program is one at mode
    /// 0644 owned by another operator, by root, or exported read-only by the server —
    /// and every one of those answered `false`, so AD-23 opened it unlocked, let the
    /// user type into it all shift, and found out at the write.
    ///
    /// A file owned by a second uid cannot be made here, but the discrepancy does not
    /// need one: a file **this user owns** at mode 0424 is writable by its group and
    /// not by its owner, and on Unix the owner's bits are the ones that apply to the
    /// owner. So `permissions().readonly()` says `false` ("somebody may write it")
    /// while the process may not write a byte of it — the same disagreement, the same
    /// direction, reproducible. Root bypasses the check, so the case is skipped there.
    #[cfg(unix)]
    #[test]
    fn readonly_answers_whether_this_user_may_write_it() {
        use std::os::unix::fs::PermissionsExt;
        // SAFETY: `geteuid` takes nothing, touches nothing and cannot fail.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let dir = scratch_dir("writable");
        let file = dir.join("a.nc");

        // Writable by its owner, which is us.
        assert!(!one(s(&file)).readonly);

        // Writable by the group and not by the owner. `readonly()` answers false here.
        fs::set_permissions(&file, fs::Permissions::from_mode(0o424)).unwrap();
        let meta = fs::metadata(&file).unwrap();
        assert!(
            !meta.permissions().readonly(),
            "the case this test exists for is not set up"
        );
        assert!(
            fs::OpenOptions::new().write(true).open(&file).is_err(),
            "the file really has to be one we cannot write"
        );
        assert!(
            one(s(&file)).readonly,
            "a file we may not write reads as writable"
        );

        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        // A directory keeps the attribute answer: `readonly` is about documents.
        assert!(!one(s(&dir.join("sub"))).readonly);
        let _ = fs::remove_dir_all(&dir);
    }

    // --- the time budget -----------------------------------

    use std::sync::atomic::AtomicUsize;

    /// The scope predicate of these tests, hanging on every `hung*` path until
    /// `release` is set — the way `stat` blocks on a share whose server has gone away
    /// — and counting how often it was asked about one.
    fn hanging(
        release: Arc<AtomicBool>,
        asked: Arc<AtomicUsize>,
    ) -> impl Fn(&Path) -> bool + Send + Sync + 'static {
        move |path| {
            let hung = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("hung"));
            if hung {
                asked.fetch_add(1, Ordering::SeqCst);
                let until = Instant::now() + Duration::from_secs(10);
                while !release.load(Ordering::SeqCst) && Instant::now() < until {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            allow_except_secret(path)
        }
    }

    /// Waits for the thread a test left behind to finish and unmark its path.
    fn wait_until_unstuck(path: &str) {
        let until = Instant::now() + Duration::from_secs(10);
        while is_stuck(path) && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!is_stuck(path), "{path} is still marked hung");
    }

    const SHORT: Duration = Duration::from_millis(300);

    /// The defect: one hung share held the whole answer — and, on the main thread,
    /// the whole UI — for as long as the OS retried. Now the others answer and the
    /// hung one is unknown, never "gone".
    #[test]
    fn a_hung_path_is_unavailable_and_the_others_still_answer() {
        let dir = scratch_dir("hung");
        let (release, asked) = (Arc::new(AtomicBool::new(false)), Arc::default());
        let hung = s(&dir.join("hung.nc"));
        let paths = vec![s(&dir.join("a.nc")), hung.clone(), s(&dir.join("sub"))];

        let started = Instant::now();
        let stats = stat_all_within(paths, SHORT, true, hanging(release.clone(), asked));
        let took = started.elapsed();
        release.store(true, Ordering::SeqCst);

        assert!(took < Duration::from_secs(3), "the call took {took:?}");
        assert!(stats[0].allowed && stats[0].exists && !stats[0].unavailable);
        assert_eq!(stats[1], FileStat::unavailable(hung.clone()));
        // Unknown is not gone: nothing a caller could read as "deleted".
        assert!(!stats[1].allowed && !stats[1].exists);
        assert!(stats[2].allowed && stats[2].is_dir && !stats[2].unavailable);
        wait_until_unstuck(&hung);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The poll asks every 2 s. A path whose thread from the last call is still stuck
    /// answers "unknown" at once instead of leaving one more thread behind each time —
    /// and is tried again as soon as that thread has come back.
    #[test]
    fn a_path_that_is_still_hung_is_not_tried_again() {
        let dir = scratch_dir("stuck");
        let hung_file = dir.join("hung-stuck.nc");
        fs::write(&hung_file, "G0\n").unwrap();
        let hung = s(&hung_file);
        let release = Arc::new(AtomicBool::new(false));
        let asked = Arc::new(AtomicUsize::new(0));

        let first = stat_all_within(
            vec![hung.clone()],
            SHORT,
            true,
            hanging(release.clone(), asked.clone()),
        );
        assert!(first[0].unavailable);
        assert!(is_stuck(&hung));

        let started = Instant::now();
        let second = stat_all_within(
            vec![hung.clone()],
            SHORT,
            true,
            hanging(release.clone(), asked.clone()),
        );
        assert!(second[0].unavailable);
        assert_eq!(
            asked.load(Ordering::SeqCst),
            1,
            "a second thread was started"
        );
        assert!(
            started.elapsed() < SHORT,
            "the second call waited for nothing"
        );

        release.store(true, Ordering::SeqCst);
        wait_until_unstuck(&hung);
        let third = stat_all_within(
            vec![hung.clone()],
            SHORT,
            true,
            hanging(release, asked.clone()),
        );
        assert!(third[0].allowed && third[0].exists && !third[0].unavailable);
        assert_eq!(asked.load(Ordering::SeqCst), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Past [`MAX_STAT_PATHS`] nothing is stat'd, and the answer still has one entry
    /// per input so the caller's zip stays aligned.
    #[test]
    fn a_call_answers_at_most_max_stat_paths() {
        let dir = scratch_dir("cap");
        let paths: Vec<String> = (0..MAX_STAT_PATHS + 2)
            .map(|n| s(&dir.join(format!("gone{n}.nc"))))
            .collect();
        let stats = stat_all(paths.clone(), true, allow_except_secret);
        assert_eq!(stats.len(), paths.len());
        assert!(stats[..MAX_STAT_PATHS]
            .iter()
            .all(|f| f.allowed && !f.unavailable));
        assert_eq!(
            stats[MAX_STAT_PATHS],
            FileStat::unavailable(paths[MAX_STAT_PATHS].clone())
        );
        assert!(stats[MAX_STAT_PATHS + 1].unavailable);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_repeated_path_is_stat_once_and_answered_everywhere() {
        let dir = scratch_dir("repeat");
        let a = s(&dir.join("a.nc"));
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        let stats = stat_all(vec![a.clone(), a.clone(), a], true, move |path| {
            counted.fetch_add(1, Ordering::SeqCst);
            allow_except_secret(path)
        });
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(stats[0].exists && stats[0] == stats[1] && stats[1] == stats[2]);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The poll and a save can stat the same file at the same moment. Only a path a
    /// caller has *given up on* is skipped, so neither of them may see "unknown" for a
    /// file that answers — a save would then ask about a change that did not happen.
    #[test]
    fn concurrent_calls_for_one_path_all_answer() {
        let dir = scratch_dir("concurrent");
        let a = s(&dir.join("a.nc"));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let a = a.clone();
                std::thread::spawn(move || stat_all(vec![a], true, allow_except_secret).remove(0))
            })
            .collect();
        for worker in workers {
            let stat = worker.join().unwrap();
            assert!(stat.allowed && stat.exists && !stat.unavailable, "{stat:?}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// Review: a stat that failed quickly with anything but "not there" was
    /// reported as `allowed: true, exists: false`, so a soft mount's ETIMEDOUT or a
    /// host that is down marked the tab deleted and let a save skip its question.
    #[test]
    fn a_stat_error_that_is_not_absence_is_unavailable() {
        let path = "/Volumes/dnc/a.nc";
        let failing = |kind: io::ErrorKind| {
            stat_one_with(path, true, &|_: &Path| true, move |_| {
                Err(io::Error::from(kind))
            })
        };
        for kind in [
            io::ErrorKind::NotFound,
            io::ErrorKind::NotADirectory,
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::InvalidFilename,
        ] {
            assert_eq!(
                failing(kind),
                FileStat {
                    path: path.to_owned(),
                    allowed: true,
                    ..FileStat::default()
                },
                "{kind:?}"
            );
        }
        for kind in [
            io::ErrorKind::TimedOut,
            io::ErrorKind::NetworkUnreachable,
            io::ErrorKind::HostUnreachable,
            io::ErrorKind::NotConnected,
            io::ErrorKind::Interrupted,
            io::ErrorKind::Other,
        ] {
            assert_eq!(
                failing(kind),
                FileStat::unavailable(path.to_owned()),
                "{kind:?}"
            );
        }
        // An I/O error the way the OS reports it (EIO has no kind of its own).
        #[cfg(unix)]
        assert_eq!(
            stat_one_with(path, true, &|_: &Path| true, |_| Err(
                io::Error::from_raw_os_error(libc::EIO)
            )),
            FileStat::unavailable(path.to_owned())
        );
    }

    /// The wire shape `commands.ts` reads.
    #[test]
    fn unavailable_is_serialized_in_camel_case() {
        let json = serde_json::to_value(FileStat::unavailable("/nc/a.nc".into())).unwrap();
        assert_eq!(json["unavailable"], true);
        assert_eq!(json["allowed"], false);
        assert_eq!(json["exists"], false);
        assert_eq!(json["mtimeMs"], serde_json::Value::Null);
    }
}

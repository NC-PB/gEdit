//! `files_backup`: the copy that is made **before** a save overwrites a file
//! (plan §7.10, AD-21).
//!
//! The one rule this command exists for: after a save of an existing file, the bytes
//! that were on disk before it are still somewhere. `fileOps.save` calls this
//! immediately before the in-place write, and a failure here is a question to the
//! user ("Save without a backup?"), never something that is swallowed.
//!
//! Documents are still written **in place** (P1 AD-7): on a shop share the file's
//! identity and its ACL are what the DNC drip-feeder and the CAM folder watcher see,
//! so gEdit may not replace the file with a fresh one. The backup is therefore a
//! separate copy rather than a rename of the original.
//!
//! Where the copy goes is `files.backup`:
//!
//! - [`BackupMode::History`] (the default) — `<data>/backups/<fnv32 of the folder>/
//!   <file name>/<UTC yyyymmdd-hhmmss.mmm>-<file name>`, keeping `files.backupCount`
//!   of them. The shop folder stays clean, which matters because a folder watcher
//!   that picks up `*.bak` would post the backup to a machine.
//! - [`BackupMode::Sibling`] — `<path>.bak`, overwritten. Refused when that path is a
//!   symlink or a directory, so a save can never follow a link out of the folder.
//! - [`BackupMode::Off`] — nothing is copied and the save goes ahead.
//!
//! Rust reads the two settings from `settings.json` itself (the P1 AD-8 pattern, as
//! `scripts::settings` does): they are never arguments of the command, so a webview
//! bug cannot turn backups off for one save.
//!
//! ## The three rules that make a backup worth having
//!
//! **1. It is finished before the command answers.** The copy is flushed to the disk
//! and renamed into place inside [`copy_atomic`], so when `fileOps.save` gets its
//! answer the previous bytes are durable. A copy that were merely *started* would
//! give a save the go-ahead while the only surviving version of the file is still in
//! a page cache that the crash this protects against would throw away.
//!
//! **2. It never damages what is already there.** Every copy goes to a temp file in
//! the target's own folder and is renamed over the target only once it is whole, so
//! a copy that fails halfway — a full disk is the ordinary case — leaves the previous
//! `<path>.bak` (or the previous history entries) exactly as they were. A plain
//! `fs::copy` would truncate the one good backup and then fail. History entries are
//! pruned **after** a successful write for the same reason: a failed backup may never
//! be the thing that makes room by deleting a good one.
//!
//! **3. It never touches the file it is copying.** The source is opened read-only and
//! nothing else here writes to the source's folder except the short-lived temp file
//! of `sibling` mode. A backup that could fail the save it precedes would be worse
//! than no backup at all.
//!
//! What this file cannot enforce is the **order**: that the caller backs up before it
//! writes. `files_backup` copies whatever is on disk at the moment it is called, so
//! calling it after the save would faithfully copy the new bytes over the old backup.
//! `fileOps.save` (WP7.3) owns that order, and `m7-backup` proves it end to end.

use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::config;
use crate::paths::{self, AppDirs, SETTINGS_FILE_NAME};

/// What `files.backup` may be. The three names are the wire values of the setting
/// and are checked against `core/settings/schema.ts` in the tests below.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BackupMode {
    Off,
    Sibling,
    #[default]
    History,
}

impl BackupMode {
    /// The setting's value, or [`BackupMode::default`] for anything else — an
    /// unreadable `settings.json`, a hand edit with a typo, a value from a newer
    /// build. Defaulting to `History` is deliberate: the failure mode of an
    /// unknown value has to be "a backup too many", never "no backup".
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some(text) if text == Self::Off.as_str() => Self::Off,
            Some(text) if text == Self::Sibling.as_str() => Self::Sibling,
            _ => Self::History,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Sibling => "sibling",
            Self::History => "history",
        }
    }
}

/// The settings keys this module reads (§7.11).
pub const KEY_MODE: &str = "files.backup";
pub const KEY_COUNT: &str = "files.backupCount";

/// `files.backupCount` when the setting is absent or unusable (§7.11).
pub const DEFAULT_BACKUP_COUNT: u32 = 5;
/// The range §7.11 gives the setting. A hand-edited file is clamped into it, so the
/// history can neither be emptied by a `0` nor grow without bound.
pub const MIN_BACKUP_COUNT: u32 = 1;
pub const MAX_BACKUP_COUNT: u32 = 50;

/// What a `sibling` backup is called: the document's own name plus this.
///
/// Deliberately its own constant and not [`crate::config::BAK_SUFFIX`], which names
/// the rescue copy of an app JSON file gEdit could not parse. The two spell the same
/// four characters today and mean different things: one is the user's backup of his
/// program, the other is gEdit getting its own broken file out of the way.
pub const SIBLING_SUFFIX: &str = ".bak";

/// `yyyymmdd-hhmmss.mmm`: what a history entry's name starts with.
const STAMP_LEN: usize = 19;

/// How many backups of one file may carry the same millisecond before the write is
/// given up on. One more than the most that can be kept, so a free name always
/// exists while pruning works.
const MAX_SAME_MILLISECOND: u32 = MAX_BACKUP_COUNT + 1;

/// Clamps whatever `settings.json` holds into [`MIN_BACKUP_COUNT`]..=[`MAX_BACKUP_COUNT`].
pub fn backup_count(value: Option<i64>) -> u32 {
    match value {
        Some(n) => (n.clamp(MIN_BACKUP_COUNT as i64, MAX_BACKUP_COUNT as i64)) as u32,
        None => DEFAULT_BACKUP_COUNT,
    }
}

/// What this module needs out of `settings.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackupSettings {
    pub mode: BackupMode,
    pub count: u32,
}

/// Written out rather than derived: a derived `count` would be **0**, and a 0 tells
/// [`prune`] to keep nothing — including the copy that was just made. The default of
/// a thing that exists to keep files may not be "keep none".
impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            mode: BackupMode::default(),
            count: DEFAULT_BACKUP_COUNT,
        }
    }
}

impl BackupSettings {
    /// Reads `<config>/settings.json`. A missing or unusable file gives the
    /// defaults — `history`, five deep — because "the settings file is broken" must
    /// never quietly mean "no backup".
    pub fn load(dirs: &AppDirs) -> Self {
        let file = config::read_json_object(&dirs.settings_file(), SETTINGS_FILE_NAME);
        Self::from_object(&file.value)
    }

    /// The rules above against an already-parsed settings object, so they can be
    /// tested without writing a file.
    pub fn from_object(settings: &Map<String, Value>) -> Self {
        Self {
            mode: BackupMode::parse(settings.get(KEY_MODE).and_then(Value::as_str)),
            count: backup_count(settings.get(KEY_COUNT).and_then(Value::as_i64)),
        }
    }
}

/// Copies `path` aside according to `files.backup` and answers with where it went,
/// or `Ok(None)` when there was nothing to copy (mode `off`, or a file that does not
/// exist yet, which is the Save As case).
///
/// Errors unless `fs_scope().is_allowed(path)`: the only paths that ever reach this
/// command are ones the user opened, so it can never be used to copy an arbitrary
/// file into a folder the webview can read.
#[tauri::command]
pub fn files_backup(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let scope = app.fs_scope();
    backup_allowed(
        &paths::app_dirs(&app)?,
        Path::new(&path),
        SystemTime::now(),
        |path| scope.is_allowed(path),
    )
}

/// The command's body with the scope predicate injected, the way `files::stat_all`
/// takes one, so the refusal is tested against a real `tauri::fs::Scope` rather than
/// described twice.
///
/// The check comes before everything the path could reach: `settings.json` is not
/// read and no folder is made for a file the user never opened. (`app_dirs` above is
/// only the path resolver, and knows nothing about `path`.)
pub fn backup_allowed(
    dirs: &AppDirs,
    source: &Path,
    now: SystemTime,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<Option<String>, String> {
    if !is_allowed(source) {
        return Err(format!("{} is not in the file scope", source.display()));
    }
    backup(dirs, BackupSettings::load(dirs), source, now)
}

/// The command's body with the folders, the settings and the clock injected, so the
/// whole of AD-21 can be tested against a scratch directory.
pub fn backup(
    dirs: &AppDirs,
    settings: BackupSettings,
    source: &Path,
    now: SystemTime,
) -> Result<Option<String>, String> {
    if settings.mode == BackupMode::Off {
        return Ok(None);
    }
    match fs::metadata(source) {
        // Save As, or a file a CAM post has since removed: there is nothing to keep
        // and the save can go ahead without asking the user anything.
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("{}: {err}", source.display())),
        Ok(metadata) if !metadata.is_file() => {
            return Err(format!("{}: not a regular file", source.display()))
        }
        Ok(_) => {}
    }
    let target = match settings.mode {
        // Answered at the top. Spelled out rather than `unreachable!`, because a
        // command a save is waiting for may not end in a panic however it is
        // refactored: the worst this arm can do is skip a backup.
        BackupMode::Off => return Ok(None),
        BackupMode::Sibling => sibling_target(source)?,
        BackupMode::History => history_target(dirs, source, now)?,
    };
    copy_atomic(source, &target)?;
    if settings.mode == BackupMode::History {
        // The copy is on disk. Pruning is housekeeping from here on: if it fails,
        // the user still has this backup and one more old one than he asked for,
        // which is the harmless direction to fail in.
        if let Some(folder) = target.parent() {
            if let Err(err) = prune(folder, settings.count) {
                eprintln!("gEdit: {err}");
            }
        }
    }
    Ok(Some(target.to_string_lossy().into_owned()))
}

// --- sibling mode ---------------------------------------------------------

/// `<path>.bak`, refused when something that is not a plain file is already there.
///
/// A symlink is refused because following it would write the backup wherever the
/// link points — outside the folder the user granted, possibly over a file that is
/// not a backup at all. A directory is refused because the copy would fail anyway,
/// and it is worth saying why.
///
/// The check is a check, not the barrier: a link that appears between it and the
/// copy is still not followed, because [`copy_atomic`] finishes with a `rename` onto
/// the name, and `rename` replaces a symbolic link rather than writing through it.
/// What the check buys is telling the user *why* nothing was copied.
fn sibling_target(source: &Path) -> Result<PathBuf, String> {
    let mut name = source
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| format!("{}: is not a file", source.display()))?
        .to_os_string();
    name.push(SIBLING_SUFFIX);
    let target = source.with_file_name(name);
    // `symlink_metadata` does not follow the link, which is the whole point.
    match fs::symlink_metadata(&target) {
        Ok(existing) if existing.file_type().is_symlink() => Err(format!(
            "{}: is a symbolic link, so it is not overwritten",
            target.display()
        )),
        Ok(existing) if existing.is_dir() => Err(format!(
            "{}: is a directory, so it is not overwritten",
            target.display()
        )),
        _ => Ok(target),
    }
}

// --- history mode ---------------------------------------------------------

/// FNV-1a over the folder's normalized (and, where the platform folds case, lowered)
/// path, as eight lowercase hex digits.
///
/// It names a folder, so it has to be short and legal on every platform; it is not a
/// checksum of anything and nothing is verified against it. A collision between two
/// source folders means their two histories share a parent — the `<file name>` level
/// below still separates them unless the names collide too, and even then the entries
/// are distinct files with distinct stamps.
pub fn folder_key(folder: &Path) -> String {
    let normalized: PathBuf = folder.components().collect();
    let text = normalized.to_string_lossy();
    let text = if paths::FOLD_CASE {
        text.to_lowercase()
    } else {
        text.into_owned()
    };
    let mut hash: u32 = 0x811c_9dc5;
    for byte in text.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

/// `<UTC yyyymmdd-hhmmss.mmm>` (AD-21). UTC, so the name keeps sorting in order
/// across a daylight-saving change, and to the millisecond, because a script that
/// saves twice in a row would otherwise collide every time.
pub fn stamp(time: SystemTime) -> String {
    let millis = match time.duration_since(UNIX_EPOCH) {
        Ok(since) => since.as_millis() as i128,
        // A clock set before 1970. The name only has to be unique and sortable, and
        // `unique_name` makes it unique; this keeps it well-formed.
        Err(_) => 0,
    };
    let day = millis.div_euclid(86_400_000) as i64;
    let in_day = millis.rem_euclid(86_400_000) as u64;
    let (year, month, date) = civil_from_days(day);
    let (hour, minute, second, milli) = (
        in_day / 3_600_000,
        in_day / 60_000 % 60,
        in_day / 1_000 % 60,
        in_day % 1_000,
    );
    format!("{year:04}{month:02}{date:02}-{hour:02}{minute:02}{second:02}.{milli:03}")
}

/// Days since 1970-01-01 to a civil date, by Howard Hinnant's `civil_from_days`
/// (the algorithm behind every `<chrono>` implementation). Written out rather than
/// pulled in: one date conversion is not worth a dependency, a license entry and a
/// row in the bundle check.
fn civil_from_days(days: i64) -> (i64, u64, u64) {
    // Shift the epoch to 0000-03-01, so a leap day is always the last day of a year.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097); // [0, 146096]
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365; // [0, 399]
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100); // [0, 365]
    let month_position = (5 * day_of_year + 2) / 153; // [0, 11], March = 0
    let date = (day_of_year - (153 * month_position + 2) / 5 + 1) as u64; // [1, 31]
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u64;
    (year + i64::from(month <= 2), month, date)
}

/// `<data>/backups/<fnv32 of the folder>/<file name>/`, created and narrowed to the
/// owner on Unix at every level.
///
/// The folders hold whole programs, so `paths::restrict` is applied to each level
/// here and not only to the `backups` root at startup: a level created later by this
/// call would otherwise take whatever the umask says (standing rule 10). It is
/// re-applied on a folder that was already there too, because an older build or a
/// careless umask may have left one open.
///
/// Narrowing the mode is **best effort**; creating the folder is not. A volume that
/// cannot express Unix permissions would otherwise be a volume on which no save ever
/// gets a backup, and what goes in here is the *previous version of a file the user
/// already has on disk*, under whatever permissions he keeps it.
fn history_dir(dirs: &AppDirs, source: &Path) -> Result<PathBuf, String> {
    let folder = source
        .parent()
        .filter(|folder| !folder.as_os_str().is_empty())
        .ok_or_else(|| format!("{}: has no folder", source.display()))?;
    let name = file_name(source)?;
    let root = dirs.backups_dir();
    let by_folder = root.join(folder_key(folder));
    let by_name = by_folder.join(name);
    for dir in [&root, &by_folder, &by_name] {
        fs::create_dir_all(dir).map_err(|err| format!("{}: {err}", dir.display()))?;
        if let Err(err) = paths::restrict(dir) {
            eprintln!("gEdit: could not narrow {}: {err}", dir.display());
        }
    }
    Ok(by_name)
}

/// The full path of the history entry to write now.
fn history_target(dirs: &AppDirs, source: &Path, now: SystemTime) -> Result<PathBuf, String> {
    let dir = history_dir(dirs, source)?;
    let name = file_name(source)?;
    unique_name(&dir, &stamp(now), name).ok_or_else(|| {
        format!(
            "{}: more than {MAX_SAME_MILLISECOND} backups in one millisecond",
            dir.display()
        )
    })
}

/// The document's own file name, as an `OsStr` so that a name which is not valid
/// UTF-8 is copied through exactly rather than through a replacement character.
fn file_name(source: &Path) -> Result<&OsStr, String> {
    match source.file_name() {
        Some(name) if !name.is_empty() && name != "." && name != ".." => Ok(name),
        _ => Err(format!("{}: is not a file", source.display())),
    }
}

/// `<stamp>-<name>`, or `<stamp>-<n>-<name>` when a backup of this file already
/// carries this millisecond.
///
/// Two gEdit instances saving the same file in the same millisecond could still pick
/// one name twice, between the test here and the rename: the loser's copy is replaced
/// by the winner's, which are the same bytes of the same file at the same moment.
fn unique_name(dir: &Path, stamp: &str, name: &OsStr) -> Option<PathBuf> {
    (0..=MAX_SAME_MILLISECOND).find_map(|n| {
        let mut file = OsString::from(if n == 0 {
            format!("{stamp}-")
        } else {
            format!("{stamp}-{n}-")
        });
        file.push(name);
        let candidate = dir.join(file);
        (!candidate.exists()).then_some(candidate)
    })
}

/// Splits a history entry's name into what it sorts by: the stamp, and the
/// same-millisecond counter. `None` for anything that is not one of ours, and those
/// are never deleted — a folder of the user's own is not this function's business.
///
/// `document` is the file name the folder holds backups of, which is what makes the
/// counter unambiguous: an entry is `<stamp>-<name>` or `<stamp>-<n>-<name>`, so the
/// remainder either **is** the name or is the name with `<n>-` in front of it.
/// Guessing it instead — "the digits up to the first dash" — read the counter out of
/// the user's own file name whenever that name began with digits and a dash, which is
/// ordinary in shop naming: `5-part.nc` reported counter 5 for its *first* backup of a
/// millisecond and counter 1 for its second, so `prune` sorted the older copy as the
/// newer one and deleted the wrong survivor (G8 M7).
fn sort_key<'a>(name: &'a str, document: &str) -> Option<(&'a str, u32)> {
    let bytes = name.as_bytes();
    if bytes.len() < STAMP_LEN + 1 {
        return None;
    }
    for (index, byte) in bytes[..STAMP_LEN].iter().enumerate() {
        let well_formed = match index {
            8 => *byte == b'-',
            15 => *byte == b'.',
            _ => byte.is_ascii_digit(),
        };
        if !well_formed {
            return None;
        }
    }
    if bytes[STAMP_LEN] != b'-' {
        return None;
    }
    // All of it is ASCII, so this cannot split a character in half.
    let (stamp, rest) = name.split_at(STAMP_LEN);
    Some((stamp, counter_of(&rest[1..], document)))
}

/// The `<n>` of `<n>-<document>`, or 0 when `rest` is the document's name itself.
///
/// A remainder that matches neither shape is 0 as well rather than `None`: the entry
/// still carries one of our stamps and is still ours to prune, and ordering it by the
/// stamp alone is exactly what this function did for every entry before. Only the
/// *order within one millisecond* is at stake here, never whether a file is deleted.
fn counter_of(rest: &str, document: &str) -> u32 {
    if rest == document {
        return 0;
    }
    rest.strip_suffix(document)
        .and_then(|head| head.strip_suffix('-'))
        .and_then(|digits| digits.parse::<u32>().ok())
        .filter(|n| (1..=MAX_SAME_MILLISECOND).contains(n))
        .unwrap_or(0)
}

/// Deletes everything in `dir` past the newest `keep` entries.
///
/// Called only after a copy has landed, so the entry that was just written is one of
/// the ones counted — `keep` is what the user asked to have, not what is left over
/// after making room.
///
/// `dir` is `<data>/backups/<fnv32 of the folder>/<file name>/`, so its own name is
/// the document's — which is what [`sort_key`] needs to tell our same-millisecond
/// counter from a number the user's file name happens to start with.
fn prune(dir: &Path, keep: u32) -> Result<(), String> {
    let document = dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut entries: Vec<(String, u32, PathBuf)> = fs::read_dir(dir)
        .map_err(|err| format!("{}: {err}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let (stamp, counter) = sort_key(&name, &document)?;
            Some((stamp.to_owned(), counter, entry.path()))
        })
        .collect();
    // Newest first: the stamp is fixed width and zero-padded, so it sorts by time.
    entries.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.cmp(&left.1)));
    let mut failures = Vec::new();
    for (_, _, path) in entries.into_iter().skip(keep as usize) {
        if let Err(err) = fs::remove_file(&path) {
            failures.push(format!("{}: {err}", path.display()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

// --- the copy itself ------------------------------------------------------

/// Makes each temp name unique within the process; the process id makes it unique
/// between processes.
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// Copies `source` onto `target` without ever leaving a half-written target: the
/// bytes go to a temp file in the target's **own** folder, are flushed to the disk,
/// and are renamed into place only once they are all there. A failure at any step
/// removes the temp file and leaves whatever was at `target` untouched.
///
/// [`crate::atomic::write_atomic`] does the same for the app's own small JSON files,
/// but it is given the bytes in memory. A document can be 50 MB (`MAX_OPEN_BYTES` in
/// `fileOps.ts`) and the file on disk may have grown past that since it was opened,
/// and the editor is already holding one copy of it, so this one streams instead.
///
/// In `sibling` mode the temp file is in the user's own folder for the length of the
/// copy. It is dot-prefixed (hidden on Unix), it is removed on failure, and it is the
/// price of rule 2 above: the alternative is a `fs::copy` that truncates the previous
/// `<path>.bak` before it discovers the disk is full. `history` is the default mode
/// precisely so that this does not happen in a folder a machine watches.
fn copy_atomic(source: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| format!("{}: has no folder", target.display()))?;
    let temp = temp_path(target, parent);
    match stream_then_rename(source, &temp, target) {
        Ok(()) => {
            // Best effort, as in `atomic::write_atomic`: on Unix the rename is only
            // durable once the directory entry is flushed too.
            #[cfg(unix)]
            let _ = File::open(parent).and_then(|dir| dir.sync_all());
            Ok(())
        }
        Err(err) => {
            let _ = fs::remove_file(&temp);
            Err(format!("{}: {err}", target.display()))
        }
    }
}

fn stream_then_rename(source: &Path, temp: &Path, target: &Path) -> io::Result<()> {
    // Read-only, and nothing here ever opens the source for writing: the backup may
    // not be the reason a save fails.
    let mut input = File::open(source)?;
    let mut output = File::create(temp)?;
    // The copy carries the source's permissions, not the process umask.
    //
    // A backup is the previous version of a file the user may have put somewhere
    // deliberately private — the argument `paths.rs` makes for narrowing the history
    // folders to 0700. `sibling` mode is the one path where that argument was not
    // applied: a program kept at 0600 in a shared folder on a shop machine got a
    // world-readable `<path>.bak` beside it, silently, at the first save (G8 M7).
    //
    // Read from the open handle rather than a second `fs::metadata`, so there is no
    // window between the two, and applied before the bytes go in. Best effort, like
    // `paths::restrict`: a volume that cannot express Unix permissions must not be a
    // volume on which no save gets a backup.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = input.metadata() {
            let mode = meta.permissions().mode() & 0o777;
            let _ = output.set_permissions(fs::Permissions::from_mode(mode));
        }
    }
    io::copy(&mut input, &mut output)?;
    // Before the rename, so that the rename never publishes a backup whose bytes are
    // still only in a cache the crash would lose.
    output.sync_all()?;
    drop(output);
    drop(input);
    fs::rename(temp, target)
}

/// `<parent>/.<name>.tmp-<pid>-<n>`, next to the target so the rename stays within
/// one file system.
fn temp_path(target: &Path, parent: &Path) -> PathBuf {
    let n = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let mut name = OsString::from(".");
    name.push(target.file_name().unwrap_or_default());
    name.push(format!(".tmp-{}-{n}", std::process::id()));
    parent.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// The mode names are a contract with `core/settings/schema.ts`: Rust reads the
    /// value the dialog writes, and a rename on either side would silently turn
    /// backups off (AD-8 keeps the setting in one place, not in two spellings).
    #[test]
    fn the_mode_names_match_the_typescript_schema() {
        let ts = include_str!("../../src/lib/core/settings/schema.ts");
        assert!(
            ts.contains("'files.backup': 'off' | 'sibling' | 'history';"),
            "core/settings/schema.ts must declare files.backup as off | sibling | history"
        );
        for mode in [BackupMode::Off, BackupMode::Sibling, BackupMode::History] {
            assert!(
                ts.contains(&format!("'{}'", mode.as_str())),
                "missing mode {}",
                mode.as_str()
            );
        }
        assert!(
            ts.contains(&format!(
                "'files.backup': '{}'",
                BackupMode::default().as_str()
            )),
            "the default in schema.ts is not {}",
            BackupMode::default().as_str()
        );
        // The keys themselves, and the default count, are the same contract.
        assert!(ts.contains(&format!("'{KEY_MODE}':")), "{KEY_MODE} is gone");
        assert!(
            ts.contains(&format!("'{KEY_COUNT}':")),
            "{KEY_COUNT} is gone"
        );
        assert!(
            ts.contains(&format!("'{KEY_COUNT}': {DEFAULT_BACKUP_COUNT}")),
            "the default count in schema.ts is not {DEFAULT_BACKUP_COUNT}"
        );
    }

    /// An unreadable or hand-broken settings file must not mean "no backup".
    #[test]
    fn an_unknown_mode_falls_back_to_history() {
        assert_eq!(BackupMode::parse(Some("off")), BackupMode::Off);
        assert_eq!(BackupMode::parse(Some("sibling")), BackupMode::Sibling);
        assert_eq!(BackupMode::parse(Some("history")), BackupMode::History);
        for odd in ["", "History", "none", "1"] {
            assert_eq!(BackupMode::parse(Some(odd)), BackupMode::History, "{odd}");
        }
        assert_eq!(BackupMode::parse(None), BackupMode::History);
    }

    /// §7.11: 1 to 50. A hand-edited `0` would otherwise delete the one backup that
    /// was just written.
    #[test]
    fn the_count_is_clamped_into_the_documented_range() {
        assert_eq!(backup_count(None), DEFAULT_BACKUP_COUNT);
        assert_eq!(backup_count(Some(0)), MIN_BACKUP_COUNT);
        assert_eq!(backup_count(Some(-7)), MIN_BACKUP_COUNT);
        assert_eq!(backup_count(Some(3)), 3);
        assert_eq!(backup_count(Some(9_000)), MAX_BACKUP_COUNT);
        // And the fallback settings keep files rather than none: a `count` of 0
        // would tell `prune` to delete the copy it had just made.
        assert_eq!(
            BackupSettings::default(),
            BackupSettings {
                mode: BackupMode::History,
                count: DEFAULT_BACKUP_COUNT
            }
        );
    }

    /// Standing rule 2 and 8 (G8): a command that takes a path from the webview asks
    /// the fs scope about it, and does nothing else itself. The needles are built at
    /// compile time so this test's own text is not one of their hits.
    #[test]
    fn the_command_asks_the_fs_scope_and_touches_nothing_itself() {
        let source = include_str!("backup.rs");
        let signature = concat!(
            "pub fn files_",
            "backup(app: AppHandle, path: String) -> Result<Option<String>, String> {"
        );
        let at = source.find(signature).expect("the signature changed");
        let after = &source[at + signature.len()..];
        let body = &after[..after.find("\n}\n").expect("the body does not end")];
        assert!(
            body.contains(concat!("app.fs_", "scope()")),
            "the command never takes the fs scope"
        );
        assert!(
            body.contains(concat!("scope.is_", "allowed(path)")),
            "the fs scope is taken but never asked about the path"
        );
        assert!(
            !body.contains("std::fs") && !body.contains("fs::"),
            "the command reaches the file system itself instead of going through the body"
        );
    }

    /// The refusal, against a real scope. A path the user never opened is not backed
    /// up, nothing is read or created on the way to saying so, and the same call
    /// works as soon as the file has been granted.
    #[test]
    fn a_path_the_scope_does_not_allow_is_refused() {
        let (root, dirs) = scratch("scope");
        let source = program(&root, "welle.nc", "program\n");
        let app = mock_app();
        let scope = app.fs_scope();
        assert!(!scope.is_allowed(&source));

        let err = backup_allowed(&dirs, &source, at(1_000), |path| scope.is_allowed(path))
            .expect_err("backed up a path the user never opened");
        assert!(err.contains("not in the file scope"), "{err}");
        assert_eq!(fs::read_dir(dirs.backups_dir()).unwrap().count(), 0);

        crate::state::grant_in(&scope, &source);
        let written = backup_allowed(&dirs, &source, at(1_000), |path| scope.is_allowed(path))
            .unwrap()
            .expect("no backup was made for a file the user has open");
        assert_eq!(fs::read_to_string(written).unwrap(), "program\n");
        let _ = fs::remove_dir_all(&root);
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("could not build the mock app")
    }

    // --- the settings this module reads for itself (AD-8) --------------------

    fn settings(json: &str) -> Map<String, Value> {
        match serde_json::from_str(json).unwrap() {
            Value::Object(object) => object,
            other => panic!("not an object: {other}"),
        }
    }

    #[test]
    fn the_mode_and_the_count_come_from_the_settings_file() {
        let (root, dirs) = scratch("settings");
        // No settings file at all: the documented defaults.
        assert_eq!(
            BackupSettings::load(&dirs),
            BackupSettings {
                mode: BackupMode::History,
                count: DEFAULT_BACKUP_COUNT
            }
        );

        for (json, mode, count) in [
            (r#"{"files.backup":"off"}"#, BackupMode::Off, 5),
            (
                r#"{"files.backup":"sibling","files.backupCount":2}"#,
                BackupMode::Sibling,
                2,
            ),
            (
                r#"{"files.backup":"history","files.backupCount":99}"#,
                BackupMode::History,
                MAX_BACKUP_COUNT,
            ),
            // Hand edits that make no sense fall back, never to "no backup".
            (
                r#"{"files.backup":3,"files.backupCount":"x"}"#,
                BackupMode::History,
                5,
            ),
        ] {
            fs::write(dirs.settings_file(), json).unwrap();
            assert_eq!(
                BackupSettings::load(&dirs),
                BackupSettings { mode, count },
                "{json}"
            );
            assert_eq!(BackupSettings::from_object(&settings(json)).mode, mode);
        }

        // A settings file gEdit cannot parse is still not a reason to skip backups.
        fs::write(dirs.settings_file(), "]not json[").unwrap();
        assert_eq!(BackupSettings::load(&dirs).mode, BackupMode::History);
        let _ = fs::remove_dir_all(&root);
    }

    // --- scratch helpers -----------------------------------------------------

    fn scratch(name: &str) -> (PathBuf, AppDirs) {
        let root = std::env::temp_dir().join(format!("gedit-backup-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        assert_eq!(dirs.ensure(), Vec::<String>::new());
        fs::create_dir_all(root.join("nc")).unwrap();
        (root, dirs)
    }

    fn program(root: &Path, name: &str, text: &str) -> PathBuf {
        let path = root.join("nc").join(name);
        fs::write(&path, text).unwrap();
        path
    }

    fn at(millis: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_millis(millis)
    }

    fn history_of(dirs: &AppDirs, source: &Path) -> Vec<String> {
        let dir = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join(source.file_name().unwrap());
        let mut names: Vec<String> = match fs::read_dir(&dir) {
            Ok(entries) => entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect(),
            Err(_) => Vec::new(),
        };
        names.sort();
        names
    }

    fn history(count: u32) -> BackupSettings {
        BackupSettings {
            mode: BackupMode::History,
            count,
        }
    }

    fn sibling() -> BackupSettings {
        BackupSettings {
            mode: BackupMode::Sibling,
            count: 5,
        }
    }

    // --- the date stamp ------------------------------------------------------

    /// The stamp names the moment in UTC and sorts as text in the order the backups
    /// were made — which is what pruning relies on.
    #[test]
    fn the_stamp_is_the_utc_time_to_the_millisecond() {
        assert_eq!(stamp(UNIX_EPOCH), "19700101-000000.000");
        assert_eq!(stamp(at(1)), "19700101-000000.001");
        assert_eq!(stamp(at(86_399_999)), "19700101-235959.999");
        assert_eq!(stamp(at(86_400_000)), "19700102-000000.000");
        // 2000-02-29 is a leap day of a century that is a leap year, and 2100 is not.
        assert_eq!(stamp(at(951_782_400_000)), "20000229-000000.000");
        assert_eq!(stamp(at(4_107_542_400_000)), "21000301-000000.000");
        // An ordinary working day, at noon UTC.
        assert_eq!(stamp(at(1_758_628_800_000)), "20250923-120000.000");
        // A clock set before the epoch still gives a well-formed, sortable name.
        assert_eq!(
            stamp(UNIX_EPOCH - Duration::from_secs(60)),
            "19700101-000000.000"
        );

        let mut ordered: Vec<String> = [0, 1, 86_400_000, 951_782_400_000, 1_758_628_800_000]
            .into_iter()
            .map(|ms| stamp(at(ms)))
            .collect();
        let as_made = ordered.clone();
        ordered.sort();
        assert_eq!(ordered, as_made, "the stamp does not sort by time");
    }

    // --- history mode --------------------------------------------------------

    #[test]
    fn a_history_backup_is_named_after_the_moment_and_the_file() {
        let (root, dirs) = scratch("history-name");
        let source = program(&root, "welle.nc", "O0001\n");

        let written = backup(&dirs, history(5), &source, at(1_758_628_800_000))
            .unwrap()
            .expect("no backup was made");
        let path = PathBuf::from(&written);
        assert_eq!(
            path.file_name().unwrap(),
            OsStr::new("20250923-120000.000-welle.nc")
        );
        assert_eq!(path.parent().unwrap().file_name().unwrap(), "welle.nc");
        assert_eq!(
            path.parent().unwrap().parent().unwrap(),
            dirs.backups_dir()
                .join(folder_key(&root.join("nc")))
                .as_path()
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "O0001\n");
        // Nothing was written next to the program: that is the whole point of the
        // history mode being the default (a folder watcher would post a `.bak`).
        let beside: Vec<String> = fs::read_dir(root.join("nc"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(beside, vec!["welle.nc"]);
        let _ = fs::remove_dir_all(&root);
    }

    /// The backup holds the bytes that were on disk when it was made. A save that
    /// ran first would be copied faithfully — which is why the order belongs to
    /// `fileOps.save`, and why this pins what the command actually promises.
    #[test]
    fn the_backup_holds_what_was_on_disk_and_leaves_the_file_alone() {
        let (root, dirs) = scratch("bytes");
        let source = program(&root, "welle.nc", "G0 X10\n");
        let modified = fs::metadata(&source).unwrap().modified().unwrap();

        let first = backup(&dirs, history(5), &source, at(1_000))
            .unwrap()
            .unwrap();
        // The program itself is untouched: the same bytes, and a modification time
        // the external-change check (AD-10) would still recognize. A backup that
        // wrote to the file it copies could fail the save it precedes.
        assert_eq!(fs::read_to_string(&source).unwrap(), "G0 X10\n");
        assert_eq!(fs::metadata(&source).unwrap().modified().unwrap(), modified);

        // The save this call precedes, and the next save after it.
        fs::write(&source, "G0 X20\n").unwrap();
        let second = backup(&dirs, history(5), &source, at(2_000))
            .unwrap()
            .unwrap();

        // Each backup holds what was on disk when it was made — which is also why
        // calling this *after* a write would faithfully copy the new bytes and lose
        // the old ones. `fileOps.save` owns that order.
        assert_eq!(fs::read_to_string(first).unwrap(), "G0 X10\n");
        assert_eq!(fs::read_to_string(second).unwrap(), "G0 X20\n");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn two_backups_in_one_millisecond_get_a_suffix() {
        let (root, dirs) = scratch("collision");
        let source = program(&root, "welle.nc", "one\n");
        backup(&dirs, history(5), &source, at(1_000)).unwrap();
        fs::write(&source, "two\n").unwrap();
        backup(&dirs, history(5), &source, at(1_000)).unwrap();
        fs::write(&source, "three\n").unwrap();
        backup(&dirs, history(5), &source, at(1_000)).unwrap();

        assert_eq!(
            history_of(&dirs, &source),
            vec![
                "19700101-000001.000-1-welle.nc",
                "19700101-000001.000-2-welle.nc",
                "19700101-000001.000-welle.nc",
            ]
        );
        // Three versions, none of them overwritten.
        let dir = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join("welle.nc");
        let mut texts: Vec<String> = history_of(&dirs, &source)
            .iter()
            .map(|name| fs::read_to_string(dir.join(name)).unwrap())
            .collect();
        texts.sort();
        assert_eq!(texts, vec!["one\n", "three\n", "two\n"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_history_keeps_the_newest_n_and_deletes_the_rest() {
        let (root, dirs) = scratch("prune");
        let source = program(&root, "welle.nc", "v0\n");

        for version in 1..=6u64 {
            fs::write(&source, format!("v{version}\n")).unwrap();
            backup(&dirs, history(3), &source, at(version * 1_000)).unwrap();
        }
        // Six saves, three kept: the newest three, oldest first by name.
        assert_eq!(
            history_of(&dirs, &source),
            vec![
                "19700101-000004.000-welle.nc",
                "19700101-000005.000-welle.nc",
                "19700101-000006.000-welle.nc",
            ]
        );
        let dir = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join("welle.nc");
        assert_eq!(
            fs::read_to_string(dir.join("19700101-000006.000-welle.nc")).unwrap(),
            "v6\n"
        );

        // A same-millisecond suffix counts as newer than the plain name, so a burst
        // of saves does not leave the older one standing.
        for _ in 0..3 {
            backup(&dirs, history(2), &source, at(9_000)).unwrap();
        }
        assert_eq!(
            history_of(&dirs, &source),
            vec![
                "19700101-000009.000-1-welle.nc",
                "19700101-000009.000-2-welle.nc",
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Two files of the same name in different folders keep two histories, and a
    /// file that is saved again lands in the one it already has.
    #[test]
    fn one_history_folder_per_source_folder_and_file_name() {
        let (root, dirs) = scratch("folders");
        fs::create_dir_all(root.join("nc").join("job2")).unwrap();
        let first = program(&root, "welle.nc", "first\n");
        let second = root.join("nc").join("job2").join("welle.nc");
        fs::write(&second, "second\n").unwrap();

        let a = backup(&dirs, history(5), &first, at(1_000))
            .unwrap()
            .unwrap();
        let b = backup(&dirs, history(5), &second, at(1_000))
            .unwrap()
            .unwrap();
        assert_ne!(
            PathBuf::from(&a).parent().unwrap().parent().unwrap(),
            PathBuf::from(&b).parent().unwrap().parent().unwrap()
        );
        assert_eq!(fs::read_to_string(&a).unwrap(), "first\n");
        assert_eq!(fs::read_to_string(&b).unwrap(), "second\n");

        // The same file again goes into the same folder as the first time.
        let again = backup(&dirs, history(5), &first, at(2_000))
            .unwrap()
            .unwrap();
        assert_eq!(
            PathBuf::from(&again).parent().unwrap(),
            PathBuf::from(&a).parent().unwrap()
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// A folder key is a folder name, not a checksum: stable, short, and the same
    /// for two spellings that the platform calls one folder.
    #[test]
    fn the_folder_key_is_stable_and_follows_the_platforms_case_rule() {
        let key = folder_key(Path::new("/nc/jobs"));
        assert_eq!(key.len(), 8);
        assert!(key
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        // Pinned, and the same on every platform because this path is already
        // lower case: the key names a folder on the user's own disk. Changing the
        // hash would lose no backup, but it would hide every one that is already
        // there behind a folder nothing ever looks in again.
        assert_eq!(key, "fff5fc22");
        assert_eq!(key, folder_key(Path::new("/nc//./jobs")));
        assert_ne!(key, folder_key(Path::new("/nc/other")));
        assert_eq!(
            folder_key(Path::new("/NC/Jobs")) == key,
            paths::FOLD_CASE,
            "the case rule does not match the platform's"
        );
    }

    // --- sibling mode --------------------------------------------------------

    #[test]
    fn a_sibling_backup_is_written_next_to_the_file_and_overwritten() {
        let (root, dirs) = scratch("sibling");
        let source = program(&root, "welle.nc", "first\n");

        let written = backup(&dirs, sibling(), &source, at(1_000))
            .unwrap()
            .unwrap();
        assert_eq!(
            PathBuf::from(&written),
            root.join("nc").join("welle.nc.bak")
        );
        assert_eq!(fs::read_to_string(&written).unwrap(), "first\n");

        fs::write(&source, "second\n").unwrap();
        let again = backup(&dirs, sibling(), &source, at(2_000))
            .unwrap()
            .unwrap();
        assert_eq!(again, written);
        assert_eq!(fs::read_to_string(&written).unwrap(), "second\n");
        // One backup, not a history, and no leftovers from the atomic write.
        let mut beside: Vec<String> = fs::read_dir(root.join("nc"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        beside.sort();
        assert_eq!(beside, vec!["welle.nc", "welle.nc.bak"]);
        let _ = fs::remove_dir_all(&root);
    }

    /// G8 M7. A backup is the previous version of a file the user may have put
    /// somewhere deliberately private — the argument `paths.rs` makes for narrowing
    /// the history folders to 0700. `sibling` mode is the one path that lands in the
    /// user's own folder, where no such barrier exists, and the copy used to be
    /// created with the process umask: a program kept at 0600 on a shop machine got a
    /// world-readable `.bak` beside it at the first save, silently.
    #[cfg(unix)]
    #[test]
    fn a_sibling_backup_carries_the_source_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let (root, dirs) = scratch("sibling-mode");
        for mode in [0o600, 0o640, 0o444] {
            let source = program(&root, "private.nc", "secret\n");
            fs::set_permissions(&source, fs::Permissions::from_mode(mode)).unwrap();

            let written = backup(&dirs, sibling(), &source, at(1_000))
                .unwrap()
                .unwrap();
            let copied = fs::metadata(&written).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                copied, mode,
                "a {mode:o} source produced a {copied:o} backup"
            );
            fs::remove_file(&written).unwrap();
            fs::set_permissions(&source, fs::Permissions::from_mode(0o644)).unwrap();
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// Following a link would write the copy wherever it points — out of the folder
    /// the user granted, possibly over something that is not a backup at all.
    #[cfg(unix)]
    #[test]
    fn a_sibling_backup_refuses_a_symlink() {
        let (root, dirs) = scratch("sibling-link");
        let source = program(&root, "welle.nc", "program\n");
        let elsewhere = root.join("elsewhere.txt");
        fs::write(&elsewhere, "not a backup\n").unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.join("nc").join("welle.nc.bak")).unwrap();

        let err = backup(&dirs, sibling(), &source, at(1_000)).expect_err("followed the link");
        assert!(err.contains("symbolic link"), "{err}");
        assert_eq!(fs::read_to_string(&elsewhere).unwrap(), "not a backup\n");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_sibling_backup_refuses_a_directory() {
        let (root, dirs) = scratch("sibling-dir");
        let source = program(&root, "welle.nc", "program\n");
        let taken = root.join("nc").join("welle.nc.bak");
        fs::create_dir(&taken).unwrap();
        fs::write(taken.join("inside"), "keep me\n").unwrap();

        let err = backup(&dirs, sibling(), &source, at(1_000)).expect_err("wrote over a folder");
        assert!(err.contains("directory"), "{err}");
        assert_eq!(
            fs::read_to_string(taken.join("inside")).unwrap(),
            "keep me\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    // --- nothing to do -------------------------------------------------------

    #[test]
    fn a_file_that_is_not_there_yet_is_not_an_error() {
        let (root, dirs) = scratch("missing");
        let never_saved = root.join("nc").join("untitled.nc");
        for settings in [history(5), sibling()] {
            assert_eq!(backup(&dirs, settings, &never_saved, at(1_000)), Ok(None));
        }
        // And nothing was created on the way to finding that out.
        assert!(!never_saved.exists());
        assert_eq!(
            fs::read_dir(dirs.backups_dir()).unwrap().count(),
            0,
            "an empty history folder was made for a file that does not exist"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_off_mode_copies_nothing_at_all() {
        let (root, dirs) = scratch("off");
        let source = program(&root, "welle.nc", "program\n");
        let settings = BackupSettings {
            mode: BackupMode::Off,
            count: 5,
        };
        assert_eq!(backup(&dirs, settings, &source, at(1_000)), Ok(None));
        assert_eq!(fs::read_dir(dirs.backups_dir()).unwrap().count(), 0);
        assert!(!root.join("nc").join("welle.nc.bak").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_is_not_backed_up() {
        let (root, dirs) = scratch("folder-source");
        let err = backup(&dirs, history(5), &root.join("nc"), at(1_000))
            .expect_err("backed up a directory");
        assert!(err.contains("not a regular file"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    // --- a backup that fails may not damage what is there --------------------

    /// A backup that cannot be made must leave the one that is already there, whole.
    ///
    /// The failure injected here is a folder that will not take a new file, and it
    /// is enough to tell the two implementations apart: `copy_atomic` needs a new
    /// name in that folder and reports that it cannot have one, while a `fs::copy`
    /// opens the existing `<path>.bak` **for writing** — which a read-only folder
    /// still allows — and so has already emptied the previous backup by the time it
    /// finds out whether it can fill it again. On a full disk, which is the case
    /// this is really about, that leaves no usable copy of the program at all.
    #[cfg(unix)]
    #[test]
    fn a_failed_sibling_backup_keeps_the_previous_one() {
        use std::os::unix::fs::PermissionsExt;

        let (root, dirs) = scratch("sibling-fails");
        let source = program(&root, "welle.nc", "good\n");
        let target = backup(&dirs, sibling(), &source, at(1_000))
            .unwrap()
            .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "good\n");

        fs::write(&source, "newer\n").unwrap();
        let folder = root.join("nc");
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o555)).unwrap();
        // root ignores the mode bits, so only assert when the folder really is shut.
        if fs::write(folder.join("probe"), b"").is_err() {
            let err = backup(&dirs, sibling(), &source, at(2_000)).expect_err("wrote anyway");
            assert!(err.contains("welle.nc.bak"), "{err}");
            assert_eq!(
                fs::read_to_string(&target).unwrap(),
                "good\n",
                "a failed backup destroyed the one that was there"
            );
        }
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
        // No half-written temp file was left in the user's folder either.
        let leftovers: Vec<String> = fs::read_dir(&folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp-"))
            .collect();
        assert_eq!(leftovers, Vec::<String>::new());
        let _ = fs::remove_dir_all(&root);
    }

    /// The reason the history is pruned *after* the copy: a backup that cannot be
    /// made must not be the thing that deletes the older ones to make room for
    /// itself. The history here is already full, so a prune that ran first — with
    /// room for the entry it is about to write — would take the last version of the
    /// program with it, and the copy would then fail anyway.
    ///
    /// The copy fails here because the program itself cannot be read: a permission
    /// that changed under the user, which is also a save that is about to fail.
    #[cfg(unix)]
    #[test]
    fn a_backup_that_cannot_be_made_prunes_nothing() {
        use std::os::unix::fs::PermissionsExt;

        let (root, dirs) = scratch("history-fails");
        let source = program(&root, "welle.nc", "v1\n");
        backup(&dirs, history(1), &source, at(1_000)).unwrap();
        let kept = history_of(&dirs, &source);
        assert_eq!(kept.len(), 1);

        let dir = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join("welle.nc");
        fs::write(&source, "v2\n").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o000)).unwrap();
        // root reads whatever it likes, so only assert when the file really is shut.
        if fs::read(&source).is_err() {
            let err = backup(&dirs, history(1), &source, at(2_000)).expect_err("copied anyway");
            assert!(err.contains("welle.nc"), "{err}");
            // `history_of` lists the whole folder, so this also says that no temp
            // file of the failed copy was left standing in it.
            assert_eq!(
                history_of(&dirs, &source),
                kept,
                "a failed backup pruned the history to make room for itself"
            );
            assert_eq!(fs::read_to_string(dir.join(&kept[0])).unwrap(), "v1\n");
        }
        fs::set_permissions(&source, fs::Permissions::from_mode(0o644)).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    /// Pruning is housekeeping. Once the copy is on disk the command has done the
    /// thing the save is waiting for, so an entry that will not go away is a line on
    /// stderr — not a "Save without a backup?" question about a backup that exists.
    #[test]
    fn a_backup_that_cannot_be_pruned_is_still_a_backup() {
        let (root, dirs) = scratch("prune-fails");
        let source = program(&root, "welle.nc", "v1\n");
        backup(&dirs, history(1), &source, at(1_000)).unwrap();
        let dir = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join("welle.nc");

        // An entry `prune` will pick and `remove_file` cannot remove: a directory
        // wearing a history entry's name, which is what a restore attempt or a
        // syncing client can leave behind.
        let stubborn = dir.join("19690101-000000.000-welle.nc");
        fs::create_dir(&stubborn).unwrap();
        fs::write(stubborn.join("inside"), "not ours\n").unwrap();
        // And a file that is not one of ours at all.
        fs::write(dir.join("notes.txt"), "mine\n").unwrap();

        fs::write(&source, "v2\n").unwrap();
        let written = backup(&dirs, history(1), &source, at(2_000))
            .expect("the backup was reported as failed")
            .expect("no path was answered");
        assert_eq!(fs::read_to_string(&written).unwrap(), "v2\n");

        // The entry it could delete is gone, the one it could not is untouched, and
        // the file that is none of its business was never considered.
        assert_eq!(
            history_of(&dirs, &source),
            vec![
                "19690101-000000.000-welle.nc",
                "19700101-000002.000-welle.nc",
                "notes.txt"
            ]
        );
        assert_eq!(
            fs::read_to_string(stubborn.join("inside")).unwrap(),
            "not ours\n"
        );
        assert_eq!(fs::read_to_string(dir.join("notes.txt")).unwrap(), "mine\n");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn only_our_own_entries_are_ever_sorted_or_deleted() {
        assert_eq!(
            sort_key("19700101-000001.000-a.nc", "a.nc"),
            Some(("19700101-000001.000", 0))
        );
        assert_eq!(
            sort_key("19700101-000001.000-7-a.nc", "a.nc"),
            Some(("19700101-000001.000", 7))
        );
        for stranger in [
            "notes.txt",
            "a.nc",
            "",
            "19700101-000001.000",
            "1970010x-000001.000-a.nc",
            "19700101x000001.000-a.nc",
            "19700101-000001x000-a.nc",
            "19700101-000001.000x a.nc",
            // Not ASCII where the stamp has to be: the split may not cut a character
            // in half.
            "Aufträge-000001.000-a.nc",
        ] {
            assert_eq!(sort_key(stranger, "a.nc"), None, "{stranger}");
        }
    }

    /// G8 M7. A station or an operation number in front of the file name is ordinary
    /// shop naming, and the counter used to be guessed as "the digits up to the first
    /// dash" — which for `5-part.nc` read 5 out of the **document's** name for its
    /// first copy of a millisecond and 1 for its second, so `prune` sorted the older
    /// copy as the newer one. Nothing was lost that the count did not already allow,
    /// but the survivor was the wrong one.
    #[test]
    fn the_counter_is_ours_and_not_the_first_number_of_the_file_name() {
        // `5-part.nc`: the first copy of a millisecond, then the second.
        assert_eq!(
            sort_key("20260421-134502.881-5-part.nc", "5-part.nc"),
            Some(("20260421-134502.881", 0))
        );
        assert_eq!(
            sort_key("20260421-134502.881-1-5-part.nc", "5-part.nc"),
            Some(("20260421-134502.881", 1))
        );
        // And the two sort the way `prune` needs them to.
        let mut names = [
            sort_key("20260421-134502.881-5-part.nc", "5-part.nc").unwrap(),
            sort_key("20260421-134502.881-1-5-part.nc", "5-part.nc").unwrap(),
        ];
        names.sort_by(|left, right| right.0.cmp(left.0).then(right.1.cmp(&left.1)));
        assert_eq!(
            names[0].1, 1,
            "the newest of the millisecond must sort first"
        );

        // A counter out of range, or a remainder that is not this document's name at
        // all, is 0 — ordered by the stamp alone, which is what every entry got
        // before. It is never `None`: the entry still carries one of our stamps.
        assert_eq!(
            sort_key("20260421-134502.881-99999-5-part.nc", "5-part.nc"),
            Some(("20260421-134502.881", 0))
        );
        assert_eq!(
            sort_key("20260421-134502.881-other.nc", "5-part.nc"),
            Some(("20260421-134502.881", 0))
        );
    }

    /// The same case end to end: `files.backupCount = 1` over two copies written in
    /// one millisecond keeps the **second** one.
    #[test]
    fn the_newer_of_two_copies_in_one_millisecond_is_the_one_kept() {
        let (root, dirs) = scratch("counter");
        let source = program(&root, "5-part.nc", "v1\n");
        let now = at(1_000);

        backup(&dirs, history(1), &source, now).unwrap().unwrap();
        fs::write(&source, "v2\n").unwrap();
        let second = backup(&dirs, history(1), &source, now).unwrap().unwrap();

        assert_eq!(
            history_of(&dirs, &source),
            vec!["19700101-000001.000-1-5-part.nc"]
        );
        assert_eq!(fs::read_to_string(&second).unwrap(), "v2\n");
        let _ = fs::remove_dir_all(&root);
    }

    // --- the folders themselves (standing rule 10) ---------------------------

    #[cfg(unix)]
    #[test]
    fn every_level_of_the_history_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let (root, dirs) = scratch("modes");
        // The data folder from an older build, left world-readable.
        fs::set_permissions(dirs.backups_dir(), fs::Permissions::from_mode(0o755)).unwrap();
        let source = program(&root, "welle.nc", "program\n");
        let written = PathBuf::from(
            backup(&dirs, history(5), &source, at(1_000))
                .unwrap()
                .unwrap(),
        );

        // `<data>/backups/<folder key>/<file name>/`: three levels, all of them ours.
        let by_name = written.parent().unwrap();
        let by_folder = by_name.parent().unwrap();
        for dir in [by_name, by_folder, dirs.backups_dir().as_path()] {
            let mode = fs::metadata(dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, paths::OWNER_ONLY, "{} is {mode:o}", dir.display());
        }
        assert_eq!(by_folder.parent().unwrap(), dirs.backups_dir().as_path());
        let _ = fs::remove_dir_all(&root);
    }
}

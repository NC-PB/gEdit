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
//!   that picks up `*.bak` would post the backup to a machine. A file name past
//!   [`MAX_HISTORY_NAME`] is shortened on the way in ([`history_name`]): the stamp in
//!   front of it must still leave a name the file system will take.
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
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::atomic;
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
/// B1 A2: the overall cap on `<data>/backups`, in megabytes. 0 = no limit.
pub const KEY_TOTAL_MB: &str = "files.backupTotalMb";
/// B1 A2: how many days the history of a file that no longer exists is kept after its
/// last backup. 0 = never expire.
pub const KEY_ORPHAN_DAYS: &str = "files.backupOrphanDays";

/// `files.backupCount` when the setting is absent or unusable (§7.11).
pub const DEFAULT_BACKUP_COUNT: u32 = 5;
/// The range §7.11 gives the setting. A hand-edited file is clamped into it, so the
/// history can neither be emptied by a `0` nor grow without bound.
pub const MIN_BACKUP_COUNT: u32 = 1;
pub const MAX_BACKUP_COUNT: u32 = 50;

/// `files.backupTotalMb` when the setting is absent or unusable.
pub const DEFAULT_TOTAL_MB: u64 = 500;
/// The largest value the setting takes; a hand edit beyond it is cut to it.
pub const MAX_TOTAL_MB: u64 = 1_000_000;
/// `files.backupOrphanDays` when the setting is absent or unusable.
pub const DEFAULT_ORPHAN_DAYS: u32 = 90;
/// The largest value the setting takes (ten years).
pub const MAX_ORPHAN_DAYS: u32 = 3650;

/// What a `sibling` backup is called: the document's own name plus this.
///
/// Deliberately its own constant and not [`crate::config::BAK_SUFFIX`], which names
/// the rescue copy of an app JSON file gEdit could not parse. The two spell the same
/// four characters today and mean different things: one is the user's backup of their
/// program, the other is gEdit getting its own broken file out of the way.
pub const SIBLING_SUFFIX: &str = ".bak";

/// `yyyymmdd-hhmmss.mmm`: what a history entry's name starts with.
const STAMP_LEN: usize = 19;

/// The longest one file or folder **name** may be: 255, on NTFS, ext4, APFS and HFS+
/// alike (Microsoft, "Naming Files, Paths, and Namespaces": the file name component
/// limit; `NAME_MAX` elsewhere).
///
/// Measured in bytes, which is never fewer than the UTF-16 units Windows counts — a
/// character is one unit and one to three bytes, or two units and four bytes — so the
/// one measure is safe on every platform.
const MAX_COMPONENT: usize = 255;

/// What a history entry's name carries in front of the document's own, at its widest.
///
/// Usually that is `<stamp>-`, but [`unique_name`] files a second backup of one file
/// in one millisecond as `<stamp>-<n>-`, with `n` up to [`MAX_SAME_MILLISECOND`], so
/// the budget has to be the wider of the two or the invariant below is false for every
/// same-millisecond entry: `STAMP_LEN` + two dashes + the digits of the counter (G8 M8
/// — the first spelling of this was `STAMP_LEN + 1`, three characters short).
const ENTRY_PREFIX_LEN: usize = STAMP_LEN + 2 + MAX_SAME_MILLISECOND.ilog10() as usize + 1;

/// And what [`temp_path`] puts around *that* while the copy is being written:
/// `.<entry>.tmp-<pid>-<n>`, with ten digits allowed for each of the two numbers.
const TEMP_AFFIX_LEN: usize = 1 + ".tmp-".len() + 10 + 1 + 10;

/// The longest document name a history entry can be filed under, which is what is
/// left of [`MAX_COMPONENT`] once both of those are in the name (M8).
///
/// A CAM post that names its output after the part, the operation, the tool and the
/// date reaches 150 characters easily; past this the *backup* of a file the user can
/// save perfectly well stops being a legal name, and the save that asked for it
/// stops with "the copy could not be made" — the same at every save from then on.
/// Longer names are shortened by [`history_name`] rather than refused.
///
/// What this costs, said plainly (G8 M8, correcting "shorter names are untouched, so
/// no existing history moves"): [`TEMP_AFFIX_LEN`] budgets ten digits each for the pid
/// and the counter, which no real machine reaches — a five-digit pid and a one-digit
/// counter make the affix 13 rather than 27. So names of 206 to about 222 characters
/// *did* have a working history before M8, under a folder named after the document,
/// and [`history_dir`] now points at the shortened `<head>-<fnv32>.<ext>` instead. The
/// old folder is left where it is: it stops being pruned and stops being added to, and
/// the `backupCount` the user set starts again from zero. Nothing is deleted.
///
/// That is the deliberate trade. The budget could be cut to the affix a real pid
/// produces and keep those histories, but then the one case it exists for — the
/// machine whose pid needs the digits, or a `copy_atomic` that has retried often
/// enough for a wide counter — is back to a save that fails every time, and a failed
/// save is worse than a history that restarts. The range is narrow, it only contains
/// names a CAM post generated rather than names anyone typed, and the alternative
/// (migrating the old folder with `fs::rename` on first use) adds a rename of the
/// user's backups to the save path to save a folder most installations do not have.
pub const MAX_HISTORY_NAME: usize = MAX_COMPONENT - ENTRY_PREFIX_LEN - TEMP_AFFIX_LEN;

/// How much of a long name's extension is kept. `.nc`, `.NC`, `.tap`, `.gcode`, `.h`:
/// long enough for the ones a program is actually called, short enough that a name
/// that is *all* extension cannot eat the part that identifies the file.
const MAX_EXTENSION: usize = 8;

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

/// A limit setting: `0` is a real value ("no limit"), a negative or missing one is
/// the default, and anything past `max` is cut to it.
fn limit(value: Option<i64>, default: u64, max: u64) -> u64 {
    match value {
        Some(n) if n >= 0 => (n as u64).min(max),
        _ => default,
    }
}

/// What this module needs out of `settings.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackupSettings {
    pub mode: BackupMode,
    pub count: u32,
    /// The cap on all histories together, in megabytes; 0 = no limit.
    pub total_mb: u64,
    /// Days an orphaned history is kept; 0 = for ever.
    pub orphan_days: u32,
}

/// Written out rather than derived: a derived `count` would be **0**, and a 0 tells
/// [`prune`] to keep nothing — including the copy that was just made. The default of
/// a thing that exists to keep files may not be "keep none".
impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            mode: BackupMode::default(),
            count: DEFAULT_BACKUP_COUNT,
            total_mb: DEFAULT_TOTAL_MB,
            orphan_days: DEFAULT_ORPHAN_DAYS,
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
            total_mb: limit(
                settings.get(KEY_TOTAL_MB).and_then(Value::as_i64),
                DEFAULT_TOTAL_MB,
                MAX_TOTAL_MB,
            ),
            orphan_days: limit(
                settings.get(KEY_ORPHAN_DAYS).and_then(Value::as_i64),
                u64::from(DEFAULT_ORPHAN_DAYS),
                u64::from(MAX_ORPHAN_DAYS),
            ) as u32,
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
///
/// `async`, and the work is on the blocking pool: a plain `fn` command runs on the main
/// thread (`tauri-macros` 2.6 `ExecutionContext::Blocking`), and both the scope check
/// (it canonicalizes) and the copy touch the file's share. A save to a share that has
/// stopped answering waits for it here without freezing the window.
#[tauri::command]
pub async fn files_backup(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = paths::app_dirs(&app)?;
        let answer = backup_allowed(&dirs, Path::new(&path), SystemTime::now(), |path| {
            scope.is_allowed(path)
        });
        if matches!(answer, Ok(Some(_))) {
            sweep_later(dirs);
        }
        answer
    })
    .await
    // The save reads a rejection as "no backup", and does not write.
    .map_err(|err| format!("the backup did not finish: {err}"))?
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
        // the user still has this backup and one more old one than they asked for,
        // which is the harmless direction to fail in.
        if let Some(folder) = target.parent() {
            if let Err(err) = prune(folder, settings.count) {
                eprintln!("gEdit: {err}");
            }
        }
        note_folder(dirs, source);
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

/// [`fnv32`] over the folder's normalized (and, where the platform folds case,
/// lowered) path.
///
/// It names a folder, so it has to be short and legal on every platform; it is not a
/// checksum of anything and nothing is verified against it. A collision between two
/// source folders means their two histories share a parent — the `<file name>` level
/// below still separates them unless the names collide too, and even then the entries
/// are distinct files with distinct stamps.
///
/// Normalizing means [`Path::components`], so the text that is hashed is the folder
/// as *this* platform spells it: `/nc/jobs` is `\nc\jobs` on Windows, and the digits
/// there are the digits of that. That is right rather than merely tolerable — the key
/// points at a folder on the user's own disk, it never travels between machines, and
/// a path only means anything on the platform that spelled it.
pub fn folder_key(folder: &Path) -> String {
    // And in the ordinary spelling, so that a folder that reached us through
    // `canonicalize` keys the same history as the `C:\…` the file dialog gives for it
    // (M8, `paths::plain`); two histories of one folder is what this hash exists to
    // prevent.
    let folder = paths::plain(folder);
    let normalized: PathBuf = folder.components().collect();
    let text = normalized.to_string_lossy();
    let text = if paths::FOLD_CASE {
        text.to_lowercase()
    } else {
        text.into_owned()
    };
    fnv32(&text)
}

/// FNV-1a over `text`, as eight lowercase hex digits.
///
/// Named on its own so that a test can pin its digits for a string it chooses: the
/// path a key is derived from is spelled per platform, the hash over a given string
/// is not, and the hash is the half that must never change quietly.
fn fnv32(text: &str) -> String {
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
/// already has on disk*, under whatever permissions they keep it.
fn history_dir(dirs: &AppDirs, source: &Path) -> Result<PathBuf, String> {
    let folder = source
        .parent()
        .filter(|folder| !folder.as_os_str().is_empty())
        .ok_or_else(|| format!("{}: has no folder", source.display()))?;
    let name = history_name(file_name(source)?);
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
    // The same shortening as the folder above, so that `prune` still reads an entry's
    // name as `<stamp>-<the folder's own name>`.
    let name = history_name(file_name(source)?);
    unique_name(&dir, &stamp(now), &name).ok_or_else(|| {
        format!(
            "{}: more than {MAX_SAME_MILLISECOND} backups in one millisecond",
            dir.display()
        )
    })
}

/// The document's name as a history entry can carry it: its own, or — past
/// [`MAX_HISTORY_NAME`] — a shortened one that is still recognizably it.
///
/// The shortened form is `<the first of the name>-<fnv32 of the whole>.<extension>`.
/// The head is what the user reads, the extension is what says it is a program, and
/// the hash is what keeps two CAM names that agree for their first two hundred
/// characters from sharing one history folder — the same argument [`folder_key`]
/// makes for the folder level, at the file level.
///
/// A name that is not valid UTF-8 is handed back untouched: cutting WTF-8 at a byte
/// count can split a character in half, and a name like that is rare enough that
/// keeping the old behaviour for it is better than inventing one.
fn history_name(name: &OsStr) -> OsString {
    if name.len() <= MAX_HISTORY_NAME {
        return name.to_os_string();
    }
    let Some(text) = name.to_str() else {
        return name.to_os_string();
    };
    let extension = Path::new(text)
        .extension()
        .and_then(OsStr::to_str)
        .filter(|extension| !extension.is_empty() && extension.len() <= MAX_EXTENSION);
    let tail = match extension {
        Some(extension) => format!("-{}.{extension}", fnv32(text)),
        None => format!("-{}", fnv32(text)),
    };
    // `tail` is ASCII and far shorter than the budget, so this cannot underflow.
    let mut head = MAX_HISTORY_NAME - tail.len();
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut short = OsString::from(&text[..head]);
    short.push(tail);
    short
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

// --- the global pass: an overall cap and expiry (B1 A2, redesigned in B1) -------
//
// `prune` keeps `files.backupCount` versions per file, which bounds one history and
// nothing else: fifty versions of a few hundred files, or the histories of every
// program that was ever opened and has since been deleted, grow without end. After a
// successful backup a second, global pass therefore applies two limits.
//
// **The newest backup of a file is never deleted by the space cap.** It is the one
// copy a save just made room for (or the user's only way back from a delete), and a
// cap that is too small for it leaves the folder over the cap rather than take it.
//
// **Only a file on the backups' own volume can be judged deleted.** A program on a
// USB stick, a network share or a second disk is "not found" just as well when the
// stick is out, the share is not mounted, or another stick of the same name (or the
// same drive letter) is in; the sweep cannot tell that from a deleted file, so it
// never tries: such histories only ever lose their *oldest* copies to the cap.
// Because "gone" is a statement about a place, each `<fnv32>` folder holds a small
// `.folder` note: line 1 the folder path, line 2 `local` (the folder is on the same
// volume as `<data>/backups`), `other`, or `ambiguous` (two folders share the key, so
// the note cannot say which one a history belongs to). A note without line 2, a
// shortened file name (the real name is not known), a history without a note and
// anything but `local` all mean: never expires.
//
// For a `local` history "gone" means the file is not found **and** its nearest
// existing folder is on the backups' volume (a mount point that was left behind is
// then an empty folder of *another* volume, which is not "gone"), and it is checked
// twice, the second time immediately before the first copy is deleted. The checks run
// one after the other on the sweep's own thread and only for histories that are old
// enough to matter, never through the bounded stat of `files`: the user's own stats
// (open, save, the poll) must not share a budget with a housekeeping pass.
//
// The pass runs at most once in ten minutes ([`SWEEP_INTERVAL`]), and not at all while
// `settings.json` cannot be read ([`sweep_settings`]): the defaults applied to a
// broken file could delete what the user set to "keep".

/// The file in `<data>/backups/<fnv32>/` that names the folder the histories in it
/// belong to. Not a directory and not a stamped entry, so `prune` and the history
/// listing never see it.
const FOLDER_NOTE: &str = ".folder";

/// The least time between the starts of two passes.
const SWEEP_INTERVAL: Duration = Duration::from_secs(600);

/// Where the files of a history live, as the `.folder` note records it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Origin {
    /// On the same volume as `<data>/backups`: the only kind that can expire.
    Local,
    /// Anywhere else (stick, share, second disk), or a note that does not say.
    Other,
    /// Two folders share this key; no history under it can be attributed.
    Ambiguous,
}

impl Origin {
    fn word(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Other => "other",
            Self::Ambiguous => "ambiguous",
        }
    }

    fn parse(word: &str) -> Option<Self> {
        [Self::Local, Self::Other, Self::Ambiguous]
            .into_iter()
            .find(|origin| origin.word() == word)
    }
}

/// The content of a `.folder` note.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Note {
    folder: String,
    origin: Origin,
    /// The note had its second line. Without one (written by a build that did not
    /// record the volume) it counts as [`Origin::Other`], and may be upgraded.
    explicit: bool,
}

impl Note {
    fn parse(text: &str) -> Self {
        if let Some((folder, last)) = text.rsplit_once('\n') {
            if let Some(origin) = Origin::parse(last.trim()) {
                return Self {
                    folder: folder.to_owned(),
                    origin,
                    explicit: true,
                };
            }
        }
        Self {
            folder: text.to_owned(),
            origin: Origin::Other,
            explicit: false,
        }
    }

    fn render(&self) -> String {
        format!("{}\n{}", self.folder, self.origin.word())
    }
}

/// One stamped entry of a history.
#[derive(Debug, Clone)]
struct Entry {
    stamp: String,
    counter: u32,
    path: PathBuf,
    bytes: u64,
}

/// One `<fnv32>/<file name>/` folder.
#[derive(Debug)]
struct History {
    dir: PathBuf,
    /// The file the history belongs to, when the folder note and the name allow
    /// saying so.
    source: Option<PathBuf>,
    /// Where `source` lives; only a [`Origin::Local`] history can expire.
    origin: Origin,
    /// Newest first.
    entries: Vec<Entry>,
}

/// What [`sweep`] removed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepReport {
    /// Entries (backup copies) deleted.
    pub entries: usize,
    /// Bytes those entries held.
    pub bytes: u64,
    /// Histories that went completely.
    pub histories: usize,
}

/// Records which folder the histories under `source`'s folder key belong to, and
/// whether that folder is on the backups' own volume. Best effort and quiet: a backup
/// never fails over its bookkeeping.
fn note_folder(dirs: &AppDirs, source: &Path) {
    let Some(folder) = source.parent().filter(|f| !f.as_os_str().is_empty()) else {
        return;
    };
    // A path that is not UTF-8 cannot be written as text and read back exactly, and a
    // wrong path would make a live file look deleted. No note, no expiry. (A name with
    // a line break would also confuse the two-line note.)
    let Some(text) = folder.to_str().filter(|text| !text.contains('\n')) else {
        return;
    };
    let local = same_volume(folder, &dirs.backups_dir());
    note_with_key(dirs, text, &folder_key(folder), local);
}

/// [`note_folder`] with the key and the volume decided, so that a test can make two
/// folders share a key.
fn note_with_key(dirs: &AppDirs, folder: &str, key: &str, local: bool) {
    let path = dirs.backups_dir().join(key).join(FOLDER_NOTE);
    let now = Note {
        folder: folder.to_owned(),
        origin: if local { Origin::Local } else { Origin::Other },
        explicit: true,
    };
    let wanted = match fs::read_to_string(&path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => now,
        // A note that cannot be read is not replaced blind: it may say `ambiguous`.
        Err(_) => return,
        Ok(text) => {
            let have = Note::parse(&text);
            if have.origin == Origin::Ambiguous {
                return;
            }
            if have.folder != folder {
                // Two folders under one key (a 32-bit collision, or two spellings of
                // a name on a case-sensitive volume while the key folds case).
                Note {
                    origin: Origin::Ambiguous,
                    explicit: true,
                    ..have
                }
            } else if !have.explicit || (have.origin == Origin::Local && !local) {
                // A note from before the volume was recorded is brought up to date, and
                // a folder that was local and no longer is, is `other` at once.
                now
            } else {
                // Same folder; `other` stays `other` even if the path now answers
                // from the backups' volume (a stick's mount point left behind).
                return;
            }
        }
    };
    if let Err(err) = atomic::write_atomic(&path, wanted.render().as_bytes()) {
        eprintln!("gEdit: could not note the folder of a backup: {err}");
    }
}

/// Whether `a` and `b` are on one volume (one file system / one drive). `false` when
/// either cannot be examined: unknown is "not the same".
///
/// Unix: the device number, with links followed, so a link to a share is the share.
#[cfg(unix)]
fn same_volume(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev(),
        _ => false,
    }
}

/// Windows: the drive letter of the resolved path; a network path has none.
#[cfg(windows)]
fn same_volume(a: &Path, b: &Path) -> bool {
    use std::path::{Component, Prefix};
    let letter = |path: &Path| -> Option<u8> {
        let real = fs::canonicalize(path).ok()?;
        let plain = paths::plain(&real);
        match plain.components().next()? {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                    Some(letter.to_ascii_uppercase())
                }
                _ => None,
            },
            _ => None,
        }
    };
    matches!((letter(a), letter(b)), (Some(a), Some(b)) if a == b)
}

#[cfg(not(any(unix, windows)))]
fn same_volume(_a: &Path, _b: &Path) -> bool {
    false
}

/// `yyyymmdd-hhmmss.mmm` as milliseconds since the epoch; the inverse of [`stamp`].
fn stamp_millis(stamp: &str) -> Option<i64> {
    let number = |range: std::ops::Range<usize>| stamp.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (number(0..4)?, number(4..6)?, number(6..8)?);
    let (hour, minute, second, milli) = (
        number(9..11)?,
        number(11..13)?,
        number(13..15)?,
        number(16..19)?,
    );
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    // Days from the civil date (the algorithm `civil_from_days` inverts).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let year_of_era = y.rem_euclid(400);
    let month_position = (month + 9) % 12; // March = 0
    let day_of_year = (153 * month_position + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + milli)
}

/// Every history under `root`, with its entries newest first. Anything that is not
/// ours (a folder note, an unstamped file, a sub-folder) is left out of the lists and
/// so is never counted or deleted.
fn scan(root: &Path) -> Vec<History> {
    let mut out = Vec::new();
    let Ok(folders) = fs::read_dir(root) else {
        return out;
    };
    for folder in folders.flatten() {
        let folder_dir = folder.path();
        if !fs::symlink_metadata(&folder_dir).is_ok_and(|m| m.is_dir()) {
            continue;
        }
        let note = fs::read_to_string(folder_dir.join(FOLDER_NOTE))
            .ok()
            .map(|text| Note::parse(&text))
            .filter(|note| Path::new(&note.folder).is_absolute());
        let Ok(names) = fs::read_dir(&folder_dir) else {
            continue;
        };
        for named in names.flatten() {
            let dir = named.path();
            if !fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir()) {
                continue;
            }
            let document = named.file_name().to_string_lossy().into_owned();
            let mut entries: Vec<Entry> = fs::read_dir(&dir)
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let (stamp, counter) = sort_key(&name, &document)?;
                    let meta = fs::symlink_metadata(entry.path()).ok()?;
                    meta.is_file().then(|| Entry {
                        stamp: stamp.to_owned(),
                        counter,
                        path: entry.path(),
                        bytes: meta.len(),
                    })
                })
                .collect();
            entries.sort_by(|l, r| r.stamp.cmp(&l.stamp).then(r.counter.cmp(&l.counter)));
            // A name that `history_name` shortened is not the file's own name: its
            // length is the budget, give or take a character boundary.
            let shortened = document.len() + 3 >= MAX_HISTORY_NAME;
            let (source, origin) = match (&note, shortened) {
                (Some(note), false) => (Some(Path::new(&note.folder).join(&document)), note.origin),
                _ => (None, Origin::Other),
            };
            out.push(History {
                dir,
                source,
                origin,
                entries,
            });
        }
    }
    out
}

/// Removes one entry; `true` when it is gone afterwards.
fn remove_entry(entry: &Entry) -> bool {
    match fs::remove_file(&entry.path) {
        Ok(()) => true,
        Err(err) if err.kind() == io::ErrorKind::NotFound => true,
        Err(err) => {
            eprintln!("gEdit: could not remove {}: {err}", entry.path.display());
            false
        }
    }
}

/// Removes a history folder that no longer holds any entry. `remove_dir` only takes
/// an empty folder, so anything of the user's in it keeps the folder.
fn remove_if_empty(dir: &Path) {
    let _ = fs::remove_dir(dir);
    if let Some(parent) = dir.parent() {
        // The `<fnv32>` level goes once nothing but its note is left.
        let only_note = fs::read_dir(parent).is_ok_and(|names| {
            names
                .flatten()
                .all(|name| name.file_name() == std::ffi::OsStr::new(FOLDER_NOTE))
        });
        if only_note {
            let _ = fs::remove_file(parent.join(FOLDER_NOTE));
            let _ = fs::remove_dir(parent);
        }
    }
}

/// The global pass, with the existence check injected: `gone(path)` answers whether
/// the file is **certainly** not there any more (`false` for "there" and for "cannot
/// tell"). It is asked only about the files of [`Origin::Local`] histories, one at a
/// time, and twice before a history is removed.
///
/// 1. With `orphan_days > 0`, a `local` history whose file is gone and whose newest
///    backup is older than that is removed whole.
/// 2. With `total_mb > 0`, entries are removed oldest first, over all histories, until
///    the total is within the cap. The newest backup of every history stays, so the
///    result can stay over the cap; no existence check is involved.
pub fn sweep(
    root: &Path,
    settings: &BackupSettings,
    now: SystemTime,
    gone: impl Fn(&Path) -> bool,
) -> SweepReport {
    let mut report = SweepReport::default();
    if settings.total_mb == 0 && settings.orphan_days == 0 {
        return report;
    }
    let mut histories = scan(root);

    let now_ms = now
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as i64);

    if settings.orphan_days > 0 {
        let cutoff = now_ms - i64::from(settings.orphan_days) * 86_400_000;
        for history in histories.iter_mut() {
            let (Origin::Local, Some(source)) = (history.origin, history.source.clone()) else {
                continue;
            };
            let Some(newest) = history.entries.first() else {
                continue;
            };
            if !stamp_millis(&newest.stamp).is_some_and(|ms| ms < cutoff) {
                continue;
            }
            // Two looks: a one-off error (a share that answered "not found" once, a
            // folder that was being moved) must not be enough to delete.
            if !gone(&source) || !gone(&source) {
                continue;
            }
            let mut left = Vec::new();
            for entry in history.entries.drain(..) {
                if remove_entry(&entry) {
                    report.entries += 1;
                    report.bytes += entry.bytes;
                } else {
                    left.push(entry);
                }
            }
            history.entries = left;
            if history.entries.is_empty() {
                report.histories += 1;
                remove_if_empty(&history.dir);
            }
        }
    }

    if settings.total_mb > 0 {
        let cap = settings.total_mb.saturating_mul(1_048_576);
        let mut total: u64 = histories
            .iter()
            .flat_map(|h| &h.entries)
            .map(|e| e.bytes)
            .sum();
        // (history index, entry index); the newest entry of a history is never a
        // candidate: it is the user's way back from the last save, or from a delete.
        let mut candidates: Vec<(usize, usize)> = Vec::new();
        for (h, history) in histories.iter().enumerate() {
            candidates.extend((1..history.entries.len()).map(|e| (h, e)));
        }
        candidates.sort_by(|&(lh, le), &(rh, re)| {
            let (l, r) = (&histories[lh].entries[le], &histories[rh].entries[re]);
            l.stamp
                .cmp(&r.stamp)
                .then(l.counter.cmp(&r.counter))
                .then(l.path.cmp(&r.path))
        });
        for (h, e) in candidates {
            if total <= cap {
                break;
            }
            let entry = &histories[h].entries[e];
            if remove_entry(entry) {
                total = total.saturating_sub(entry.bytes);
                report.entries += 1;
                report.bytes += entry.bytes;
            }
        }
    }
    report
}

/// Whether a pass is already running; a second one would only repeat its work.
static SWEEPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// When the last pass started.
static LAST_PASS: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// Holds [`SWEEPING`] and gives it back when dropped, on the normal path and when the
/// pass panics: a flag left set would mean that no pass ever ran again.
struct SweepGuard;

impl SweepGuard {
    fn take() -> Option<Self> {
        (!SWEEPING.swap(true, Ordering::SeqCst)).then_some(Self)
    }
}

impl Drop for SweepGuard {
    fn drop(&mut self) {
        SWEEPING.store(false, Ordering::SeqCst);
    }
}

/// Whether a pass may start now: none yet, or the last one started at least
/// [`SWEEP_INTERVAL`] ago.
fn due(last: Option<std::time::Instant>, now: std::time::Instant) -> bool {
    last.is_none_or(|last| now.saturating_duration_since(last) >= SWEEP_INTERVAL)
}

/// The settings a **deleting** pass may act on: `None` (no pass) when `settings.json`
/// exists but cannot be read or used. For making backups the defaults are right for a
/// broken file ("broken" must never mean "no backup"); for deleting they are wrong,
/// because a user who set `0` (no limit, keep for ever) would get 500 MB and 90 days.
fn sweep_settings(dirs: &AppDirs) -> Option<BackupSettings> {
    let file = config::read_json_object(&dirs.settings_file(), SETTINGS_FILE_NAME);
    if file.unreadable || file.unusable || file.read_only {
        return None;
    }
    Some(BackupSettings::from_object(&file.value))
}

/// Runs [`sweep`] on a thread of its own, after a backup was made in `history` mode,
/// at most once in ten minutes. Never on the save's own thread: the existence checks
/// touch the disk of the other histories, and a save must not wait for them. A
/// failure is a line on stderr; a later backup tries again.
fn sweep_later(dirs: AppDirs) {
    let Some(guard) = SweepGuard::take() else {
        return;
    };
    let mut last = LAST_PASS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !due(*last, std::time::Instant::now()) {
        return;
    }
    let Some(settings) = sweep_settings(&dirs).filter(|s| s.mode == BackupMode::History) else {
        return;
    };
    let spawned = std::thread::Builder::new()
        .name("gedit-backup-sweep".into())
        .spawn(move || {
            let _guard = guard;
            let root = dirs.backups_dir();
            let report = sweep(&root, &settings, SystemTime::now(), gone_on_disk(&root));
            if report.entries > 0 {
                eprintln!(
                    "gEdit: removed {} old backup copies ({} bytes) from {} histories",
                    report.entries, report.bytes, report.histories
                );
            }
        });
    if spawned.is_ok() {
        *last = Some(std::time::Instant::now());
    }
}

/// The real existence check for a history of the volume that holds `backups`.
fn gone_on_disk(backups: &Path) -> impl Fn(&Path) -> bool + '_ {
    move |path| gone_with(path, |folder| same_volume(folder, backups))
}

/// "Certainly gone": the file system says "not found" for `path`, and the nearest
/// folder above it that exists is on the backups' volume (`on_backups_volume`). A
/// permission error, a path under a file, a link that leads nowhere, or an ancestor
/// that cannot be examined all count as "there". An absent stick leaves `/Volumes/<name>` missing or, on Linux,
/// an empty mount point of another file system: neither is "gone".
fn gone_with(path: &Path, on_backups_volume: impl Fn(&Path) -> bool) -> bool {
    match fs::symlink_metadata(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        _ => return false,
    }
    let mut folder = path.parent();
    while let Some(dir) = folder {
        match fs::symlink_metadata(dir) {
            Ok(meta) if meta.is_symlink() => {
                // A link is judged by where it leads; one that leads nowhere (a share
                // that is not mounted) cannot be told from a deleted folder.
                return fs::metadata(dir).is_ok_and(|target| target.is_dir())
                    && on_backups_volume(dir);
            }
            Ok(meta) => return meta.is_dir() && on_backups_volume(dir),
            Err(err) if err.kind() == io::ErrorKind::NotFound => folder = dir.parent(),
            Err(_) => return false,
        }
    }
    false
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
    use crate::source_scan;
    use std::time::Duration;

    /// The mode names are a contract with `core/settings/schema.ts`: Rust reads the
    /// value the dialog writes, and a rename on either side would silently turn
    /// backups off (AD-8 keeps the setting in one place, not in two spellings).
    #[test]
    fn the_mode_names_match_the_typescript_schema() {
        let ts = source_scan::lf(include_str!("../../src/lib/core/settings/schema.ts"));
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
                count: DEFAULT_BACKUP_COUNT,
                total_mb: DEFAULT_TOTAL_MB,
                orphan_days: DEFAULT_ORPHAN_DAYS,
            }
        );
    }

    /// Standing rule 2 and 8 (G8): a command that takes a path from the webview asks
    /// the fs scope about it, and does nothing else itself. The needles are built at
    /// compile time so this test's own text is not one of their hits.
    #[test]
    fn the_command_asks_the_fs_scope_and_touches_nothing_itself() {
        let source = source_scan::lf(include_str!("backup.rs"));
        let signature = concat!(
            "pub async fn files_",
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
        // The scope check and the copy touch the share, so neither may
        // run on the main thread.
        assert!(
            body.contains(concat!("spawn_", "blocking(")),
            "the command does its work on the thread that called it"
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
                count: DEFAULT_BACKUP_COUNT,
                total_mb: DEFAULT_TOTAL_MB,
                orphan_days: DEFAULT_ORPHAN_DAYS,
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
                BackupSettings {
                    mode,
                    count,
                    ..BackupSettings::default()
                },
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
            ..BackupSettings::default()
        }
    }

    fn sibling() -> BackupSettings {
        BackupSettings {
            mode: BackupMode::Sibling,
            count: 5,
            ..BackupSettings::default()
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
        // The pin is on the hash rather than on the key, because those two are not
        // the same digits everywhere: `folder_key` hashes the path as `Path` spells
        // it once normalized, and Windows spells `/nc/jobs` as `\nc\jobs`. Pinning
        // the digits of one spelling would only record which platform ran the test.
        // Pinning `fnv32` records the thing that must not move: swap FNV-1a for
        // another hash, or change its seed or its prime, and every key changes at
        // once. No backup would be lost, but every one already on disk would end up
        // behind a folder nothing ever looks in again.
        assert_eq!(fnv32("/nc/jobs"), "fff5fc22");
        // And this folder's key is that hash over the name this platform gives the
        // folder, with nothing else done to it on the way: no trailing separator, no
        // case change (this path is already lower case), no rewritten root. On a
        // platform whose separator is `/` the two assertions together are the old
        // `key == "fff5fc22"`, spelled so that Windows can hold it too.
        let spelled = format!("{sep}nc{sep}jobs", sep = std::path::MAIN_SEPARATOR);
        assert_eq!(key, fnv32(&spelled));
        assert_eq!(key, folder_key(Path::new("/nc//./jobs")));
        assert_ne!(key, folder_key(Path::new("/nc/other")));
        assert_eq!(
            folder_key(Path::new("/NC/Jobs")) == key,
            paths::FOLD_CASE,
            "the case rule does not match the platform's"
        );
    }

    /// M8: a CAM post that names its output after the part, the operation, the tool
    /// and the date writes names this long, and the *stamp in front of it* is what
    /// takes the history entry past what a file name may be — 255 on NTFS, ext4 and
    /// APFS alike — so the user's file saves and its backup does not. In `history`,
    /// which is the default mode, at every save.
    #[test]
    fn a_long_cam_name_is_shortened_into_a_name_the_file_system_takes() {
        let (root, dirs) = scratch("long-name");
        let stem: String =
            "1234567_Gehaeuse_Deckel_OP20_Schlichten_Kontur_D12R1_Werkzeug_17_Rev_C_"
                .repeat(4)
                .chars()
                .take(237)
                .collect();
        let name = format!("{stem}.NC");
        // A name the user can perfectly well keep on disk, whose history entry — the
        // same name with the stamp in front of it — is not a name at all.
        assert!(name.len() < MAX_COMPONENT, "{} is unusable", name.len());
        assert!(
            ENTRY_PREFIX_LEN + name.len() > MAX_COMPONENT,
            "the entry would fit, so this proves nothing"
        );
        let source = program(&root, &name, "G0 X0\n");

        let target = PathBuf::from(
            backup(&dirs, history(2), &source, at(1_000))
                .unwrap()
                .expect("no backup was made"),
        );
        assert!(target.is_file(), "{} was not written", target.display());

        // Every component of it is a legal name, with room for the temp file that
        // `copy_atomic` writes beside the entry while it copies.
        for component in target.strip_prefix(dirs.backups_dir()).unwrap().iter() {
            assert!(
                component.len() + TEMP_AFFIX_LEN <= MAX_COMPONENT,
                "{component:?} is {} long",
                component.len()
            );
        }
        // And it is still the user's file: the head of the name they gave it, and the
        // extension that says what it is.
        let folder = target
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert!(folder.starts_with(&stem[..64]), "unrecognizable: {folder}");
        assert!(folder.ends_with(".NC"), "the extension is gone: {folder}");
        assert_eq!(
            target.file_name().unwrap().to_str().unwrap(),
            format!("19700101-000001.000-{folder}")
        );

        // A second save of the same file lands in the same history, and pruning still
        // reads the entries — `prune` tells our stamp from the document's own name by
        // comparing it with the folder's name, which is the shortened one now.
        backup(&dirs, history(2), &source, at(2_000)).unwrap();
        backup(&dirs, history(2), &source, at(3_000)).unwrap();
        let mut kept: Vec<String> = fs::read_dir(target.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        kept.sort();
        assert_eq!(
            kept,
            vec![
                format!("19700101-000002.000-{folder}"),
                format!("19700101-000003.000-{folder}")
            ]
        );

        // Two programs whose names agree for the first two hundred characters are two
        // programs: the hash in the shortened name keeps their histories apart.
        let sibling = program(&root, &format!("{stem}_OP30.NC"), "G0 X1\n");
        let other = PathBuf::from(
            backup(&dirs, history(2), &sibling, at(4_000))
                .unwrap()
                .unwrap(),
        );
        assert_ne!(other.parent(), target.parent());
        assert_eq!(fs::read_to_string(&other).unwrap(), "G0 X1\n");

        // And the same once more for the *widest* entry name there is. Everything
        // above files at `<stamp>-<name>`; two saves inside one millisecond make
        // `unique_name` write `<stamp>-<n>-<name>` instead, which is up to three
        // characters longer (G8 M8 — `ENTRY_PREFIX_LEN` used to budget for the narrow
        // one, so this whole invariant was false for every same-millisecond entry).
        let first = PathBuf::from(
            backup(&dirs, history(2), &source, at(9_000))
                .unwrap()
                .unwrap(),
        );
        let second = PathBuf::from(
            backup(&dirs, history(2), &source, at(9_000))
                .unwrap()
                .unwrap(),
        );
        assert_ne!(
            first, second,
            "the collision was not filed under its own name"
        );
        assert_eq!(
            second.file_name().unwrap().to_str().unwrap(),
            format!("19700101-000009.000-1-{folder}")
        );
        for component in second.strip_prefix(dirs.backups_dir()).unwrap().iter() {
            assert!(
                component.len() + TEMP_AFFIX_LEN <= MAX_COMPONENT,
                "{component:?} is {} long",
                component.len()
            );
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// The budget is the prefix [`unique_name`] can really write, not the usual one:
    /// read off the widest name it can build rather than restated, so a change to
    /// either of its two formats has to be made here too (G8 M8).
    #[test]
    fn the_entry_prefix_budget_is_the_widest_prefix_unique_name_writes() {
        let stamp = stamp(at(0));
        assert_eq!(stamp.len(), STAMP_LEN);
        assert_eq!(
            ENTRY_PREFIX_LEN,
            format!("{stamp}-")
                .len()
                .max(format!("{stamp}-{MAX_SAME_MILLISECOND}-").len())
        );
    }

    /// The shortening is only for the names that need it: every history already on
    /// disk has to keep the folder it is in.
    #[test]
    fn an_ordinary_name_is_filed_under_itself() {
        assert_eq!(history_name(OsStr::new("WELLE.NC")), OsStr::new("WELLE.NC"));
        let at_the_limit = "a".repeat(MAX_HISTORY_NAME);
        assert_eq!(
            history_name(OsStr::new(&at_the_limit)),
            OsStr::new(&at_the_limit)
        );
        // One character more is shortened, and to the budget exactly.
        let over = "a".repeat(MAX_HISTORY_NAME + 1);
        assert_eq!(history_name(OsStr::new(&over)).len(), MAX_HISTORY_NAME);
        // A name that is all extension keeps the head instead: `MAX_EXTENSION` is
        // what stops the tail from eating the part that identifies the file.
        let all_extension = format!("part.{}", "x".repeat(MAX_HISTORY_NAME));
        let short = history_name(OsStr::new(&all_extension));
        assert!(
            short.to_str().unwrap().starts_with("part."),
            "{short:?} is not the user's name any more"
        );
        assert_eq!(short.len(), MAX_HISTORY_NAME);
        // A multi-byte character is never cut in half.
        let german = format!("{}.NC", "Gehäuse_".repeat(40));
        let short = history_name(OsStr::new(&german));
        assert!(short.to_str().is_some(), "cut a character in half");
        assert!(short.len() <= MAX_HISTORY_NAME);
    }

    /// M8: the same Windows folder reaches `files_backup` as `C:\nc` from the file
    /// dialog and as `\\?\C:\nc` from anything that canonicalized it, and the second
    /// spelling would open a second history — the five versions the user thinks they
    /// have would be split over two folders, neither of them full.
    #[test]
    fn the_two_windows_spellings_of_one_folder_share_one_history() {
        assert_eq!(
            folder_key(Path::new(r"\\?\C:\nc\jobs")),
            folder_key(Path::new(r"C:\nc\jobs"))
        );
        assert_eq!(
            folder_key(Path::new(r"\\?\UNC\nas\cam\jobs")),
            folder_key(Path::new(r"\\nas\cam\jobs"))
        );
        // Still a folder key, not a shared bucket: two folders keep two histories.
        assert_ne!(
            folder_key(Path::new(r"\\?\C:\nc\jobs")),
            folder_key(Path::new(r"C:\nc\other"))
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
            ..BackupSettings::default()
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

    // --- the global pass: an overall cap and expiry (B1 A2) --------------------

    const DAY_MS: u64 = 86_400_000;
    const MIB: usize = 1_048_576;
    /// 2033-05-18, far from any real file's mtime and well after 1970.
    const NOW_MS: u64 = 2_000_000_000_000;

    /// Files a history of `source` the way `backup` does (entries named by stamp, the
    /// folder note), one entry per age in days, each `size` bytes.
    fn history_with(dirs: &AppDirs, source: &Path, ages_days: &[u64], size: usize) -> PathBuf {
        let dir = history_dir(dirs, source).unwrap();
        let name = history_name(file_name(source).unwrap());
        for age in ages_days {
            let stamp = stamp(at(NOW_MS - age * DAY_MS));
            let mut file = OsString::from(format!("{stamp}-"));
            file.push(&name);
            fs::write(dir.join(file), vec![b'G'; size]).unwrap();
        }
        note_folder(dirs, source);
        dir
    }

    /// The stamps of the entries in `dir`, oldest first.
    fn stamps_in(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy()[..STAMP_LEN].to_owned())
            .collect();
        out.sort();
        out
    }

    fn files_in(dir: &Path) -> usize {
        fs::read_dir(dir).map_or(0, |entries| entries.flatten().count())
    }

    /// Existence as the real pass sees it, for a history whose folder is on the
    /// backups' own volume (every scratch folder here is).
    fn really_gone(path: &Path) -> bool {
        gone_with(path, |_| true)
    }

    /// Overwrites the `.folder` note of `source`'s folder key.
    fn set_note(dirs: &AppDirs, source: &Path, text: &str) {
        let note = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join(FOLDER_NOTE);
        fs::write(note, text).unwrap();
    }

    /// The note of `source`'s folder key, as text.
    fn note_of(dirs: &AppDirs, source: &Path) -> String {
        let note = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join(FOLDER_NOTE);
        fs::read_to_string(note).unwrap()
    }

    /// A history of a file that is not there, filed as living on another volume: a
    /// stick, a share, a second disk.
    fn other_history(dirs: &AppDirs, source: &Path, ages_days: &[u64], size: usize) -> PathBuf {
        let dir = history_with(dirs, source, ages_days, size);
        set_note(
            dirs,
            source,
            &format!("{}\nother", source.parent().unwrap().to_str().unwrap()),
        );
        dir
    }

    /// An existence check that must never be asked.
    fn never_asked(path: &Path) -> bool {
        panic!("the sweep asked whether {} is gone", path.display());
    }

    fn limits(total_mb: u64, orphan_days: u32) -> BackupSettings {
        BackupSettings {
            total_mb,
            orphan_days,
            ..BackupSettings::default()
        }
    }

    #[test]
    fn the_two_limits_are_settings_where_zero_means_no_limit() {
        let read = |json: &str| BackupSettings::from_object(&settings(json));
        let default = BackupSettings::default();
        assert_eq!((default.total_mb, default.orphan_days), (500, 90));
        assert_eq!(read("{}").total_mb, 500);
        assert_eq!(read("{}").orphan_days, 90);
        // Zero is a value, not a missing one.
        let off = read(r#"{"files.backupTotalMb":0,"files.backupOrphanDays":0}"#);
        assert_eq!((off.total_mb, off.orphan_days), (0, 0));
        let own = read(r#"{"files.backupTotalMb":64,"files.backupOrphanDays":30}"#);
        assert_eq!((own.total_mb, own.orphan_days), (64, 30));
        // Hand edits that make no sense fall back or are cut, never to "no limit".
        let odd = read(r#"{"files.backupTotalMb":-3,"files.backupOrphanDays":"x"}"#);
        assert_eq!((odd.total_mb, odd.orphan_days), (500, 90));
        let huge = read(r#"{"files.backupTotalMb":99999999999,"files.backupOrphanDays":99999}"#);
        assert_eq!(
            (huge.total_mb, huge.orphan_days),
            (MAX_TOTAL_MB, MAX_ORPHAN_DAYS)
        );
    }

    #[test]
    fn the_settings_keys_and_defaults_match_the_typescript_schema() {
        let ts = source_scan::lf(include_str!("../../src/lib/core/settings/schema.ts"));
        for (key, default) in [
            (KEY_TOTAL_MB, DEFAULT_TOTAL_MB),
            (KEY_ORPHAN_DAYS, u64::from(DEFAULT_ORPHAN_DAYS)),
        ] {
            assert!(
                ts.contains(&format!("'{key}': {default},")),
                "the default of {key} in schema.ts is not {default}"
            );
        }
    }

    #[test]
    fn a_stamp_reads_back_as_the_moment_it_names() {
        for ms in [0, 1_000, 951_782_400_123, NOW_MS, 4_102_444_799_999] {
            assert_eq!(stamp_millis(&stamp(at(ms))), Some(ms as i64), "{ms}");
        }
        assert_eq!(stamp_millis("20261340-250000.000"), None);
        assert_eq!(stamp_millis("nonsense"), None);
    }

    #[test]
    fn a_backup_notes_the_folder_it_came_from() {
        let (root, dirs) = scratch("note");
        let source = program(&root, "welle.nc", "program\n");
        backup(&dirs, history(5), &source, at(1_000)).unwrap();
        let note = dirs
            .backups_dir()
            .join(folder_key(source.parent().unwrap()))
            .join(FOLDER_NOTE);
        // Line 1 the folder, line 2 whether it is on the backups' own volume.
        assert_eq!(
            fs::read_to_string(note).unwrap(),
            format!("{}\nlocal", source.parent().unwrap().to_str().unwrap())
        );
        // And the note is not an entry: the history is still just the one copy.
        assert_eq!(history_of(&dirs, &source).len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    /// The cap takes the oldest copies of all histories first and stops as soon as
    /// the total fits.
    #[test]
    fn the_total_cap_removes_the_oldest_copies_first() {
        let (root, dirs) = scratch("cap");
        let a = program(&root, "a.nc", "a");
        let b = program(&root, "b.nc", "b");
        let dir_a = history_with(&dirs, &a, &[1, 5, 9], MIB);
        let dir_b = history_with(&dirs, &b, &[2, 6], MIB);

        // 5 MiB in total, cap 3: the two oldest of all (9 and 6 days) go.
        let report = sweep(&dirs.backups_dir(), &limits(3, 90), at(NOW_MS), really_gone);
        assert_eq!(report.entries, 2);
        assert_eq!(report.bytes, 2 * MIB as u64);
        assert_eq!(files_in(&dir_a), 2);
        assert_eq!(files_in(&dir_b), 1);
        // Which ones are left matters as much as how many: a cap that took the
        // newest of the old ones instead would pass the counts.
        assert_eq!(
            stamps_in(&dir_a),
            [stamp(at(NOW_MS - 5 * DAY_MS)), stamp(at(NOW_MS - DAY_MS))]
        );
        assert_eq!(stamps_in(&dir_b), [stamp(at(NOW_MS - 2 * DAY_MS))]);
        let _ = fs::remove_dir_all(&root);
    }

    /// A cap that is too small for the newest copies leaves the folder over the cap
    /// rather than delete the one backup of a file that still exists.
    #[test]
    fn the_cap_never_takes_the_newest_copy_of_a_file_that_exists() {
        let (root, dirs) = scratch("cap-newest");
        let a = program(&root, "a.nc", "a");
        let b = program(&root, "b.nc", "b");
        let dir_a = history_with(&dirs, &a, &[1, 5], MIB);
        let dir_b = history_with(&dirs, &b, &[2, 6], MIB);

        let report = sweep(&dirs.backups_dir(), &limits(1, 90), at(NOW_MS), really_gone);
        assert_eq!(report.entries, 2);
        assert_eq!(files_in(&dir_a), 1);
        assert_eq!(files_in(&dir_b), 1);
        let _ = fs::remove_dir_all(&root);
    }

    /// Not even for a file that is gone: the newest copy of a deleted local file
    /// leaves only through the orphan rule, after the days, and the cap takes the
    /// older copies of the others first.
    #[test]
    fn the_cap_never_takes_the_newest_copy_of_a_file_that_is_gone() {
        let (root, dirs) = scratch("cap-gone");
        let kept = program(&root, "kept.nc", "k");
        let gone = root.join("nc").join("gone.nc");
        let dir_kept = history_with(&dirs, &kept, &[1, 8], MIB);
        let dir_gone = history_with(&dirs, &gone, &[3], MIB);
        let dir_old = history_with(&dirs, &program(&root, "old.nc", "o"), &[2, 9], MIB);

        // 5 MiB, cap 3: the two oldest copies of all (9 and 8 days) go; the 3-day
        // copy of the deleted file stays, and so does every newest one.
        let report = sweep(&dirs.backups_dir(), &limits(3, 90), at(NOW_MS), never_asked);
        assert_eq!((report.entries, report.histories), (2, 0));
        assert_eq!(stamps_in(&dir_gone), [stamp(at(NOW_MS - 3 * DAY_MS))]);
        assert_eq!(stamps_in(&dir_kept), [stamp(at(NOW_MS - DAY_MS))]);
        assert_eq!(stamps_in(&dir_old), [stamp(at(NOW_MS - 2 * DAY_MS))]);

        // A cap that fits nothing still keeps one copy of every file.
        let report = sweep(&dirs.backups_dir(), &limits(1, 90), at(NOW_MS), never_asked);
        assert_eq!(report.entries, 0);
        assert_eq!(
            files_in(&dir_gone) + files_in(&dir_kept) + files_in(&dir_old),
            3
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_history_of_a_deleted_file_expires_after_the_days_but_not_before() {
        let (root, dirs) = scratch("orphan");
        let long_gone = root.join("nc").join("long-gone.nc");
        let recent_gone = root.join("nc").join("recent-gone.nc");
        let old_but_there = program(&root, "old-but-there.nc", "x");
        let d_long = history_with(&dirs, &long_gone, &[100, 120], 10);
        let d_recent = history_with(&dirs, &recent_gone, &[10, 100], 10);
        let d_there = history_with(&dirs, &old_but_there, &[400, 500], 10);

        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report.histories, 1);
        assert_eq!(report.entries, 2);
        assert!(!d_long.exists(), "a deleted file's old history stayed");
        assert_eq!(files_in(&d_recent), 2, "a young orphan lost copies");
        assert_eq!(
            files_in(&d_there),
            2,
            "the history of a file that exists expired"
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// What cannot be checked is not touched: no folder note (a history from before
    /// this version), a path that cannot be told apart, and zero days or zero MB.
    #[test]
    fn nothing_is_expired_that_cannot_be_shown_to_be_orphaned() {
        let (root, dirs) = scratch("orphan-unknown");
        let gone = root.join("nc").join("gone.nc");
        let d = history_with(&dirs, &gone, &[400], 10);
        let note = dirs
            .backups_dir()
            .join(folder_key(gone.parent().unwrap()))
            .join(FOLDER_NOTE);

        // Zero days: never expire.
        let report = sweep(&dirs.backups_dir(), &limits(0, 0), at(NOW_MS), really_gone);
        assert_eq!(report, SweepReport::default());
        assert_eq!(files_in(&d), 1);

        // An existence check that cannot say "gone".
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), |_| false);
        assert_eq!(report, SweepReport::default());

        // No note: the file is unknown, so it may well exist.
        fs::remove_file(&note).unwrap();
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report, SweepReport::default());
        assert_eq!(files_in(&d), 1);
        let _ = fs::remove_dir_all(&root);
    }

    /// Only stamped entries are ours: a file the user (or a tool) put into a history
    /// folder is neither counted nor deleted, and keeps the folder alive.
    #[test]
    fn a_foreign_file_in_a_history_folder_is_left_alone() {
        let (root, dirs) = scratch("foreign");
        let gone = root.join("nc").join("gone.nc");
        let d = history_with(&dirs, &gone, &[400], 10);
        fs::write(d.join("notes.txt"), b"mine").unwrap();

        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report.entries, 1);
        assert!(d.join("notes.txt").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_real_existence_check_says_gone_only_for_not_found() {
        let (root, dirs) = scratch("gone-on-disk");
        let there = program(&root, "there.nc", "x");
        let missing = root.join("nc").join("missing.nc");
        let backups = dirs.backups_dir();
        let gone = gone_on_disk(&backups);
        assert!(!gone(&there));
        assert!(gone(&missing));
        // The whole folder is gone, the nearest one above it is ours: gone.
        assert!(gone(&root.join("nc").join("deleted-job").join("a.nc")));
        let _ = fs::remove_dir_all(&root);
    }

    // --- B1 code review: the sweep may only judge what it can see (CODE-01, SK-01..03) ---

    /// The review's probes, as layouts. In each the file is missing and its newest
    /// copy is 200 days old; the history is filed as living on another volume, so
    /// neither the days nor the cap may touch it, and the existence check is never
    /// asked about it.
    #[test]
    fn a_history_on_another_volume_never_expires_and_is_never_asked_about() {
        // (what the folder of the file looks like now, how to build it)
        type Layout = (&'static str, fn(&Path));
        let layouts: [Layout; 4] = [
            // The stick is out: its mount point does not exist.
            ("unmounted", |_| {}),
            // Linux leaves the empty mount point behind.
            ("empty mount point", |folder| {
                fs::create_dir_all(folder).unwrap()
            }),
            // Another stick of the same name (or the same drive letter) is in.
            ("same-named second stick", |folder| {
                fs::create_dir_all(folder).unwrap();
                fs::write(folder.join("OTHER.NC"), "x").unwrap();
            }),
            // A share that is not mounted: the same as an absent stick, with a deeper path.
            ("offline share", |_| {}),
        ];
        for (name, build) in layouts {
            let (root, dirs) = scratch(&format!("other-{}", name.replace(' ', "-")));
            let folder = root.join("stick-volume").join("jobs");
            build(&folder);
            let source = folder.join("a.nc");
            let dir = other_history(&dirs, &source, &[200, 201], 10);

            let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), never_asked);
            assert_eq!(report, SweepReport::default(), "{name}: expiry");
            assert_eq!(files_in(&dir), 2, "{name}: expiry");

            // The cap with a MiB per copy: the old copy goes, the newest stays.
            let dir = other_history(&dirs, &source, &[200, 300], MIB);
            let report = sweep(&dirs.backups_dir(), &limits(1, 90), at(NOW_MS), never_asked);
            assert_eq!(report.histories, 0, "{name}: cap");
            assert!(
                stamps_in(&dir).contains(&stamp(at(NOW_MS - 200 * DAY_MS))),
                "{name}: the cap took the newest copy"
            );
            let _ = fs::remove_dir_all(&root);
        }
    }

    /// A reused drive letter, simulated: the note says `other`, and a later backup
    /// finds the same path answering from the backups' own volume. `other` stays.
    #[test]
    fn a_note_that_says_other_does_not_turn_local_again() {
        let (root, dirs) = scratch("sticky-other");
        let source = root.join("nc").join("a.nc");
        let dir = other_history(&dirs, &source, &[200], 10);
        note_folder(&dirs, &source); // the folder is local now
        assert_eq!(
            note_of(&dirs, &source),
            format!("{}\nother", root.join("nc").to_str().unwrap())
        );
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report, SweepReport::default());
        assert_eq!(files_in(&dir), 1);
        // The other direction is followed at once: it was local, now it is not.
        set_note(
            &dirs,
            &source,
            &format!("{}\nlocal", root.join("nc").to_str().unwrap()),
        );
        note_with_key(
            &dirs,
            root.join("nc").to_str().unwrap(),
            &folder_key(&root.join("nc")),
            false,
        );
        assert!(note_of(&dirs, &source).ends_with("\nother"));
        let _ = fs::remove_dir_all(&root);
    }

    /// A note written without a second line counts as `other`, and is brought up to
    /// date by the next backup of the folder.
    #[test]
    fn a_note_without_a_second_line_never_expires_until_it_is_rewritten() {
        let (root, dirs) = scratch("legacy-note");
        let source = root.join("nc").join("gone.nc");
        let dir = history_with(&dirs, &source, &[400], 10);
        let folder = root.join("nc");
        set_note(&dirs, &source, folder.to_str().unwrap());
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report, SweepReport::default());
        assert_eq!(files_in(&dir), 1);
        note_folder(&dirs, &source);
        assert_eq!(
            note_of(&dirs, &source),
            format!("{}\nlocal", folder.to_str().unwrap())
        );
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report.histories, 1);
        let _ = fs::remove_dir_all(&root);
    }

    /// The happy path, three layouts: a deleted file among others, a deleted job folder,
    /// and one that is too young.
    #[test]
    fn a_local_history_of_a_deleted_file_or_folder_expires_whole() {
        let (root, dirs) = scratch("local-orphans");
        let backups = dirs.backups_dir();
        let real = gone_on_disk(&backups);
        // (b) the file is deleted, its neighbours are not.
        program(&root, "neighbour.nc", "n");
        let deleted_file = root.join("nc").join("deleted.nc");
        let d_file = history_with(&dirs, &deleted_file, &[150, 160], 10);
        // (c) the whole job folder is deleted.
        let deleted_job = root.join("nc").join("job-7").join("a.nc");
        fs::create_dir_all(deleted_job.parent().unwrap()).unwrap();
        let d_job = history_with(&dirs, &deleted_job, &[150], 10);
        fs::remove_dir(deleted_job.parent().unwrap()).unwrap();
        // Not old enough.
        let young = root.join("nc").join("young.nc");
        let d_young = history_with(&dirs, &young, &[10], 10);

        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), &real);
        assert_eq!((report.histories, report.entries), (2, 3));
        assert!(!d_file.exists(), "a deleted file's history stayed");
        assert!(!d_job.exists(), "a deleted job folder's history stayed");
        assert_eq!(files_in(&d_young), 1);
        let _ = fs::remove_dir_all(&root);
    }

    /// Two looks: a check that says "gone" once and "there" the next time deletes
    /// nothing, and one that says "gone" twice deletes after having asked twice.
    #[test]
    fn a_history_is_checked_twice_before_it_is_deleted() {
        use std::cell::Cell;
        let (root, dirs) = scratch("two-looks");
        let source = root.join("nc").join("gone.nc");
        let dir = history_with(&dirs, &source, &[400], 10);

        let calls = Cell::new(0);
        let flaky = |_: &Path| {
            calls.set(calls.get() + 1);
            calls.get() == 1
        };
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), flaky);
        assert_eq!(report, SweepReport::default());
        assert_eq!((files_in(&dir), calls.get()), (1, 2));

        calls.set(0);
        let steady = |_: &Path| {
            calls.set(calls.get() + 1);
            true
        };
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), steady);
        assert_eq!((report.histories, calls.get()), (1, 2));
        let _ = fs::remove_dir_all(&root);
    }

    /// The existence check is asked only about histories that are old enough to
    /// matter: the young ones cost no stat.
    #[test]
    fn the_check_is_not_asked_about_young_histories() {
        let (root, dirs) = scratch("lazy-check");
        history_with(&dirs, &root.join("nc").join("young.nc"), &[10, 20], 10);
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), never_asked);
        assert_eq!(report, SweepReport::default());
        let _ = fs::remove_dir_all(&root);
    }

    /// "Gone" also needs the nearest existing folder to be on the backups' volume: a
    /// mount point that was left behind is a folder of another volume.
    #[test]
    fn a_file_under_a_folder_of_another_volume_is_not_gone() {
        let (root, _dirs) = scratch("mount-left-behind");
        let missing = root.join("nc").join("a.nc");
        assert!(gone_with(&missing, |_| true));
        assert!(!gone_with(&missing, |_| false));
        // The ancestor that decides is the nearest one that exists.
        let deep = root.join("nc").join("x").join("y").join("a.nc");
        let seen = std::cell::RefCell::new(Vec::new());
        assert!(gone_with(&deep, |dir| {
            seen.borrow_mut().push(dir.to_path_buf());
            true
        }));
        assert_eq!(*seen.borrow(), [root.join("nc")]);
        // A path under a file is "not a directory", not "not found".
        let file = program(&root, "plain.nc", "x");
        assert!(!gone_with(&file.join("under.nc"), |_| true));
        // Nothing at all above it that exists.
        assert!(!gone_with(Path::new("relative-and-missing.nc"), |_| true));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn the_unix_volume_test_compares_devices_and_follows_links() {
        let (root, _dirs) = scratch("same-volume");
        let sub = root.join("nc").join("sub");
        fs::create_dir_all(&sub).unwrap();
        assert!(same_volume(&root, &sub));
        assert!(same_volume(&sub, &root));
        // `/dev` is its own file system on macOS and on Linux.
        assert!(!same_volume(Path::new("/dev"), &root));
        // A link is the place it leads to.
        let link = root.join("to-dev");
        std::os::unix::fs::symlink("/dev", &link).unwrap();
        assert!(!same_volume(&link, &root));
        // Unknown is "not the same".
        assert!(!same_volume(&root.join("missing"), &root));
        // And a folder of the real `/dev` is not "gone" even though nothing is there.
        let gone = gone_on_disk(&root);
        assert!(!gone(Path::new("/dev/gedit-no-such-folder/a.nc")));
        assert!(!gone(&link.join("gedit-no-such-file")));
        // A link to a place that is not there (a share that is not mounted) is not
        // a deleted folder.
        let dangling = root.join("nc").join("dangling");
        std::os::unix::fs::symlink(root.join("not-mounted"), &dangling).unwrap();
        assert!(!gone_with(&dangling.join("a.nc"), |_| true));
        // A link to a folder of the same volume is that folder.
        let near = root.join("nc").join("near");
        std::os::unix::fs::symlink(&sub, &near).unwrap();
        assert!(gone_with(&near.join("a.nc"), |_| true));
        let _ = fs::remove_dir_all(&root);
    }

    /// The Windows volume test (B1 intB): the drive letter of the resolved path, a network path is
    /// never "the same", and what cannot be resolved is not either. Runs on the Windows CI runner only.
    #[cfg(windows)]
    #[test]
    fn the_windows_volume_test_compares_drive_letters() {
        let (root, _dirs) = scratch("same-volume-windows");
        let sub = root.join("nc").join("sub");
        fs::create_dir_all(&sub).unwrap();
        assert!(same_volume(&root, &sub));
        assert!(same_volume(&sub, &root));
        // A share has no drive letter, and a path that is not there cannot be resolved.
        assert!(!same_volume(
            Path::new(r"\\gedit-no-such-server\share\x"),
            &root
        ));
        assert!(!same_volume(&root.join("missing"), &root));
        let _ = fs::remove_dir_all(&root);
    }

    /// A permission error is "cannot tell", which is "there" (a locked folder).
    #[cfg(unix)]
    #[test]
    fn a_permission_error_is_not_gone() {
        use std::os::unix::fs::PermissionsExt;
        let (root, _dirs) = scratch("locked");
        let locked = root.join("nc").join("locked");
        fs::create_dir_all(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let can_look = fs::symlink_metadata(locked.join("a.nc")).is_ok_and(|_| true)
            || fs::read_dir(&locked).is_ok();
        let answer = gone_with(&locked.join("a.nc"), |_| true);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        // Running as root sees through the lock; then there is nothing to test.
        if !can_look {
            assert!(!answer, "a locked folder read as a deleted file");
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// A history whose file name was shortened does not know its file's real name, so
    /// it never expires, whatever the existence check says.
    #[test]
    fn a_shortened_history_name_is_never_taken_for_the_file() {
        let (root, dirs) = scratch("shortened");
        let long = root
            .join("nc")
            .join(format!("{}.nc", "L".repeat(MAX_HISTORY_NAME + 40)));
        let dir = history_with(&dirs, &long, &[400], 10);
        assert!(dir.file_name().unwrap().len() + 3 >= MAX_HISTORY_NAME);
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), |_| true);
        assert_eq!(report, SweepReport::default());
        assert_eq!(files_in(&dir), 1);
        let _ = fs::remove_dir_all(&root);
    }

    /// Two histories under one `<fnv32>` folder, one of them expires: the other, and
    /// the folder note it needs, stay.
    #[test]
    fn expiring_one_history_leaves_its_sibling_and_the_note() {
        let (root, dirs) = scratch("siblings");
        let old = root.join("nc").join("old.nc");
        let kept = program(&root, "kept.nc", "k");
        let d_old = history_with(&dirs, &old, &[400], 10);
        let d_kept = history_with(&dirs, &kept, &[400], 10);
        let by_folder = d_old.parent().unwrap().to_path_buf();
        assert_eq!(by_folder, d_kept.parent().unwrap());

        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report.histories, 1);
        assert!(!d_old.exists());
        assert_eq!(files_in(&d_kept), 1);
        assert!(by_folder.join(FOLDER_NOTE).is_file(), "the note went");

        // Once the last history goes too, the folder and its note go with it.
        fs::remove_file(&kept).unwrap();
        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), really_gone);
        assert_eq!(report.histories, 1);
        assert!(!by_folder.exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// SK-02: two folders under one key (a hash collision, or two spellings of a name
    /// on a case-sensitive volume) turn the note `ambiguous`, and nothing under the
    /// key expires; the cap still keeps the newest copy.
    #[test]
    fn two_folders_under_one_key_make_the_note_ambiguous() {
        let (root, dirs) = scratch("key-collision");
        let a = root.join("nc").join("A");
        let b = root.join("nc").join("B");
        fs::create_dir_all(&a).unwrap();
        let key = "deadbeef";
        let by_name = dirs.backups_dir().join(key).join("x.nc");
        fs::create_dir_all(&by_name).unwrap();
        for age in [400, 500] {
            let stamp = stamp(at(NOW_MS - age * DAY_MS));
            fs::write(by_name.join(format!("{stamp}-x.nc")), vec![b'G'; MIB]).unwrap();
        }
        note_with_key(&dirs, a.to_str().unwrap(), key, true);
        let note = dirs.backups_dir().join(key).join(FOLDER_NOTE);
        assert_eq!(
            fs::read_to_string(&note).unwrap(),
            format!("{}\nlocal", a.to_str().unwrap())
        );
        // B has no x.nc, A has none either: one of them is "gone", but which?
        note_with_key(&dirs, b.to_str().unwrap(), key, true);
        assert_eq!(
            fs::read_to_string(&note).unwrap(),
            format!("{}\nambiguous", a.to_str().unwrap())
        );
        // A third backup does not undo it, from either folder.
        note_with_key(&dirs, a.to_str().unwrap(), key, true);
        note_with_key(&dirs, b.to_str().unwrap(), key, true);
        assert!(fs::read_to_string(&note).unwrap().ends_with("\nambiguous"));

        let report = sweep(&dirs.backups_dir(), &limits(0, 90), at(NOW_MS), never_asked);
        assert_eq!(report, SweepReport::default());
        assert_eq!(files_in(&by_name), 2);
        let report = sweep(&dirs.backups_dir(), &limits(1, 90), at(NOW_MS), never_asked);
        assert_eq!(report.entries, 1);
        assert_eq!(stamps_in(&by_name), [stamp(at(NOW_MS - 400 * DAY_MS))]);
        let _ = fs::remove_dir_all(&root);
    }

    /// SK-03: a settings file that cannot be used gives no pass at all; a missing one
    /// gives the defaults; a good one gives its values, zeros included.
    #[test]
    fn a_broken_settings_file_gives_no_deleting_pass() {
        let (root, dirs) = scratch("sweep-settings");
        let file = dirs.settings_file();
        let _ = fs::remove_file(&file);
        assert_eq!(sweep_settings(&dirs), Some(BackupSettings::default()));

        fs::write(
            &file,
            r#"{"files.backupTotalMb":0,"files.backupOrphanDays":0}"#,
        )
        .unwrap();
        let off = sweep_settings(&dirs).unwrap();
        assert_eq!((off.total_mb, off.orphan_days), (0, 0));

        // The user set 0, then mistyped the file: the defaults must not come back.
        fs::write(
            &file,
            r#"{"files.backupTotalMb":0,"files.backupOrphanDays":0,"#,
        )
        .unwrap();
        assert_eq!(sweep_settings(&dirs), None);
        assert_eq!(BackupSettings::load(&dirs), BackupSettings::default());
        fs::write(&file, "[1, 2]").unwrap();
        assert_eq!(sweep_settings(&dirs), None);

        // Not a file at all: unreadable.
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        assert_eq!(sweep_settings(&dirs), None);
        let _ = fs::remove_dir_all(&root);
    }

    /// CODE-06: at most one pass in ten minutes.
    #[test]
    fn a_pass_is_due_ten_minutes_after_the_last_one_started() {
        use std::time::Instant;
        let t0 = Instant::now();
        let minutes = |m: u64| t0 + Duration::from_secs(m * 60);
        assert!(due(None, t0));
        assert!(!due(Some(t0), t0));
        assert!(!due(Some(t0), minutes(9)));
        assert!(due(Some(t0), minutes(10)));
        assert!(due(Some(t0), minutes(11)));
    }

    /// CODE-06: the flag is given back by the guard even when the pass panics.
    #[test]
    fn a_panicking_pass_gives_the_sweeping_flag_back() {
        let first = SweepGuard::take().expect("no pass runs in the tests");
        assert!(SweepGuard::take().is_none(), "two passes at once");
        drop(first);
        let result = std::panic::catch_unwind(|| {
            let _guard = SweepGuard::take().unwrap();
            panic!("a pass that fails");
        });
        assert!(result.is_err());
        assert!(SweepGuard::take().is_some(), "the flag stayed set");
    }

    /// CODE-02: the sweep never goes through the bounded stat of `files`, whose
    /// budget of abandoned threads is shared with the user's own stats.
    #[test]
    fn the_sweep_does_not_use_the_shared_bounded_stat() {
        let all = source_scan::lf(include_str!("backup.rs"));
        let code = &all[..all.find("#[cfg(test)]\nmod tests").unwrap()];
        for forbidden in ["run_bounded", "crate::files", "thread::spawn("] {
            assert!(
                !code.contains(forbidden),
                "backup.rs outside its tests uses {forbidden}"
            );
        }
    }
}

//! `state.json`: the recent-files list and the webview's UI state
//! (plan AD-8, AD-9, §7.6).
//!
//! Shape: `{"$version":1,"recent":[…],"ui":{…}}`. Rust owns `recent`; the
//! webview owns `ui` and hands it over whole, and `ui_state_save` merges it into
//! the file without touching `recent`. Writes go through [`crate::atomic`] under
//! the same 1 MiB / JSON-object rules as `settings.json`.
//!
//! The recent list is Rust's because it is also a *scope* concern: at startup
//! [`grant_recent_on_startup`] re-grants the entries that still exist, so a file
//! from the last session reopens without a dialog (D6, a bounded widening of the
//! fs scope), and [`recent_touch`] refuses a path the scope does not already
//! allow, so the webview cannot smuggle an arbitrary path into that list.
//!
//! M7 adds a third owner, [`crate::session`], writing `session`. Every write of
//! this file is therefore a read-modify-write of a document three owners share,
//! and they go through [`update_state`] under one lock — see its own note for
//! what the lock is for.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::config::{self, JsonFile};
use crate::paths::{self, AppDirs, STATE_FILE_NAME};

/// The most recent entries that are re-granted at startup, newest first.
pub const MAX_GRANTED_ON_STARTUP: usize = 50;

/// The longest recent list this build stores, whatever `files.recentLength`
/// says. §7.7 caps that setting at 50; this is the hard ceiling that also holds
/// for a hand-edited settings file or a webview that asks for more.
pub const MAX_RECENT: usize = 50;

/// Rust's member of `state.json`: an array of absolute paths, newest first.
const RECENT_KEY: &str = "recent";
/// The webview's member of `state.json`.
const UI_KEY: &str = "ui";
/// Rust's other member (M7, AD-22): the files that were open at the last quit.
/// [`crate::session`] owns its shape; this module only knows where it lives.
pub const SESSION_KEY: &str = "session";

/// Whether the platform's file names are case-insensitive, which decides how the
/// recent list deduplicates (AD-9). Linux compares byte for byte.
const FOLD_CASE: bool = paths::FOLD_CASE;

/// One entry of the recent-files list (plan §7.6). Serialized in camelCase,
/// matching `RecentEntry` in `src/lib/platform/commands.ts`.
///
/// `exists` is what the list looked like when it was read; a missing entry stays
/// in the list and is shown struck through, so that a file on an unmounted share
/// is not silently forgotten.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub exists: bool,
}

/// `state.json` split into the two halves their owners care about. `file` keeps
/// the whole document, so a rewrite preserves members this build does not know
/// about instead of dropping them.
#[derive(Debug, Clone, Default)]
pub struct StateFile {
    pub file: JsonFile,
    /// `recent`, with non-string and empty members dropped.
    pub recent: Vec<String>,
    /// `ui`, or `{}` when it is missing or not an object.
    pub ui: Map<String, Value>,
}

/// Reads `state.json`. Never fails: an unusable file is an empty state plus the
/// error text, because neither the Recent menu nor the layout may block startup.
/// `recent` is truncated to [`MAX_RECENT`] here, so every consumer downstream is
/// bounded by the same rule the write path applies.
pub fn read_state(path: &Path) -> StateFile {
    let file = config::read_json_object(path, STATE_FILE_NAME);
    let mut recent: Vec<String> = file
        .value
        .get(RECENT_KEY)
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(Value::as_str)
                .filter(|path| !path.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    // The write path caps the list at MAX_RECENT; the read path has to cap it too, or a
    // hand-edited `state.json` (valid JSON, under the 1 MiB cap, so easily 10^5 entries)
    // makes `entries()` stat every one of them on every `recent_list`, and
    // `grant_recent_on_startup` walk the whole list before the window appears — its
    // `.take(50)` only short-circuits once 50 entries have *passed* (G8 M2).
    recent.truncate(MAX_RECENT);
    let ui = file
        .value
        .get(UI_KEY)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    StateFile { file, recent, ui }
}

/// What one write of `state.json` replaces. Every other member of the document
/// — including one a newer build wrote — is kept exactly as it was read.
///
/// `session` is an `Option` because a build that never saves a session has to
/// leave the file as it found it: `None` keeps whatever is on disk (usually
/// nothing at all), `Some` replaces it. Without that, the first splitter drag of
/// a fresh install would write an empty `session` member and `state.json` would
/// grow a key nobody set.
#[derive(Debug, Clone)]
pub struct StateWrite {
    pub recent: Vec<String>,
    pub ui: Map<String, Value>,
    pub session: Option<Value>,
}

/// Writes the owned members back into `state.json`, keeping every other member
/// of the document. Refuses a file written by a newer build, and rescues an
/// unusable one as `state.json.bak` first (both in [`config::save_json_object`]).
fn write_state(path: &Path, state: &StateFile, write: &StateWrite) -> Result<(), String> {
    let mut object = state.file.value.clone();
    object.insert(
        RECENT_KEY.to_owned(),
        Value::Array(write.recent.iter().cloned().map(Value::String).collect()),
    );
    object.insert(UI_KEY.to_owned(), Value::Object(write.ui.clone()));
    if let Some(session) = &write.session {
        object.insert(SESSION_KEY.to_owned(), session.clone());
    }
    config::save_json_object(path, STATE_FILE_NAME, object, &state.file)
}

/// The process-wide lock around every read-modify-write of `state.json`.
///
/// Three owners write this one file: the recent list, the webview's `ui` and
/// (M7) the session. Each reads the whole document, changes its own member and
/// writes the result back, so two that overlap each save a copy of what *they*
/// read — and the second write puts the first writer's member back to the value
/// it had before. `ui_state_save` runs a second after every splitter drag and
/// `session_save` a second after every tab change (AD-22), so the two overlap in
/// ordinary use, and losing the race silently costs a whole session list or the
/// window layout.
///
/// Tauri runs each command on its own task, so the lock belongs here and not in
/// any one caller. It serializes this process only: two gEdit instances sharing
/// one home directory still race, but each write is atomic
/// ([`crate::atomic::write_atomic`]), so the loser of *that* race is a stale
/// document, never a torn one.
static STATE_LOCK: Mutex<()> = Mutex::new(());

/// Reads `state.json`, lets `change` decide from what was on disk what to write,
/// and writes it back — with [`STATE_LOCK`] held across the whole round trip.
///
/// `change` also answers with a value of its own, so a caller that needs to
/// report what it wrote (the recent list) gets it from inside the lock instead
/// of reading the file a second time.
pub fn update_state<T>(
    path: &Path,
    change: impl FnOnce(&StateFile) -> Result<(StateWrite, T), String>,
) -> Result<T, String> {
    // A panic in another writer poisons the lock. What it guards is a file that
    // is replaced atomically, so a poisoned lock says nothing about the file: the
    // next writer reads what is on disk and may safely go ahead.
    let _guard = STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = read_state(path);
    let (write, answer) = change(&state)?;
    write_state(path, &state, &write)?;
    Ok(answer)
}

/// Merges the webview's `ui` into what is on disk: a member that is present
/// replaces its counterpart whole, a member that is absent is kept, and a member
/// set to `null` is removed. That way a store can flush a partial update without
/// losing the layout, and can still forget a key it no longer uses.
fn merge_ui(mut base: Map<String, Value>, incoming: Map<String, Value>) -> Map<String, Value> {
    for (key, value) in incoming {
        if value.is_null() {
            base.remove(&key);
        } else {
            base.insert(key, value);
        }
    }
    base
}

/// The comparison key for one recent path: path components normalized (so
/// `/a//b` and `/a/./b` are one entry) and, on macOS and Windows, case folded.
fn dedupe_key(path: &str) -> String {
    key_with_case(path, FOLD_CASE)
}

fn key_with_case(path: &str, fold_case: bool) -> String {
    let normalized: PathBuf = Path::new(path).components().collect();
    let key = normalized.to_string_lossy().into_owned();
    if fold_case {
        key.to_lowercase()
    } else {
        key
    }
}

/// Puts `path` at the front of `list`, drops every other spelling of it, and
/// truncates to `max` entries (never above [`MAX_RECENT`]). Duplicates already
/// in the list are collapsed too, so a hand-edited file heals itself.
fn touch(list: &[String], path: &str, max: usize) -> Vec<String> {
    touch_with(list, path, max, dedupe_key)
}

fn touch_with(
    list: &[String],
    path: &str,
    max: usize,
    key: impl Fn(&str) -> String,
) -> Vec<String> {
    let max = max.min(MAX_RECENT);
    if max == 0 {
        return Vec::new();
    }
    let mut seen = HashSet::from([key(path)]);
    let mut out = vec![path.to_owned()];
    for entry in list {
        if out.len() == max {
            break;
        }
        if seen.insert(key(entry)) {
            out.push(entry.clone());
        }
    }
    out
}

/// Drops every spelling of `path` from `list`.
fn remove(list: &[String], path: &str) -> Vec<String> {
    remove_with(list, path, dedupe_key)
}

fn remove_with(list: &[String], path: &str, key: impl Fn(&str) -> String) -> Vec<String> {
    let target = key(path);
    list.iter()
        .filter(|entry| key(entry) != target)
        .cloned()
        .collect()
}

/// The list as the webview sees it, with a fresh existence check per entry.
fn entries(list: &[String]) -> Vec<RecentEntry> {
    list.iter()
        .map(|path| RecentEntry {
            path: path.clone(),
            exists: Path::new(path).exists(),
        })
        .collect()
}

/// Adds one file to the fs scope, as written and canonicalized.
///
/// Both spellings are needed: `allow_file` stores the path as it is given, while
/// `is_allowed` canonicalizes what it is asked about, so a path that reaches us
/// through a symlinked folder (`/tmp` on macOS) would otherwise be granted under
/// a name no check ever uses.
///
/// The canonical form is resolved *now*, which for a recent entry means "now" is
/// the next session rather than the one the file was opened in: if the entry is
/// (or sits behind) a symlink whose target has changed since, the new target is
/// what gets granted (G8 M2, accepted). It stays bounded — at most
/// [`MAX_GRANTED_ON_STARTUP`] entries, only ones that exist, and `allow_file`
/// escapes glob metacharacters, so no directory or wildcard can be widened — and
/// it is a same-user situation. Recording the canonical path in `recent` at
/// `recent_touch` time would close it, at the price of showing the resolved path
/// in the Recent menu instead of the one the user typed.
pub fn grant_in(scope: &tauri::fs::Scope, path: &Path) {
    let _ = scope.allow_file(path);
    if let Ok(canonical) = std::fs::canonicalize(path) {
        if canonical != path {
            let _ = scope.allow_file(&canonical);
        }
    }
}

/// [`grant_in`] against the app's fs scope.
pub fn grant_file(app: &AppHandle, path: &Path) {
    grant_in(&app.fs_scope(), path);
}

/// Grants the entries of `paths` that still exist, in order, at most `max` of
/// them. Answers with how many were granted.
///
/// `paths` must already be bounded by its reader (both callers truncate at read
/// time): `max` stops counting once that many entries have *passed*, so a
/// hand-edited list of 100,000 names would still be walked and stat'd in full
/// before the window appears.
pub fn grant_paths(scope: &tauri::fs::Scope, paths: &[String], max: usize) -> usize {
    let existing = paths
        .iter()
        .filter(|path| Path::new(path).exists())
        .take(max);
    let mut granted = 0;
    for path in existing {
        grant_in(scope, Path::new(path));
        granted += 1;
    }
    granted
}

/// Grants the recent entries that still exist, newest first, at most
/// [`MAX_GRANTED_ON_STARTUP`] of them. Answers with how many were granted.
pub fn grant_recent(scope: &tauri::fs::Scope, recent: &[String]) -> usize {
    grant_paths(scope, recent, MAX_GRANTED_ON_STARTUP)
}

// --- the command bodies, split from the commands so that the whole round trip
// --- can be tested against a scratch folder instead of an app handle.

/// The body of [`ui_state_save`]. The payload is judged before the lock is
/// taken, so a refused one neither waits for another writer nor creates a file.
pub fn save_ui(dirs: &AppDirs, ui: Value) -> Result<(), String> {
    let incoming = config::as_object(ui, STATE_FILE_NAME)?;
    update_state(&dirs.state_file(), move |state| {
        Ok((
            StateWrite {
                recent: state.recent.clone(),
                ui: merge_ui(state.ui.clone(), incoming),
                session: None,
            },
            (),
        ))
    })
}

/// The body of [`recent_list`].
pub fn list_recent(dirs: &AppDirs) -> Vec<RecentEntry> {
    entries(&read_state(&dirs.state_file()).recent)
}

/// The body of [`recent_touch`], without the fs-scope check: that one needs the
/// app handle and is the command's own first step.
pub fn touch_recent(dirs: &AppDirs, path: &str, max: u32) -> Result<Vec<RecentEntry>, String> {
    let recent = update_state(&dirs.state_file(), |state| {
        let recent = touch(&state.recent, path, max as usize);
        Ok((
            StateWrite {
                recent: recent.clone(),
                ui: state.ui.clone(),
                session: None,
            },
            recent,
        ))
    })?;
    // Outside the lock: `entries` stats every path, and one of them can be on a
    // share that has gone away.
    Ok(entries(&recent))
}

/// The body of [`recent_remove`] and [`recent_clear`]: read, change, write,
/// answer. A write that fails (a read-only `state.json`, a full disk) is
/// reported on stderr and the list on disk is answered with, so the menu shows
/// the truth rather than a change that did not happen.
pub fn change_recent(
    dirs: &AppDirs,
    change: impl FnOnce(&[String]) -> Vec<String>,
) -> Vec<RecentEntry> {
    let file = dirs.state_file();
    let written = update_state(&file, |state| {
        let recent = change(&state.recent);
        Ok((
            StateWrite {
                recent: recent.clone(),
                ui: state.ui.clone(),
                session: None,
            },
            recent,
        ))
    });
    match written {
        Ok(recent) => entries(&recent),
        Err(err) => {
            eprintln!("gEdit: {err}");
            // Nothing was written, so what is on disk is still the answer.
            entries(&read_state(&file).recent)
        }
    }
}

/// Merges `ui` into the `ui` member of `state.json`, leaving `recent` alone.
/// `ui` must be a JSON object of at most [`crate::config::MAX_FILE_BYTES`].
#[tauri::command]
pub fn ui_state_save(app: AppHandle, ui: Value) -> Result<(), String> {
    save_ui(&paths::app_dirs(&app)?, ui)
}

/// The recent list, newest first, each entry with a fresh `exists`.
/// Infallible on purpose: a broken `state.json` answers with an empty list
/// rather than an error, because the Recent menu must never block startup.
#[tauri::command]
pub fn recent_list(app: AppHandle) -> Vec<RecentEntry> {
    match paths::app_dirs(&app) {
        Ok(dirs) => list_recent(&dirs),
        Err(_) => Vec::new(),
    }
}

/// Moves `path` to the front of the list and truncates it to `max` entries.
/// Errors unless `fs_scope().is_allowed(path)` is already true, so only a file
/// the user picked, dropped or reopened can get in. Deduplication is
/// case-insensitive on macOS and Windows.
#[tauri::command]
pub fn recent_touch(app: AppHandle, path: String, max: u32) -> Result<Vec<RecentEntry>, String> {
    if !app.fs_scope().is_allowed(&path) {
        return Err(format!("{path} is not in the file scope"));
    }
    touch_recent(&paths::app_dirs(&app)?, &path, max)
}

/// Drops `path` from the list and answers with what is left.
#[tauri::command]
pub fn recent_remove(app: AppHandle, path: String) -> Vec<RecentEntry> {
    match paths::app_dirs(&app) {
        Ok(dirs) => change_recent(&dirs, |recent| remove(recent, &path)),
        Err(_) => Vec::new(),
    }
}

/// Empties the list.
#[tauri::command]
pub fn recent_clear(app: AppHandle) -> Vec<RecentEntry> {
    match paths::app_dirs(&app) {
        Ok(dirs) => change_recent(&dirs, |_| Vec::new()),
        Err(_) => Vec::new(),
    }
}

/// Grants at most [`MAX_GRANTED_ON_STARTUP`] existing recent entries to the fs
/// scope, both as written and canonicalized (a recent entry may point through a
/// symlink), so that the Recent menu can reopen them without a dialog. Called
/// from `setup_app`. Entries that no longer exist are not granted.
pub fn grant_recent_on_startup(app: &AppHandle) {
    let Ok(dirs) = paths::app_dirs(app) else {
        return;
    };
    let state = read_state(&dirs.state_file());
    grant_recent(&app.fs_scope(), &state.recent);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gedit-state-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn list(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path| (*path).to_owned()).collect()
    }

    fn sensitive(path: &str) -> String {
        key_with_case(path, false)
    }

    fn insensitive(path: &str) -> String {
        key_with_case(path, true)
    }

    fn written(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }

    // --- the pure recent-list rules (AD-9) ---------------------------------

    #[test]
    fn touch_puts_the_path_first_and_keeps_the_rest_in_order() {
        let before = list(&["/a.nc", "/b.nc", "/c.nc"]);
        assert_eq!(
            touch(&before, "/c.nc", 10),
            list(&["/c.nc", "/a.nc", "/b.nc"])
        );
        assert_eq!(
            touch(&before, "/new.nc", 10),
            list(&["/new.nc", "/a.nc", "/b.nc", "/c.nc"])
        );
    }

    #[test]
    fn touch_truncates_to_max_and_never_past_the_hard_ceiling() {
        let before = list(&["/a.nc", "/b.nc", "/c.nc"]);
        assert_eq!(touch(&before, "/n.nc", 2), list(&["/n.nc", "/a.nc"]));
        assert_eq!(touch(&before, "/n.nc", 1), list(&["/n.nc"]));
        // `files.recentLength` may be 0 (§7.7): the list is then simply off.
        assert_eq!(touch(&before, "/n.nc", 0), Vec::<String>::new());

        let long: Vec<String> = (0..80).map(|n| format!("/f{n}.nc")).collect();
        let touched = touch(&long, "/n.nc", u32::MAX as usize);
        assert_eq!(touched.len(), MAX_RECENT);
        assert_eq!(touched[0], "/n.nc");
    }

    #[test]
    fn touch_collapses_duplicates_already_in_the_list() {
        let before = list(&["/a.nc", "/a.nc", "/b.nc", "/a.nc"]);
        assert_eq!(touch(&before, "/b.nc", 10), list(&["/b.nc", "/a.nc"]));
    }

    #[test]
    fn touch_treats_different_spellings_of_one_path_as_one_entry() {
        let before = list(&["/dir/a.nc", "/b.nc"]);
        for spelling in ["/dir//a.nc", "/dir/./a.nc"] {
            assert_eq!(
                touch_with(&before, spelling, 10, sensitive),
                list(&[spelling, "/b.nc"]),
                "{spelling}"
            );
        }
    }

    /// AD-9: case-insensitive on macOS and Windows, byte for byte on Linux.
    #[test]
    fn touch_folds_case_only_where_the_platform_does() {
        let before = list(&["/dir/A.nc"]);
        assert_eq!(
            touch_with(&before, "/dir/a.nc", 10, insensitive),
            list(&["/dir/a.nc"])
        );
        assert_eq!(
            touch_with(&before, "/dir/a.nc", 10, sensitive),
            list(&["/dir/a.nc", "/dir/A.nc"])
        );
        assert_eq!(
            FOLD_CASE,
            cfg!(any(target_os = "macos", target_os = "windows"))
        );
    }

    #[test]
    fn remove_drops_every_spelling_and_leaves_the_rest() {
        let before = list(&["/dir/A.nc", "/dir//a.nc", "/b.nc"]);
        assert_eq!(
            remove_with(&before, "/dir/a.nc", insensitive),
            list(&["/b.nc"])
        );
        assert_eq!(
            remove_with(&before, "/dir/a.nc", sensitive),
            list(&["/dir/A.nc", "/b.nc"])
        );
        assert_eq!(remove_with(&before, "/nope.nc", sensitive), before);
    }

    #[test]
    fn entries_report_whether_each_file_is_still_there() {
        let dir = scratch("entries");
        let here = dir.join("a.nc");
        fs::write(&here, b"G0\n").unwrap();
        let gone = dir.join("gone.nc");
        let reported = entries(&list(&[here.to_str().unwrap(), gone.to_str().unwrap()]));
        assert!(reported[0].exists);
        assert!(!reported[1].exists);
        assert_eq!(reported[1].path, gone.to_str().unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    // --- the file ----------------------------------------------------------

    #[test]
    fn reads_both_halves_and_survives_a_broken_file() {
        let dir = scratch("read");
        let path = dir.join(STATE_FILE_NAME);
        fs::write(
            &path,
            r#"{"$version":1,"recent":["/a.nc",3,"","/b.nc"],"ui":{"layout":{"x":1}}}"#,
        )
        .unwrap();
        let state = read_state(&path);
        assert_eq!(state.recent, list(&["/a.nc", "/b.nc"]));
        assert_eq!(state.ui.get("layout"), Some(&serde_json::json!({"x": 1})));
        assert_eq!(state.file.error, None);

        fs::write(&path, "{not json").unwrap();
        let state = read_state(&path);
        assert!(state.recent.is_empty() && state.ui.is_empty());
        assert!(state.file.error.is_some() && state.file.unusable);

        // `recent` and `ui` of the wrong type are simply absent, not fatal.
        fs::write(&path, r#"{"recent":"nope","ui":42}"#).unwrap();
        let state = read_state(&path);
        assert!(state.recent.is_empty() && state.ui.is_empty());
        assert_eq!(state.file.error, None);
        let _ = fs::remove_dir_all(&dir);
    }

    /// G8 M2: `MAX_RECENT` was enforced on the write path only, so a hand-edited
    /// file made `recent_list` stat every entry and `grant_recent` walk the whole
    /// list at startup.
    #[test]
    fn a_hand_edited_list_is_cut_to_max_recent_when_it_is_read() {
        let dir = scratch("cap-read");
        let path = dir.join(STATE_FILE_NAME);
        let many: Vec<String> = (0..200).map(|i| format!("/nc/{i}.nc")).collect();
        fs::write(
            &path,
            serde_json::json!({ "$version": 1, "recent": many }).to_string(),
        )
        .unwrap();

        let state = read_state(&path);

        assert_eq!(state.recent.len(), MAX_RECENT);
        // The newest entries are the ones that are kept.
        assert_eq!(state.recent[0], "/nc/0.nc");
        assert_eq!(
            state.recent[MAX_RECENT - 1],
            format!("/nc/{}.nc", MAX_RECENT - 1)
        );
        // And every consumer is bounded by the same rule.
        assert_eq!(
            list_recent(&AppDirs {
                config: dir.clone(),
                data: dir.clone()
            })
            .len(),
            MAX_RECENT
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_write_keeps_the_other_half_and_unknown_members() {
        let dir = scratch("write");
        let path = dir.join(STATE_FILE_NAME);
        fs::write(
            &path,
            r#"{"$version":1,"recent":["/a.nc"],"ui":{"layout":1},"future":"keep"}"#,
        )
        .unwrap();

        let state = read_state(&path);
        let merged = merge_ui(
            state.ui.clone(),
            serde_json::from_str(r#"{"lastScript":"s"}"#).unwrap(),
        );
        write_state(
            &path,
            &state,
            &StateWrite {
                recent: state.recent.clone(),
                ui: merged,
                session: None,
            },
        )
        .unwrap();

        assert_eq!(
            written(&path),
            serde_json::json!({
                "$version": 1,
                "recent": ["/a.nc"],
                "ui": {"layout": 1, "lastScript": "s"},
                "future": "keep"
            })
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_replaces_present_members_keeps_absent_ones_and_removes_nulls() {
        let base: Map<String, Value> =
            serde_json::from_str(r#"{"layout":{"a":1},"lastScript":"s"}"#).unwrap();
        let incoming: Map<String, Value> =
            serde_json::from_str(r#"{"layout":{"b":2},"lastScript":null}"#).unwrap();
        assert_eq!(
            Value::Object(merge_ui(base, incoming)),
            serde_json::json!({"layout": {"b": 2}})
        );
    }

    #[test]
    fn a_newer_state_file_is_never_written() {
        let dir = scratch("newer");
        let path = dir.join(STATE_FILE_NAME);
        let before = r#"{"$version":9,"recent":["/a.nc"]}"#;
        fs::write(&path, before).unwrap();
        let state = read_state(&path);
        assert_eq!(state.recent, list(&["/a.nc"]));
        let err = write_state(
            &path,
            &state,
            &StateWrite {
                recent: Vec::new(),
                ui: Map::new(),
                session: None,
            },
        )
        .expect_err("the write went through");
        assert!(err.contains("newer gEdit"), "{err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        let _ = fs::remove_dir_all(&dir);
    }

    // --- the fs scope (AD-9) ------------------------------------------------

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("could not build the mock app")
    }

    /// The point of the startup grant: after it, `is_allowed` is true for the
    /// files that still exist and false for the ones that do not.
    #[test]
    fn granting_recent_entries_puts_them_into_the_fs_scope() {
        let dir = scratch("grant");
        let here = dir.join("a.nc");
        fs::write(&here, b"G0\n").unwrap();
        let gone = dir.join("gone.nc");
        let other = dir.join("b.nc");
        fs::write(&other, b"G0\n").unwrap();

        let app = mock_app();
        let scope = app.fs_scope();
        assert!(!scope.is_allowed(&here));

        let granted = grant_recent(
            &scope,
            &list(&[here.to_str().unwrap(), gone.to_str().unwrap()]),
        );
        assert_eq!(granted, 1);
        assert!(scope.is_allowed(&here));
        // A file that was not in the list stays out, and a missing entry is not
        // granted ahead of time.
        assert!(!scope.is_allowed(&other));
        assert!(!scope.is_allowed(&gone));
        let _ = fs::remove_dir_all(&dir);
    }

    /// `is_allowed` canonicalizes, so a path reached through a symlinked folder
    /// only works when the canonical spelling is granted too.
    #[cfg(unix)]
    #[test]
    fn granting_covers_the_canonical_path_as_well() {
        let dir = scratch("symlink");
        let real = dir.join("real");
        fs::create_dir_all(&real).unwrap();
        let file = real.join("a.nc");
        fs::write(&file, b"G0\n").unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let through_link = link.join("a.nc");

        let app = mock_app();
        let scope = app.fs_scope();
        grant_in(&scope, &through_link);
        assert!(scope.is_allowed(&through_link));
        assert!(scope.is_allowed(&file));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_startup_grant_stops_at_fifty_entries() {
        let dir = scratch("cap");
        let paths: Vec<String> = (0..MAX_GRANTED_ON_STARTUP + 5)
            .map(|n| {
                let path = dir.join(format!("f{n}.nc"));
                fs::write(&path, b"G0\n").unwrap();
                path.to_string_lossy().into_owned()
            })
            .collect();

        let app = mock_app();
        let scope = app.fs_scope();
        assert_eq!(grant_recent(&scope, &paths), MAX_GRANTED_ON_STARTUP);
        assert!(scope.is_allowed(&paths[MAX_GRANTED_ON_STARTUP - 1]));
        assert!(!scope.is_allowed(&paths[MAX_GRANTED_ON_STARTUP]));
        let _ = fs::remove_dir_all(&dir);
    }

    // --- the command bodies, end to end over a scratch home ------------------

    fn scratch_dirs(name: &str) -> (PathBuf, AppDirs) {
        let root = scratch(name);
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        dirs.ensure();
        (root, dirs)
    }

    fn paths_of(entries: &[RecentEntry]) -> Vec<String> {
        entries.iter().map(|entry| entry.path.clone()).collect()
    }

    #[test]
    fn touching_writes_the_list_and_the_next_read_sees_it() {
        let (root, dirs) = scratch_dirs("recent-round-trip");
        assert_eq!(list_recent(&dirs), Vec::new());

        let a = root.join("a.nc").to_string_lossy().into_owned();
        let b = root.join("b.nc").to_string_lossy().into_owned();
        fs::write(&a, b"G0\n").unwrap();

        assert_eq!(
            paths_of(&touch_recent(&dirs, &a, 15).unwrap()),
            vec![a.clone()]
        );
        let after_b = touch_recent(&dirs, &b, 15).unwrap();
        assert_eq!(paths_of(&after_b), vec![b.clone(), a.clone()]);
        // `exists` is a fresh check, so a path that was never written is marked.
        assert!(!after_b[0].exists && after_b[1].exists);
        assert_eq!(paths_of(&list_recent(&dirs)), vec![b.clone(), a.clone()]);

        assert_eq!(
            paths_of(&change_recent(&dirs, |recent| remove(recent, &b))),
            vec![a.clone()]
        );
        assert_eq!(change_recent(&dirs, |_| Vec::new()), Vec::new());
        assert_eq!(list_recent(&dirs), Vec::new());
        let _ = fs::remove_dir_all(&root);
    }

    /// The two halves of `state.json` are independent: saving `ui` must not
    /// disturb `recent`, and touching a file must not disturb `ui`.
    #[test]
    fn ui_and_recent_do_not_overwrite_each_other() {
        let (root, dirs) = scratch_dirs("halves");
        let a = root.join("a.nc").to_string_lossy().into_owned();
        touch_recent(&dirs, &a, 15).unwrap();

        save_ui(&dirs, serde_json::json!({"layout": {"sidebar": 240}})).unwrap();
        save_ui(&dirs, serde_json::json!({"lastScript": "bundled:x.py"})).unwrap();

        let loaded = config::load(&dirs);
        assert_eq!(
            loaded.ui,
            serde_json::json!({"layout": {"sidebar": 240}, "lastScript": "bundled:x.py"})
        );
        assert_eq!(paths_of(&list_recent(&dirs)), vec![a.clone()]);

        touch_recent(&dirs, &a, 15).unwrap();
        assert_eq!(config::load(&dirs).ui, loaded.ui);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_non_object_ui_payload_is_refused_and_nothing_is_written() {
        let (root, dirs) = scratch_dirs("ui-non-object");
        let err = save_ui(&dirs, serde_json::json!([1, 2])).expect_err("accepted an array");
        assert_eq!(err, "state.json: expected a JSON object");
        assert!(!dirs.state_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// A broken `state.json` is not fatal, and the next write keeps it as `.bak`.
    #[test]
    fn a_broken_state_file_is_kept_as_bak_on_the_next_write() {
        let (root, dirs) = scratch_dirs("state-bak");
        fs::write(dirs.state_file(), "[]").unwrap();
        assert_eq!(list_recent(&dirs), Vec::new());
        assert!(config::load(&dirs).state_error.is_some());

        save_ui(&dirs, serde_json::json!({"layout": 1})).unwrap();
        assert_eq!(
            fs::read_to_string(config::bak_path(&dirs.state_file())).unwrap(),
            "[]"
        );
        assert_eq!(config::load(&dirs).state_error, None);
        let _ = fs::remove_dir_all(&root);
    }

    // --- the lock around the read-modify-write (M7) --------------------------

    /// A write that does not mean to touch the session must not invent one: a
    /// fresh install's `state.json` has the two members P1 wrote and no more.
    #[test]
    fn a_write_without_a_session_never_creates_the_member() {
        let (root, dirs) = scratch_dirs("no-session");
        save_ui(&dirs, serde_json::json!({"layout": 1})).unwrap();
        let mut members: Vec<String> = written(&dirs.state_file())
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        members.sort();
        assert_eq!(members, vec!["$version", "recent", "ui"]);

        // And a write that does mean to adds exactly one member.
        update_state(&dirs.state_file(), |state| {
            Ok((
                StateWrite {
                    recent: state.recent.clone(),
                    ui: state.ui.clone(),
                    session: Some(serde_json::json!({"paths": ["/a.nc"], "active": 0})),
                },
                (),
            ))
        })
        .unwrap();
        let after = written(&dirs.state_file());
        assert_eq!(
            after.get("session"),
            Some(&serde_json::json!({"paths": ["/a.nc"], "active": 0}))
        );
        assert_eq!(after.get("ui"), Some(&serde_json::json!({"layout": 1})));
        let _ = fs::remove_dir_all(&root);
    }

    /// The whole point of [`STATE_LOCK`]. Two owners of this file write it a
    /// second after the same gesture (a tab change moves both `ui` and the
    /// session), and each of them writes back a copy of everything it read. The
    /// thread below stops **after its read**, lets the other one run a complete
    /// read-modify-write, and only then writes.
    ///
    /// Without the lock the second writer gets in during that window and the
    /// first writer's write puts `state.json` back to what it read: its `b` is
    /// gone, silently. With the lock the second writer cannot start until the
    /// first has finished, so both members survive. Removing the lock from
    /// `update_state` makes this fail.
    #[test]
    fn two_writers_of_state_json_do_not_lose_each_others_member() {
        use std::sync::mpsc;
        use std::time::Duration;

        let (root, dirs) = scratch_dirs("lock");
        save_ui(&dirs, serde_json::json!({"start": true})).unwrap();

        let (has_read, read_happened) = mpsc::channel::<()>();
        let (b_done, b_finished) = mpsc::channel::<()>();

        let second = {
            let dirs = dirs.clone();
            std::thread::spawn(move || {
                // Only start once the first writer has read the file.
                read_happened.recv().expect("the first writer never read");
                save_ui(&dirs, serde_json::json!({"b": 2})).unwrap();
                let _ = b_done.send(());
            })
        };

        update_state(&dirs.state_file(), |state| {
            has_read.send(()).unwrap();
            // With the lock held, the other writer is blocked and this times out;
            // without it, it finishes here and this returns at once.
            let _ = b_finished.recv_timeout(Duration::from_secs(2));
            let mut ui = state.ui.clone();
            ui.insert("a".to_owned(), Value::from(1));
            Ok((
                StateWrite {
                    recent: state.recent.clone(),
                    ui,
                    session: None,
                },
                (),
            ))
        })
        .unwrap();
        second.join().unwrap();

        assert_eq!(
            config::load(&dirs).ui,
            serde_json::json!({"start": true, "a": 1, "b": 2}),
            "a write built from a stale read overwrote the other writer"
        );
        let _ = fs::remove_dir_all(&root);
    }
}

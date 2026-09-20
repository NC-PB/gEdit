//! `settings.json`: the user's non-default settings (plan AD-8, §7.6, §7.7).
//!
//! Rust owns every read and write of the file, under a fixed name, so the
//! webview needs no fs scope on the config folder. A write must be a JSON
//! object of at most 1 MiB and goes through [`crate::atomic`]. Invalid JSON
//! never blocks startup: `config_load` answers with `{}` plus `settingsError`,
//! and the bad file is renamed to `settings.json.bak` before the next write.
//! A file whose `$version` is newer than [`SETTINGS_VERSION`] is read but never
//! written over.
//!
//! A file that could not be *read* is a different case from a file that could
//! not be *parsed*, and [`JsonFile::unreadable`] keeps them apart: the first
//! refuses the next write instead of replacing contents nobody has seen.
//!
//! `config_load` is one round trip for both files, because the webview needs
//! both before the first paint (bootstrap awaits `settings.load()` and
//! `uiState.load()`); the `ui` half comes from [`crate::state`].
//!
//! This module also holds the rules both files share — reading, versioning,
//! the size cap and the `.bak` rescue — so that `state.json` cannot drift.

use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::atomic::write_atomic;
use crate::paths::{self, ConfigPaths};

/// The highest `$version` this build writes. Must match `SETTINGS_VERSION` in
/// `src/lib/core/settings/schema.ts`.
pub const SETTINGS_VERSION: u32 = 1;

/// The largest `settings.json` or `state.json` this build accepts, in bytes.
/// Applies to reading as well: the size is taken from the file's metadata
/// *before* a single byte is read, and the read itself is bounded, so a runaway
/// writer cannot stall startup.
pub const MAX_FILE_BYTES: usize = 1024 * 1024;

/// The member that carries the file format version in both files.
pub const VERSION_KEY: &str = "$version";

/// What a file that could not be used is renamed to before it is replaced.
pub const BAK_SUFFIX: &str = ".bak";

/// Everything the webview needs from disk at startup, in one round trip
/// (plan §7.6). Serialized in camelCase, matching `ConfigLoad` in
/// `src/lib/platform/commands.ts`.
///
/// `settings` and `ui` are always JSON objects: a missing, unreadable or
/// malformed file yields `{}` plus the matching `*_error`, so the webview can
/// fall back to its defaults and show a notice without special-casing failure.
///
/// An error and a non-empty value can appear together, in exactly one case: the
/// file carries a `$version` above [`SETTINGS_VERSION`]. It is then used as it
/// is but never written over, and the error says so. The webview can tell the
/// two apart by looking at `$version` in the value it got.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigLoad {
    /// The contents of `<config>/settings.json`; `{}` when missing or invalid.
    pub settings: Value,
    /// English detail text for a settings file that could not be used (AD-14).
    pub settings_error: Option<String>,
    /// The `ui` member of `<data>/state.json`; `{}` when missing or invalid.
    pub ui: Value,
    /// English detail text for a state file that could not be used.
    pub state_error: Option<String>,
    pub paths: ConfigPaths,
}

/// The result of reading one of the app's own JSON files.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct JsonFile {
    /// The parsed object, or `{}` when the file is missing or unusable.
    pub value: Map<String, Value>,
    /// English detail for the webview; `None` when the file was fine or absent.
    pub error: Option<String>,
    /// The file was written by a newer build and must not be overwritten.
    pub read_only: bool,
    /// The file exists but could not be used, so it is moved aside as `.bak`
    /// before the next write rather than silently discarded.
    pub unusable: bool,
    /// The file exists but could not be *read* at all — a permission that went
    /// away, an I/O error, a sharing violation, something that is not a regular
    /// file. Its contents are unknown, so a write is refused rather than
    /// replacing data nobody has seen (G8 M2).
    pub unreadable: bool,
}

impl JsonFile {
    /// The file was read and cannot be used: invalid JSON, not an object, too
    /// big. The next write rescues it as `.bak` and replaces it.
    fn bad(error: String) -> Self {
        Self {
            error: Some(error),
            unusable: true,
            ..Self::default()
        }
    }

    /// The file could not be read, so nothing is known about what is in it.
    ///
    /// This is deliberately *not* `unusable`: treating a transient EACCES or EIO
    /// like a syntax error meant the next write renamed the user's intact file
    /// to `.bak` and replaced it with a document built from the failed read —
    /// for `state.json` that is the whole recent list and every member this
    /// build does not know (G8 M2). `ui_state_save` runs a second after every
    /// splitter drag, so that window was wide.
    fn unreadable(error: String) -> Self {
        Self {
            error: Some(error),
            unreadable: true,
            ..Self::default()
        }
    }
}

/// Reads one of the app's JSON files under the rules of AD-8. `name` is the
/// bare file name and is what the English error text names, because the folder
/// is already in [`ConfigPaths`].
pub fn read_json_object(path: &Path, name: &str) -> JsonFile {
    // The metadata comes first: `std::fs::read` pre-allocates from the file
    // length and reads to EOF, so judging the size afterwards meant a
    // multi-gigabyte file was fully buffered before it was refused — and
    // `config_load` is awaited by `bootstrap` before the window is usable
    // (G8 M2). A FIFO or a device node at this path would block that read for
    // ever, which no `try`/`catch` in the webview can recover from, so anything
    // that is not a regular file is refused here.
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        // Nothing written yet: the defaults apply and there is nothing to report.
        Err(err) if err.kind() == ErrorKind::NotFound => return JsonFile::default(),
        Err(err) => return JsonFile::unreadable(format!("{name}: {err}")),
    };
    if !metadata.is_file() {
        return JsonFile::unreadable(format!("{name}: not a regular file"));
    }
    if metadata.len() > MAX_FILE_BYTES as u64 {
        return JsonFile::bad(format!(
            "{name}: {} bytes exceed the {MAX_FILE_BYTES} byte limit",
            metadata.len()
        ));
    }
    // Belt and braces: the file may grow between the stat and the read, so the
    // read is bounded too — one byte over the cap is enough to notice.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    let read = std::fs::File::open(path)
        .and_then(|file| file.take(MAX_FILE_BYTES as u64 + 1).read_to_end(&mut bytes));
    if let Err(err) = read {
        return JsonFile::unreadable(format!("{name}: {err}"));
    }
    if bytes.len() > MAX_FILE_BYTES {
        return JsonFile::bad(format!("{name}: more than {MAX_FILE_BYTES} bytes",));
    }
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(err) => return JsonFile::bad(format!("{name}: invalid JSON ({err})")),
    };
    let Value::Object(value) = value else {
        return JsonFile::bad(format!("{name}: expected a JSON object"));
    };
    // A `$version` that is missing or not a number is read as the current one:
    // a hand-edited file without the stamp is still the user's settings.
    let version = value
        .get(VERSION_KEY)
        .and_then(Value::as_u64)
        .unwrap_or(SETTINGS_VERSION as u64);
    if version > SETTINGS_VERSION as u64 {
        return JsonFile {
            value,
            error: Some(format!(
                "{name}: {VERSION_KEY} {version} was written by a newer gEdit; \
                 it is used as it is and never overwritten"
            )),
            read_only: true,
            unusable: false,
            unreadable: false,
        };
    }
    JsonFile {
        value,
        ..JsonFile::default()
    }
}

/// The payload of a write command as an object, or the reason it is refused.
pub fn as_object(value: Value, name: &str) -> Result<Map<String, Value>, String> {
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(format!("{name}: expected a JSON object")),
    }
}

/// Writes `object` to `path`, stamping the current `$version`, under the rules
/// of AD-8: never over a newer file, never above the size cap, always atomic,
/// and always preserving an unusable previous file as `<name>.bak`.
///
/// `current` is what [`read_json_object`] just said about the file on disk. The
/// caller passes it in because it has usually already merged into it.
pub fn save_json_object(
    path: &Path,
    name: &str,
    mut object: Map<String, Value>,
    current: &JsonFile,
) -> Result<(), String> {
    if current.read_only {
        return Err(current
            .error
            .clone()
            .unwrap_or_else(|| format!("{name}: written by a newer gEdit and not overwritten")));
    }
    // Nothing is known about what is in there, so nothing is thrown away: the
    // rescue-and-replace below is for a file we have read and judged, not for
    // one we could not open (G8 M2).
    if current.unreadable {
        return Err(current
            .error
            .clone()
            .unwrap_or_else(|| format!("{name}: could not be read, so it is not replaced")));
    }
    object.insert(
        VERSION_KEY.to_owned(),
        Value::Number(SETTINGS_VERSION.into()),
    );
    // Pretty, with a trailing newline: the user can open this file in the editor
    // ("Open settings file") and `editor.rulers` is documented as edit-the-file.
    let mut bytes = serde_json::to_vec_pretty(&object)
        .map_err(|err| format!("{name}: could not be serialized ({err})"))?;
    bytes.push(b'\n');
    if bytes.len() > MAX_FILE_BYTES {
        return Err(format!(
            "{name}: {} bytes exceed the {MAX_FILE_BYTES} byte limit",
            bytes.len()
        ));
    }
    if current.unusable {
        // Best effort. Losing the rescue copy must not block the write, because
        // then a single broken file would make the app unable to save forever.
        let _ = std::fs::rename(path, bak_path(path));
    }
    write_atomic(path, &bytes).map_err(|err| format!("{name}: {err}"))
}

/// `<path>.bak`, the name an unusable file is moved aside to.
pub fn bak_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(BAK_SUFFIX);
    path.with_file_name(name)
}

/// The body of [`config_load`] against a given pair of folders, so the whole
/// round trip can be tested without an app handle.
pub fn load(dirs: &paths::AppDirs) -> ConfigLoad {
    let settings = read_json_object(&dirs.settings_file(), paths::SETTINGS_FILE_NAME);
    let state = crate::state::read_state(&dirs.state_file());
    ConfigLoad {
        settings: Value::Object(settings.value),
        settings_error: settings.error,
        ui: Value::Object(state.ui),
        state_error: state.file.error,
        paths: dirs.to_config_paths(),
    }
}

/// The body of [`settings_save`]; see [`load`] for why it is split out.
pub fn save_settings(dirs: &paths::AppDirs, settings: Value) -> Result<(), String> {
    let path = dirs.settings_file();
    let object = as_object(settings, paths::SETTINGS_FILE_NAME)?;
    let current = read_json_object(&path, paths::SETTINGS_FILE_NAME);
    save_json_object(&path, paths::SETTINGS_FILE_NAME, object, &current)
}

/// Makes sure `settings.json` exists and answers with its path. The grant is the
/// caller's business, because only it has the app handle.
pub fn ensure_settings_file(dirs: &paths::AppDirs) -> Result<PathBuf, String> {
    let path = dirs.settings_file();
    if !path.exists() {
        // An empty settings file is the whole of "no settings": every key is a
        // default. Writing it here means the editor opens a real file, not a
        // buffer that only exists once the user saves.
        save_json_object(
            &path,
            paths::SETTINGS_FILE_NAME,
            Map::new(),
            &JsonFile::default(),
        )?;
    }
    Ok(path)
}

/// Reads `settings.json` and `state.json` and reports the app's paths.
#[tauri::command]
pub fn config_load(app: AppHandle) -> Result<ConfigLoad, String> {
    Ok(load(&paths::app_dirs(&app)?))
}

/// Replaces `settings.json` with `settings`, which must be a JSON object of at
/// most [`MAX_FILE_BYTES`]. Refuses when the file on disk carries a `$version`
/// above [`SETTINGS_VERSION`], so a newer build's settings are never truncated
/// by an older one.
#[tauri::command]
pub fn settings_save(app: AppHandle, settings: Value) -> Result<(), String> {
    save_settings(&paths::app_dirs(&app)?, settings)
}

/// The user's settings as Rust sees them. AD-8 keeps the script settings
/// (`scripts.python`, `scripts.folders`, `scripts.timeoutSeconds`,
/// `scripts.showBundled`) off the IPC boundary; M4 reads them through here.
#[allow(dead_code)] // M4 (scripts) is the first caller
pub fn read_settings(app: &AppHandle) -> Map<String, Value> {
    match paths::app_dirs(app) {
        Ok(dirs) => read_json_object(&dirs.settings_file(), paths::SETTINGS_FILE_NAME).value,
        Err(_) => Map::new(),
    }
}

/// Makes sure `settings.json` exists, grants that one file to the fs scope and
/// returns its path, so that "Open settings file" can open it as a document
/// (WP2.7). Only this one file is granted — never the folder.
#[tauri::command]
pub fn settings_open_file(app: AppHandle) -> Result<String, String> {
    let path = ensure_settings_file(&paths::app_dirs(&app)?)?;
    crate::state::grant_file(&app, &path);
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(prefix: &str, name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("gedit-{prefix}-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read(dir: &Path, contents: &str) -> JsonFile {
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        fs::write(&path, contents).unwrap();
        read_json_object(&path, paths::SETTINGS_FILE_NAME)
    }

    fn parse(path: &Path) -> Map<String, Value> {
        match serde_json::from_slice(&fs::read(path).unwrap()).unwrap() {
            Value::Object(object) => object,
            other => panic!("not an object: {other}"),
        }
    }

    #[test]
    fn a_missing_file_is_the_defaults_without_an_error() {
        let dir = scratch("config", "missing");
        let file = read_json_object(&dir.join("nope.json"), "nope.json");
        assert_eq!(file, JsonFile::default());
        assert!(file.value.is_empty() && file.error.is_none() && !file.unusable);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_good_object_is_read_as_it_is() {
        let dir = scratch("config", "good");
        let file = read(&dir, r#"{"$version":1,"editor.tabWidth":2}"#);
        assert_eq!(file.error, None);
        assert!(!file.read_only && !file.unusable);
        assert_eq!(file.value.get("editor.tabWidth"), Some(&Value::from(2)));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Invalid JSON, a JSON value that is not an object and a file above the cap
    /// all end the same way: the defaults, an error, and a rescue on the next write.
    #[test]
    fn an_unusable_file_gives_the_defaults_plus_an_error() {
        let dir = scratch("config", "unusable");
        for contents in [
            "{not json".to_owned(),
            "[1,2,3]".to_owned(),
            "\"a string\"".to_owned(),
            format!("{{\"x\":\"{}\"}}", "y".repeat(MAX_FILE_BYTES)),
        ] {
            let file = read(&dir, &contents);
            assert!(file.value.is_empty(), "{contents:.20}");
            assert!(file.unusable, "{contents:.20}");
            assert!(!file.read_only, "{contents:.20}");
            let error = file.error.expect("no error");
            assert!(error.starts_with("settings.json: "), "{error}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_exactly_at_the_cap_is_still_read() {
        let dir = scratch("config", "cap");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        let filler = MAX_FILE_BYTES - r#"{"x":""}"#.len();
        fs::write(&path, format!(r#"{{"x":"{}"}}"#, "y".repeat(filler))).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().len() as usize, MAX_FILE_BYTES);
        let file = read_json_object(&path, paths::SETTINGS_FILE_NAME);
        assert_eq!(file.error, None);
        assert_eq!(file.value.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// G8 M2: the cap used to be checked after `std::fs::read` had already
    /// buffered the whole file, and `config_load` is awaited before the window
    /// is usable.
    #[test]
    fn a_file_over_the_cap_is_refused_on_its_metadata() {
        let dir = scratch("config", "over-cap");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        fs::write(&path, vec![b'y'; MAX_FILE_BYTES + 1]).unwrap();

        let file = read_json_object(&path, paths::SETTINGS_FILE_NAME);

        assert!(file.unusable && !file.unreadable);
        let error = file.error.expect("no error");
        assert!(error.contains("exceed"), "{error}");
        // The size in the message is the metadata's, so it is known before the read.
        assert!(error.contains(&(MAX_FILE_BYTES + 1).to_string()), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A FIFO or a device node at that path would block `read` for ever, and no
    /// `try`/`catch` in the webview can recover from a promise that never
    /// settles. A directory stands in for one: it is the same `is_file()` branch
    /// and it needs no libc.
    #[test]
    fn something_that_is_not_a_regular_file_is_unreadable_and_is_not_replaced() {
        let dir = scratch("config", "not-a-file");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        fs::create_dir(&path).unwrap();

        let file = read_json_object(&path, paths::SETTINGS_FILE_NAME);
        assert!(file.unreadable && !file.unusable);

        let err = save_json_object(&path, paths::SETTINGS_FILE_NAME, Map::new(), &file)
            .expect_err("the save went through");
        assert!(err.contains("not a regular file"), "{err}");
        assert!(path.is_dir());
        assert!(!bak_path(&path).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// G8 M2: an I/O error used to be reported as `unusable`, so the next write
    /// renamed the user's intact file to `.bak` and replaced it with a document
    /// built from the failed read — for `state.json`, the whole recent list.
    #[cfg(unix)]
    #[test]
    fn a_file_that_cannot_be_read_is_never_replaced() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("config", "eacces");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        let before = r#"{"$version":1,"editor.tabWidth":7}"#;
        fs::write(&path, before).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::read(&path).is_ok() {
            // Running as root: the mode is advisory and there is nothing to test.
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o644));
            let _ = fs::remove_dir_all(&dir);
            return;
        }

        let file = read_json_object(&path, paths::SETTINGS_FILE_NAME);
        assert!(file.unreadable && !file.unusable && !file.read_only);
        assert!(file.value.is_empty());

        let mut object = Map::new();
        object.insert("editor.tabWidth".into(), Value::from(2));
        let err = save_json_object(&path, paths::SETTINGS_FILE_NAME, object, &file)
            .expect_err("the save went through");
        assert!(err.contains("settings.json"), "{err}");
        assert!(!bak_path(&path).exists());

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_version_is_read_but_flagged_read_only() {
        let dir = scratch("config", "newer");
        let file = read(&dir, r#"{"$version":2,"editor.tabWidth":8}"#);
        assert!(file.read_only && !file.unusable);
        assert_eq!(file.value.get("editor.tabWidth"), Some(&Value::from(8)));
        assert!(file.error.expect("no error").contains("newer gEdit"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// A missing or nonsensical `$version` is this version, not a newer one.
    #[test]
    fn a_missing_or_unparsable_version_is_treated_as_current() {
        let dir = scratch("config", "version");
        for contents in [r#"{"a":1}"#, r#"{"$version":"2"}"#, r#"{"$version":0}"#] {
            let file = read(&dir, contents);
            assert!(!file.read_only, "{contents}");
            assert_eq!(file.error, None, "{contents}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_version_is_never_written() {
        let dir = scratch("config", "no-write");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        let before = r#"{"$version":2,"editor.tabWidth":8}"#;
        fs::write(&path, before).unwrap();
        let current = read_json_object(&path, paths::SETTINGS_FILE_NAME);

        let mut object = Map::new();
        object.insert("editor.tabWidth".into(), Value::from(2));
        let err = save_json_object(&path, paths::SETTINGS_FILE_NAME, object, &current)
            .expect_err("the save went through");

        assert!(err.contains("newer gEdit"), "{err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        assert!(!bak_path(&path).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_save_stamps_the_version_and_ends_with_a_newline() {
        let dir = scratch("config", "stamp");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        let mut object = Map::new();
        object.insert("editor.tabWidth".into(), Value::from(2));
        save_json_object(
            &path,
            paths::SETTINGS_FILE_NAME,
            object,
            &JsonFile::default(),
        )
        .unwrap();

        let written = fs::read_to_string(&path).unwrap();
        assert!(written.ends_with('\n'), "{written:?}");
        // Pretty printed, because the user may open and edit this file.
        assert!(written.contains('\n'), "{written:?}");
        let object = parse(&path);
        assert_eq!(
            object.get(VERSION_KEY),
            Some(&Value::from(SETTINGS_VERSION))
        );
        assert_eq!(object.get("editor.tabWidth"), Some(&Value::from(2)));
        // Only what was asked for, plus the stamp (§7.7: non-default values only).
        assert_eq!(object.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bad_file_is_kept_as_bak_on_the_next_save() {
        let dir = scratch("config", "bak");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        fs::write(&path, "{not json").unwrap();
        let current = read_json_object(&path, paths::SETTINGS_FILE_NAME);
        assert!(current.unusable);

        save_json_object(&path, paths::SETTINGS_FILE_NAME, Map::new(), &current).unwrap();

        assert_eq!(fs::read_to_string(bak_path(&path)).unwrap(), "{not json");
        assert_eq!(parse(&path).get(VERSION_KEY), Some(&Value::from(1)));
        let _ = fs::remove_dir_all(&dir);
    }

    /// A good file is replaced in place; no `.bak` is left lying around.
    #[test]
    fn a_good_file_is_not_copied_to_bak() {
        let dir = scratch("config", "no-bak");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        fs::write(&path, r#"{"$version":1}"#).unwrap();
        let current = read_json_object(&path, paths::SETTINGS_FILE_NAME);
        save_json_object(&path, paths::SETTINGS_FILE_NAME, Map::new(), &current).unwrap();
        assert!(!bak_path(&path).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_non_object_payload_is_refused() {
        for value in [
            Value::Null,
            Value::from(1),
            Value::from("x"),
            Value::Array(vec![]),
        ] {
            let err = as_object(value.clone(), "settings.json").expect_err("accepted {value}");
            assert_eq!(err, "settings.json: expected a JSON object");
        }
        assert!(as_object(Value::Object(Map::new()), "settings.json").is_ok());
    }

    #[test]
    fn a_payload_above_the_cap_is_refused_and_nothing_is_written() {
        let dir = scratch("config", "too-big");
        let path = dir.join(paths::SETTINGS_FILE_NAME);
        let mut object = Map::new();
        object.insert("x".into(), Value::from("y".repeat(MAX_FILE_BYTES)));
        let err = save_json_object(
            &path,
            paths::SETTINGS_FILE_NAME,
            object,
            &JsonFile::default(),
        )
        .expect_err("the save went through");
        assert!(err.contains("exceed"), "{err}");
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bak_is_the_file_name_plus_bak() {
        assert_eq!(
            bak_path(Path::new("/c/settings.json")),
            PathBuf::from("/c/settings.json.bak")
        );
        assert_eq!(
            bak_path(Path::new("/d/state.json")),
            PathBuf::from("/d/state.json.bak")
        );
    }

    // --- the command bodies, end to end over a scratch home ------------------

    fn scratch_dirs(name: &str) -> (PathBuf, paths::AppDirs) {
        let root = scratch("home", name);
        let dirs = paths::AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        dirs.ensure();
        (root, dirs)
    }

    /// A first start: no files yet, so the defaults apply and nothing is wrong.
    #[test]
    fn a_first_start_loads_empty_objects_and_no_errors() {
        let (root, dirs) = scratch_dirs("first");
        let loaded = load(&dirs);
        assert_eq!(loaded.settings, serde_json::json!({}));
        assert_eq!(loaded.ui, serde_json::json!({}));
        assert_eq!(loaded.settings_error, None);
        assert_eq!(loaded.state_error, None);
        assert_eq!(loaded.paths, dirs.to_config_paths());
        // Reading must not create either file.
        assert!(!dirs.settings_file().exists() && !dirs.state_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn saved_settings_come_back_from_the_next_load() {
        let (root, dirs) = scratch_dirs("round-trip");
        save_settings(&dirs, serde_json::json!({"editor.tabWidth": 2})).unwrap();
        let loaded = load(&dirs);
        assert_eq!(
            loaded.settings,
            serde_json::json!({"$version": 1, "editor.tabWidth": 2})
        );
        assert_eq!(loaded.settings_error, None);

        // A save replaces: a key that is back at its default is simply gone.
        save_settings(&dirs, serde_json::json!({"editor.minimap": true})).unwrap();
        assert_eq!(
            load(&dirs).settings,
            serde_json::json!({"$version": 1, "editor.minimap": true})
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// AD-8 end to end: a broken file gives the defaults plus a notice at
    /// startup, and the next save moves it aside instead of losing it.
    #[test]
    fn a_broken_settings_file_survives_as_bak_after_the_next_save() {
        let (root, dirs) = scratch_dirs("broken");
        fs::write(dirs.settings_file(), "{not json").unwrap();

        let loaded = load(&dirs);
        assert_eq!(loaded.settings, serde_json::json!({}));
        assert!(loaded.settings_error.is_some());

        save_settings(&dirs, serde_json::json!({"editor.tabWidth": 2})).unwrap();
        assert_eq!(
            fs::read_to_string(bak_path(&dirs.settings_file())).unwrap(),
            "{not json"
        );
        assert_eq!(load(&dirs).settings_error, None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn open_file_creates_the_settings_file_once() {
        let (root, dirs) = scratch_dirs("open");
        let path = ensure_settings_file(&dirs).unwrap();
        assert_eq!(path, dirs.settings_file());
        assert_eq!(parse(&path).get(VERSION_KEY), Some(&Value::from(1)));

        // A second call leaves the user's settings alone.
        save_settings(&dirs, serde_json::json!({"editor.tabWidth": 7})).unwrap();
        ensure_settings_file(&dirs).unwrap();
        assert_eq!(parse(&path).get("editor.tabWidth"), Some(&Value::from(7)));
        let _ = fs::remove_dir_all(&root);
    }
}

//! `<config>/machines.json`: the user's machine configurations (plan §7.10, §7.15,
//! AD-31, D50). Stub written by the M6 prelude (P6); **WP6.8** owns it and adds the
//! tests.
//!
//! Rust owns this file exactly as it owns `settings.json` (F47): it is read in the
//! one `config_load` round trip and written whole by [`machines_save`], through the
//! shared rules in [`crate::config`] — a JSON object of at most 1 MiB, written
//! atomically, an unusable previous file rescued as `machines.json.bak`, and a file
//! that carries a newer `$version` read but never overwritten.
//!
//! Why its own file and its own version, and not a settings key: settings are flat
//! keys that store only what differs from the default, and a list is taken whole or
//! not at all. Machine configurations are user-owned **records** with stable ids
//! (per-file memory points at them from M7), their own schema version and, from
//! M12, import and export. Keeping them apart also leaves `mergeSettings` alone.
//!
//! Why the whole object on every write: a machine carries the parameters that decide
//! how every number in every program of that machine is read. A partial write is the
//! one way a rename could lose them.
//!
//! The path never crosses the IPC boundary. [`machines_open_file`] is the single
//! exception and it is the feature working as intended: it grants that **one** file
//! to the fs scope so the editor can open it as a document, the same deal
//! `settings_open_file` makes (see the note in [`crate::paths`]).

use serde_json::Value;
use tauri::AppHandle;

use crate::config::{as_object, read_json_object_versioned, save_json_object_versioned, JsonFile};
use crate::paths::{self, AppDirs};

/// The highest `$version` this build writes. Must match `MACHINES_VERSION` in
/// `src/lib/core/machines/types.ts`.
pub const MACHINES_VERSION: u32 = 1;

/// Reads the file the way `config_load` does, so a caller can check what is on disk
/// before replacing it.
fn read(dirs: &AppDirs) -> JsonFile {
    read_json_object_versioned(
        &dirs.machines_file(),
        paths::MACHINES_FILE_NAME,
        MACHINES_VERSION,
    )
}

/// The body of [`machines_save`], against a given pair of folders, so the whole
/// round trip can be tested without an app handle.
pub fn save(dirs: &AppDirs, machines: Value) -> Result<(), String> {
    let path = dirs.machines_file();
    let object = as_object(machines, paths::MACHINES_FILE_NAME)?;
    let current = read(dirs);
    save_json_object_versioned(
        &path,
        paths::MACHINES_FILE_NAME,
        object,
        &current,
        MACHINES_VERSION,
    )
}

/// Makes sure `machines.json` exists and answers with its path. The grant is the
/// caller's business, because only it has the app handle.
///
/// An empty file is the whole of "no machines yet": the editor then opens a real
/// file with the members a hand edit needs, not a buffer that exists only once the
/// user saves.
pub fn ensure_file(dirs: &AppDirs) -> Result<std::path::PathBuf, String> {
    let path = dirs.machines_file();
    if !path.exists() {
        let mut empty = serde_json::Map::new();
        empty.insert("machines".to_owned(), Value::Array(Vec::new()));
        empty.insert("defaults".to_owned(), Value::Object(serde_json::Map::new()));
        save_json_object_versioned(
            &path,
            paths::MACHINES_FILE_NAME,
            empty,
            &JsonFile::default(),
            MACHINES_VERSION,
        )?;
    }
    Ok(path)
}

/// Replaces `machines.json` with `machines`, which must be a JSON object (§7.10).
#[tauri::command]
pub fn machines_save(app: AppHandle, machines: Value) -> Result<(), String> {
    save(&paths::app_dirs(&app)?, machines)
}

/// Makes sure `machines.json` exists, grants that one file to the fs scope and
/// returns its path, so "Open machines file" can open it as a document. Only this
/// one file is granted — never the folder.
#[tauri::command]
pub fn machines_open_file(app: AppHandle) -> Result<String, String> {
    let path = ensure_file(&paths::app_dirs(&app)?)?;
    crate::state::grant_file(&app, &path);
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{bak_path, MAX_FILE_BYTES};
    use crate::source_scan;
    use std::fs;
    use std::path::PathBuf;

    /// A scratch pair of folders, both under one removable root.
    fn scratch(name: &str) -> (PathBuf, AppDirs) {
        let root =
            std::env::temp_dir().join(format!("gedit-machines-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        dirs.ensure();
        (root, dirs)
    }

    fn on_disk(dirs: &AppDirs) -> Value {
        serde_json::from_slice(&fs::read(dirs.machines_file()).unwrap()).unwrap()
    }

    fn one_machine() -> Value {
        serde_json::json!({
            "machines": [{
                "id": "lathe-2",
                "name": "Lathe 2",
                "profile": "fanuc-lathe",
                "params": { "variants": { "gcodeSystem": "B" } }
            }],
            "defaults": { "fanuc-lathe": "lathe-2" }
        })
    }

    /// The webview and Rust have to agree on the file format version, or a build
    /// would read a file it is not allowed to write (AD-31 Storage).
    #[test]
    fn the_version_matches_the_typescript_constant() {
        let ts = source_scan::lf(include_str!("../../src/lib/core/machines/types.ts"));
        assert!(
            ts.contains(&format!(
                "export const MACHINES_VERSION = {MACHINES_VERSION}"
            )),
            "core/machines/types.ts must declare MACHINES_VERSION = {MACHINES_VERSION}"
        );
    }

    /// What was written comes back through the one round trip the webview makes.
    #[test]
    fn a_saved_file_comes_back_from_config_load() {
        let (root, dirs) = scratch("round-trip");
        save(&dirs, one_machine()).unwrap();

        let loaded = crate::config::load(&dirs);
        assert_eq!(loaded.machines_error, None);
        assert_eq!(loaded.machines["$version"], Value::from(MACHINES_VERSION));
        assert_eq!(loaded.machines["machines"][0]["id"], Value::from("lathe-2"));
        assert_eq!(
            loaded.machines["defaults"]["fanuc-lathe"],
            Value::from("lathe-2")
        );
        // Reading does not create the file; only a save and `ensure_file` do.
        assert_eq!(
            crate::config::load(&AppDirs {
                config: root.join("nothing"),
                data: root.join("nothing"),
            })
            .machines,
            serde_json::json!({})
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// The write is atomic and leaves no temporary file behind: the whole file is
    /// replaced or none of it is, because half a machine reads numbers wrongly.
    #[test]
    fn a_save_replaces_the_whole_file_and_leaves_nothing_behind() {
        let (root, dirs) = scratch("atomic");
        save(&dirs, one_machine()).unwrap();
        save(&dirs, serde_json::json!({ "machines": [], "defaults": {} })).unwrap();

        assert_eq!(
            on_disk(&dirs),
            serde_json::json!({ "$version": 1, "machines": [], "defaults": {} })
        );
        let strays: Vec<_> = fs::read_dir(&dirs.config)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .filter(|name| name != paths::MACHINES_FILE_NAME)
            .filter(|name| name != "scripts")
            .collect();
        assert!(strays.is_empty(), "left behind: {strays:?}");
        let _ = fs::remove_dir_all(&root);
    }

    /// Only an object: a list or a string would make `config_load` answer with
    /// something the webview's parser cannot use.
    #[test]
    fn a_payload_that_is_not_an_object_is_refused() {
        let (root, dirs) = scratch("not-an-object");
        let err = save(&dirs, serde_json::json!([1, 2, 3])).expect_err("the save went through");
        assert!(err.contains("expected a JSON object"), "{err}");
        assert!(!dirs.machines_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// The shared size cap (AD-8): `config_load` is awaited before the window is
    /// usable, so nothing above the cap may reach the file.
    #[test]
    fn a_file_over_the_size_cap_is_refused_and_the_old_one_stays() {
        let (root, dirs) = scratch("cap");
        save(&dirs, one_machine()).unwrap();

        let huge = serde_json::json!({ "notes": "y".repeat(MAX_FILE_BYTES) });
        let err = save(&dirs, huge).expect_err("the save went through");
        assert!(err.contains("exceed"), "{err}");
        assert_eq!(on_disk(&dirs)["machines"][0]["id"], Value::from("lathe-2"));
        let _ = fs::remove_dir_all(&root);
    }

    /// A hand edit that broke the JSON is not deleted: it is moved aside, which is
    /// what "Replace with an empty file" offers on the Machines page (AD-31).
    #[test]
    fn an_unusable_file_is_rescued_as_bak_before_it_is_replaced() {
        let (root, dirs) = scratch("bak");
        let path = dirs.machines_file();
        fs::write(&path, "{\"machines\": [ broken").unwrap();
        assert!(crate::config::load(&dirs).machines_error.is_some());

        save(&dirs, serde_json::json!({ "machines": [], "defaults": {} })).unwrap();

        let rescued = fs::read_to_string(bak_path(&path)).unwrap();
        assert!(rescued.contains("broken"), "{rescued}");
        assert_eq!(on_disk(&dirs)["machines"], serde_json::json!([]));
        let _ = fs::remove_dir_all(&root);
    }

    /// A file from a newer gEdit is read and never written: its machines may carry
    /// parameters this build does not understand, and stamping it down to this
    /// version would silently drop them.
    #[test]
    fn a_newer_version_is_read_and_never_overwritten() {
        let (root, dirs) = scratch("newer");
        let path = dirs.machines_file();
        let newer = format!(
            "{{\"$version\": {}, \"machines\": [], \"spindle\": 1}}",
            MACHINES_VERSION + 1
        );
        fs::write(&path, &newer).unwrap();

        let loaded = crate::config::load(&dirs);
        assert_eq!(loaded.machines["spindle"], Value::from(1));
        let error = loaded.machines_error.expect("no error");
        assert!(error.contains("newer gEdit"), "{error}");

        let err = save(&dirs, one_machine()).expect_err("the save went through");
        assert!(err.contains("newer gEdit"), "{err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), newer);
        assert!(!bak_path(&path).exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// A file whose contents are unknown is never replaced (G8 M2): a directory
    /// stands in for the FIFO or the sharing violation that cannot be created here.
    #[test]
    fn a_file_that_cannot_be_read_is_not_replaced() {
        let (root, dirs) = scratch("unreadable");
        let path = dirs.machines_file();
        fs::create_dir(&path).unwrap();

        let err = save(&dirs, one_machine()).expect_err("the save went through");
        assert!(err.contains("not a regular file"), "{err}");
        assert!(path.is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    /// "Open machines file" opens a **file**, not an empty buffer: a hand edit needs
    /// the members to be there, and the grant is for a path that exists.
    #[test]
    fn ensure_file_creates_an_empty_usable_file_and_keeps_an_existing_one() {
        let (root, dirs) = scratch("ensure");
        let path = ensure_file(&dirs).unwrap();
        assert_eq!(path, dirs.machines_file());
        assert_eq!(
            on_disk(&dirs),
            serde_json::json!({ "$version": 1, "machines": [], "defaults": {} })
        );

        save(&dirs, one_machine()).unwrap();
        ensure_file(&dirs).unwrap();
        assert_eq!(on_disk(&dirs)["machines"][0]["id"], Value::from("lathe-2"));
        let _ = fs::remove_dir_all(&root);
    }

    /// Standing rule (G8): no path crosses the IPC boundary into this module. The
    /// commands take the app handle and the payload, nothing else — the file name
    /// is `paths::MACHINES_FILE_NAME` and the folder is the app's own.
    #[test]
    fn no_command_here_takes_a_path_from_the_webview() {
        let source = source_scan::lf(include_str!("machines.rs"));
        for command in [
            "pub fn machines_save(app: AppHandle, machines: Value)",
            "pub fn machines_open_file(app: AppHandle)",
        ] {
            assert!(source.contains(command), "missing or changed: {command}");
        }
        // One grant, for one file, and nothing else in this module grants anything.
        // The needle is built at compile time so this line is not one of its own hits.
        assert_eq!(source.matches(concat!("grant", "_file")).count(), 1);
    }
}

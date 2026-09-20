//! The `scripts.*` settings, read in Rust (plan AD-8, AD-13, §7.7).
//!
//! The webview never sends an interpreter, a script folder or a timeout over IPC as
//! **arguments of a run**. Every one of those values is read here, out of
//! `<config>/settings.json`, by the same code that reads it for the settings dialog — so
//! what the user sees in the dialog is exactly what the runner uses, and a `script_run`
//! call cannot name an interpreter of its own, point the search at another folder or
//! lift its own deadline.
//!
//! **What that does not buy, so that nobody relies on it.** This is not a barrier against
//! a compromised webview. `settings.python` and `scripts.folders` are ordinary settings
//! keys: the settings dialog offers both (`core/settings/schema.ts`), and it writes them
//! through `settings_save`, which takes an arbitrary object. Anything that can call
//! `invoke` can therefore set them and have the next run pick them up. `script_new` is a
//! second path to the same place — it creates a file in the user folder and grants it to
//! the fs scope by design, so the webview can write Python into it and then run it by id.
//!
//! That is not a hole to be plugged here; it is what AD-13 says out loud: a script is a
//! normal program with the user's rights, and gEdit cannot sandbox it. Reading these
//! keys in Rust buys a **single source of truth** for them — one place that clamps the
//! timeout, one place that ignores an interpreter that no longer exists, and no way for
//! a run to differ from what the dialog shows. Treat it as that, not as a boundary
//! (G8 M4 corrected the claim that used to stand here).
//!
//! The file is flat (`{"scripts.timeoutSeconds": 120}`, plan §7.7), so the keys below
//! are the whole schema this module knows. Anything malformed falls back to the default
//! rather than failing the command: a hand-edited settings file must not make the
//! Scripts menu disappear.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::config;
use crate::paths::{self, SETTINGS_FILE_NAME};

/// `scripts.timeoutSeconds` when the settings file says nothing (plan §7.7).
pub const DEFAULT_TIMEOUT_SECONDS: u64 = 60;
/// A timeout below this would kill every script before it started.
pub const MIN_TIMEOUT_SECONDS: u64 = 1;
/// A day. The cap exists so that a deadline can always be expressed as an
/// `Instant + Duration` without overflowing, whatever a hand-edited file says.
pub const MAX_TIMEOUT_SECONDS: u64 = 86_400;

/// The settings keys this module reads.
pub const KEY_PYTHON: &str = "scripts.python";
pub const KEY_FOLDERS: &str = "scripts.folders";
pub const KEY_TIMEOUT: &str = "scripts.timeoutSeconds";
pub const KEY_SHOW_BUNDLED: &str = "scripts.showBundled";

/// What the scripting backend needs out of `settings.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptSettings {
    /// `scripts.python`, but only when it names a file that exists. An interpreter
    /// that has been uninstalled since falls back to the resolver instead of failing
    /// every run with "no such file".
    pub python: Option<PathBuf>,
    /// `scripts.folders`, in the order the user listed them: the index is what makes
    /// `extra<N>` in a script id, so an entry is kept even when the folder is gone.
    pub folders: Vec<PathBuf>,
    /// `scripts.timeoutSeconds`, clamped to [`MIN_TIMEOUT_SECONDS`]..=[`MAX_TIMEOUT_SECONDS`].
    pub timeout_seconds: u64,
    /// `scripts.showBundled`. False hides the bundled scripts from the list; the
    /// folder itself is still reported, so the settings dialog can explain why.
    pub show_bundled: bool,
}

impl Default for ScriptSettings {
    fn default() -> Self {
        Self {
            python: None,
            folders: Vec::new(),
            timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
            show_bundled: true,
        }
    }
}

impl ScriptSettings {
    /// Reads `<config>/settings.json`. A missing or unusable file gives the defaults:
    /// `config_load` already reported the problem to the webview at startup, and the
    /// scripting backend is not the place to report it a second time.
    pub fn load(app: &AppHandle) -> Self {
        let Ok(dirs) = paths::app_dirs(app) else {
            return Self::default();
        };
        let file = config::read_json_object(&dirs.settings_file(), SETTINGS_FILE_NAME);
        Self::from_object(&file.value, |path| path.is_file())
    }

    /// The rules above with the file-system probe injected, so they can be tested
    /// without writing an interpreter to disk.
    pub fn from_object(settings: &Map<String, Value>, is_file: impl Fn(&Path) -> bool) -> Self {
        Self {
            python: settings
                .get(KEY_PYTHON)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|python| !python.is_empty())
                .map(PathBuf::from)
                .filter(|python| is_file(python)),
            folders: settings
                .get(KEY_FOLDERS)
                .and_then(Value::as_array)
                .map(|folders| {
                    folders
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|folder| !folder.is_empty())
                        .map(PathBuf::from)
                        .collect()
                })
                .unwrap_or_default(),
            timeout_seconds: settings
                .get(KEY_TIMEOUT)
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
                .clamp(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS),
            show_bundled: settings
                .get(KEY_SHOW_BUNDLED)
                .and_then(Value::as_bool)
                .unwrap_or(true),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(json: &str) -> Map<String, Value> {
        match serde_json::from_str(json).unwrap() {
            Value::Object(object) => object,
            other => panic!("not an object: {other}"),
        }
    }

    fn read(json: &str) -> ScriptSettings {
        ScriptSettings::from_object(&object(json), |path| path == Path::new("/usr/bin/python3"))
    }

    #[test]
    fn an_empty_file_gives_the_defaults() {
        let settings = read("{}");
        assert_eq!(settings, ScriptSettings::default());
        assert_eq!(settings.timeout_seconds, 60);
        assert!(settings.show_bundled);
        assert_eq!(settings.python, None);
    }

    #[test]
    fn reads_every_key() {
        let settings = read(
            r#"{ "scripts.python": "/usr/bin/python3",
                 "scripts.folders": ["/a", "/b"],
                 "scripts.timeoutSeconds": 120,
                 "scripts.showBundled": false }"#,
        );
        assert_eq!(settings.python, Some(PathBuf::from("/usr/bin/python3")));
        assert_eq!(settings.folders, [PathBuf::from("/a"), PathBuf::from("/b")]);
        assert_eq!(settings.timeout_seconds, 120);
        assert!(!settings.show_bundled);
    }

    /// An interpreter that was uninstalled must fall back to the resolver, not make
    /// every run fail (plan AD-13).
    #[test]
    fn an_interpreter_that_is_not_a_file_is_ignored() {
        for json in [
            r#"{ "scripts.python": "/gone/python3" }"#,
            r#"{ "scripts.python": "   " }"#,
            r#"{ "scripts.python": "" }"#,
            r#"{ "scripts.python": 7 }"#,
        ] {
            assert_eq!(read(json).python, None, "accepted {json}");
        }
    }

    /// The index in this list is `extra<N>` in a script id, so a blank entry is
    /// dropped but a folder that does not exist keeps its place.
    #[test]
    fn keeps_folder_order_and_drops_blanks() {
        let settings = read(r#"{ "scripts.folders": ["/a", "", "  ", "/gone", 7, "/b"] }"#);
        assert_eq!(
            settings.folders,
            [
                PathBuf::from("/a"),
                PathBuf::from("/gone"),
                PathBuf::from("/b")
            ]
        );
    }

    #[test]
    fn clamps_the_timeout_and_ignores_nonsense() {
        assert_eq!(
            read(r#"{ "scripts.timeoutSeconds": 0 }"#).timeout_seconds,
            1
        );
        assert_eq!(
            read(r#"{ "scripts.timeoutSeconds": 999999999 }"#).timeout_seconds,
            MAX_TIMEOUT_SECONDS
        );
        for json in [
            r#"{ "scripts.timeoutSeconds": -5 }"#,
            r#"{ "scripts.timeoutSeconds": "60" }"#,
            r#"{ "scripts.timeoutSeconds": null }"#,
        ] {
            assert_eq!(
                read(json).timeout_seconds,
                DEFAULT_TIMEOUT_SECONDS,
                "{json}"
            );
        }
    }

    #[test]
    fn show_bundled_defaults_to_true_unless_it_is_really_false() {
        assert!(read(r#"{ "scripts.showBundled": "false" }"#).show_bundled);
        assert!(read("{}").show_bundled);
        assert!(!read(r#"{ "scripts.showBundled": false }"#).show_bundled);
    }
}

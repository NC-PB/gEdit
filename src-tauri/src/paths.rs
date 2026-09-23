//! The one place that names gEdit's own files and folders (plan AD-8, §7.6).
//!
//! The webview never gets fs-scope access to the config or the data folder: it
//! learns these paths through [`ConfigPaths`] only so that it can show them
//! (the settings dialog shows the user scripts folder, About shows nothing) and
//! so that `settings_open_file` can hand back one granted file. Every read and
//! write of `settings.json` and `state.json` goes through a Rust command with a
//! fixed file name, so a path never crosses the IPC boundary in the other
//! direction.
//!
//! One exception, and it is the feature working as intended (G8 M2): once the
//! user clicks "Open settings file", [`crate::config::settings_open_file`]
//! grants `settings.json` to the fs scope for the rest of the session, and there
//! is no revoke. From then on the webview writes that one file through the fs
//! plugin whenever the document is saved — an in-place `writeFile`, so it has
//! none of [`crate::atomic::write_atomic`]'s crash safety and none of the
//! object / 1 MiB / `$version` checks of [`crate::config::save_json_object`].
//! The webview is our own code, so this is not a trust boundary; it does mean
//! M3+ must not assume that every write of that file went through Rust. Routing
//! a document save of that one path back through `settings_save` is the fix if
//! it is ever worth closing.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// `<config>/settings.json` (plan §7.7).
pub const SETTINGS_FILE_NAME: &str = "settings.json";
/// `<data>/state.json` (plan §7.7).
pub const STATE_FILE_NAME: &str = "state.json";
/// `<config>/scripts`, the folder the user's own scripts live in (M5).
pub const USER_SCRIPTS_DIR_NAME: &str = "scripts";
/// `<config>/machines.json` (plan §7.15, AD-31, D50). Kept out of `settings.json`
/// on purpose: settings are flat keys that store only what differs from the
/// default, while machines are user-owned records with ids, their own schema
/// version and import/export.
pub const MACHINES_FILE_NAME: &str = "machines.json";
/// `<data>/backups`, the root of the history backups (M7, AD-21). One folder per
/// source directory (`<fnv32 of the folder>`), one below that per file name.
pub const BACKUPS_DIR_NAME: &str = "backups";
/// `<data>/recovery`, the root of the crash-recovery snapshots (M7, AD-21). One
/// folder per session, holding the `alive` heartbeat and the `<key>.{txt,json}`
/// pairs.
pub const RECOVERY_DIR_NAME: &str = "recovery";

/// Whether this platform's file names are case-insensitive, and therefore
/// whether two spellings of one path are the same file.
///
/// Two places need the same answer: the recent list deduplicates with it
/// ([`crate::state`], AD-9) and the backup history derives one folder per source
/// directory from it ([`crate::backup`], AD-21) — on macOS `/NC/` and `/nc/` are
/// one folder and must not end up with two histories. Linux compares byte for
/// byte. One constant, so the two can never disagree.
pub const FOLD_CASE: bool = cfg!(any(target_os = "macos", target_os = "windows"));

/// The mode the two M7 folders get on Unix: owner only.
///
/// They hold the **contents** of programs the user has not saved yet — a recovery
/// snapshot is the whole buffer, and a backup is the previous version of a file
/// the user may have put somewhere deliberately private. `<data>` itself inherits
/// whatever the home directory allows, which on a shared machine can be
/// world-readable, so these two are narrowed explicitly rather than trusted to
/// their parent (AD-21).
#[cfg(unix)]
pub const OWNER_ONLY: u32 = 0o700;

/// The absolute paths the webview is told about, once, as part of `config_load`
/// (plan §7.6). Serialized in camelCase, matching `ConfigPaths` in
/// `src/lib/platform/commands.ts`.
///
/// On macOS `config_dir` and `data_dir` both resolve to
/// `~/Library/Application Support/com.pburg.gedit` (F13), which is also where
/// `tauri-plugin-window-state` writes `.window-state.json`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPaths {
    /// `app_config_dir()`.
    pub config_dir: String,
    /// `app_data_dir()`.
    pub data_dir: String,
    /// `<config>/settings.json`.
    pub settings_file: String,
    /// `<data>/state.json`.
    pub state_file: String,
    /// `<config>/scripts`, the folder `script_new` and `script_copy_to_user` write to (M5).
    pub user_scripts_dir: String,
    /// `<config>/machines.json` (M6). The webview needs it to tell the machines
    /// document from any other one it has open, exactly as it does with
    /// `settings_file`; knowing the path grants nothing.
    pub machines_file: String,
}

/// The two folders everything gEdit owns hangs off. Resolved once per command,
/// because `$HOME` can change between calls under the runtime harness (F13) and
/// a cached value would then point at the previous run's home.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppDirs {
    /// `app_config_dir()`: settings and user scripts.
    pub config: PathBuf,
    /// `app_data_dir()`: the state file.
    pub data: PathBuf,
}

impl AppDirs {
    pub fn settings_file(&self) -> PathBuf {
        self.config.join(SETTINGS_FILE_NAME)
    }

    pub fn state_file(&self) -> PathBuf {
        self.data.join(STATE_FILE_NAME)
    }

    pub fn user_scripts_dir(&self) -> PathBuf {
        self.config.join(USER_SCRIPTS_DIR_NAME)
    }

    pub fn machines_file(&self) -> PathBuf {
        self.config.join(MACHINES_FILE_NAME)
    }

    /// `<data>/backups` (M7). Not in [`ConfigPaths`]: the webview never names a
    /// backup, it only asks `files_backup` to make one.
    pub fn backups_dir(&self) -> PathBuf {
        self.data.join(BACKUPS_DIR_NAME)
    }

    /// `<data>/recovery` (M7). Not in [`ConfigPaths`] either — the webview
    /// addresses a snapshot by session and key, never by path.
    pub fn recovery_dir(&self) -> PathBuf {
        self.data.join(RECOVERY_DIR_NAME)
    }

    /// The webview's view of these folders. Lossy conversion is deliberate: a
    /// home directory whose name is not valid UTF-8 still gives a usable, if
    /// imperfect, string to show, and nothing is ever read back from it.
    pub fn to_config_paths(&self) -> ConfigPaths {
        ConfigPaths {
            config_dir: text(&self.config),
            data_dir: text(&self.data),
            settings_file: text(&self.settings_file()),
            state_file: text(&self.state_file()),
            user_scripts_dir: text(&self.user_scripts_dir()),
            machines_file: text(&self.machines_file()),
        }
    }

    /// Creates the folders gEdit writes to if they are missing, reporting what
    /// failed. Used by [`ensure_dirs`]; separate so that it can be tested
    /// without an app handle.
    ///
    /// `backups` and `recovery` are narrowed to [`OWNER_ONLY`] on Unix, on the
    /// folder this call created **and** on one that was already there, because a
    /// folder from an older build (or a careless umask) would otherwise keep a
    /// mode that lets the rest of the machine read unsaved work.
    pub fn ensure(&self) -> Vec<String> {
        let mut failures: Vec<String> = [
            self.config.clone(),
            self.data.clone(),
            self.user_scripts_dir(),
        ]
        .into_iter()
        .filter_map(|dir| match std::fs::create_dir_all(&dir) {
            Ok(()) => None,
            Err(err) => Some(format!("{}: {err}", dir.display())),
        })
        .collect();
        for dir in [self.backups_dir(), self.recovery_dir()] {
            match std::fs::create_dir_all(&dir).and_then(|()| restrict(&dir)) {
                Ok(()) => {}
                Err(err) => failures.push(format!("{}: {err}", dir.display())),
            }
        }
        failures
    }
}

/// Narrows one folder to the owner on Unix; a no-op everywhere else (Windows
/// inherits the profile's ACL, which is already per-user).
#[cfg(unix)]
pub fn restrict(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(OWNER_ONLY))
}

#[cfg(not(unix))]
pub fn restrict(_dir: &Path) -> std::io::Result<()> {
    Ok(())
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Where this run keeps its files. The only failure is a platform that reports
/// no config or data directory at all, which on the desktop means `$HOME` is
/// unset.
pub fn app_dirs(app: &AppHandle) -> Result<AppDirs, String> {
    let resolver = app.path();
    Ok(AppDirs {
        config: resolver
            .app_config_dir()
            .map_err(|err| format!("no config directory: {err}"))?,
        data: resolver
            .app_data_dir()
            .map_err(|err| format!("no data directory: {err}"))?,
    })
}

/// Creates the config folder, the data folder, `<config>/scripts` and the two M7
/// folders `<data>/backups` and `<data>/recovery` if they are missing. Called
/// from `setup_app` before the window appears, so that every later write finds
/// its folder. Failures are logged, never fatal: a read-only home directory must
/// still give a usable editor.
pub fn ensure_dirs(app: &AppHandle) {
    match app_dirs(app) {
        Ok(dirs) => {
            for failure in dirs.ensure() {
                eprintln!("gEdit: could not create {failure}");
            }
        }
        Err(err) => eprintln!("gEdit: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch pair of folders, both under one removable root.
    fn scratch(name: &str) -> (PathBuf, AppDirs) {
        let root = std::env::temp_dir().join(format!("gedit-paths-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        (root, dirs)
    }

    #[test]
    fn names_the_app_files_under_the_two_folders() {
        let dirs = AppDirs {
            config: PathBuf::from("/c"),
            data: PathBuf::from("/d"),
        };
        let paths = dirs.to_config_paths();
        // Built with join, like the code under test: Windows joins with a backslash.
        let under = |dir: &str, name: &str| PathBuf::from(dir).join(name).display().to_string();
        assert_eq!(paths.config_dir, "/c");
        assert_eq!(paths.data_dir, "/d");
        assert_eq!(paths.settings_file, under("/c", "settings.json"));
        assert_eq!(paths.state_file, under("/d", "state.json"));
        assert_eq!(paths.user_scripts_dir, under("/c", "scripts"));
        // M6: the machines file sits beside the settings, in the config folder.
        assert_eq!(paths.machines_file, under("/c", "machines.json"));
        // M7: the two data folders are ours alone; the webview never gets their
        // paths, so they are not part of `ConfigPaths`.
        assert_eq!(dirs.backups_dir(), PathBuf::from("/d").join("backups"));
        assert_eq!(dirs.recovery_dir(), PathBuf::from("/d").join("recovery"));
    }

    #[test]
    fn ensure_creates_config_data_and_the_user_scripts_folder() {
        let (root, dirs) = scratch("create");
        assert_eq!(dirs.ensure(), Vec::<String>::new());
        assert!(dirs.config.is_dir());
        assert!(dirs.data.is_dir());
        assert!(dirs.user_scripts_dir().is_dir());
        // M7: the backup and recovery roots exist before the window does, so the
        // first save and the first snapshot never have to create them.
        assert!(dirs.backups_dir().is_dir());
        assert!(dirs.recovery_dir().is_dir());
        // Idempotent: a second run over existing folders is not an error.
        assert_eq!(dirs.ensure(), Vec::<String>::new());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// AD-21: the two folders hold unsaved work, so nobody but the owner may read
    /// them — including when they were created by an older build with a looser
    /// umask, which is why `ensure` re-applies the mode every start.
    #[cfg(unix)]
    #[test]
    fn the_backup_and_recovery_folders_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let (root, dirs) = scratch("mode");
        // A folder that is already there, world-readable, as an older build left it.
        std::fs::create_dir_all(dirs.recovery_dir()).unwrap();
        std::fs::set_permissions(dirs.recovery_dir(), std::fs::Permissions::from_mode(0o755))
            .unwrap();

        assert_eq!(dirs.ensure(), Vec::<String>::new());

        for dir in [dirs.backups_dir(), dirs.recovery_dir()] {
            let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, OWNER_ONLY, "{} is {mode:o}", dir.display());
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A folder that cannot be created is reported, not panicked over: the
    /// editor still has to start on a read-only home directory.
    #[test]
    fn ensure_reports_what_it_could_not_create() {
        let (root, _) = scratch("blocked");
        std::fs::create_dir_all(&root).unwrap();
        // A regular file where the config folder should go.
        std::fs::write(root.join("config"), b"not a folder").unwrap();
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        let failures = dirs.ensure();
        // The config folder and the scripts folder under it both fail; data works,
        // and so do the two folders under it.
        assert_eq!(failures.len(), 2, "{failures:?}");
        assert!(dirs.data.is_dir());
        assert!(dirs.backups_dir().is_dir() && dirs.recovery_dir().is_dir());
        let _ = std::fs::remove_dir_all(&root);
    }
}

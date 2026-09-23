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

use std::borrow::Cow;
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

// ---------------------------------------------------------------------------
// How Windows spells a path (M8)
// ---------------------------------------------------------------------------

/// The prefix `std::fs::canonicalize` puts in front of every path it returns on
/// Windows (documented on `std::fs::canonicalize`: "this converts the path to use
/// extended length path syntax").
const VERBATIM: &str = r"\\?\";

/// The same prefix for a network share: `\\?\UNC\server\share` is the verbatim
/// spelling of `\\server\share` ("Naming Files, Paths, and Namespaces").
const VERBATIM_UNC: &str = r"\\?\UNC\";

/// Whether `name` names one of DOS's devices rather than a file.
///
/// `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9` and `LPT1`-`LPT9` (and `COM¹`, `COM²`,
/// `COM³` and the `LPT` three, whose shaped digits Windows folds to the same
/// devices) are devices **whatever the extension**: `NUL.py` opens the same
/// bit bucket as `NUL`, writes to it vanish and reads of it come back empty. The
/// rule and that list are Microsoft's, in "Naming Files, Paths, and Namespaces":
/// "avoid these names followed immediately by an extension; for example, NUL.txt
/// and NUL.tar.gz are both equivalent to NUL".
///
/// `COM0` and `LPT0` are **not** on Microsoft's list and are refused anyway, as a
/// deliberate margin — the unit is matched as any ASCII digit. Both directions of the
/// over-reach are harmless and the two places this is used make that so: refusing a
/// name only ever costs a user the one script name `COM0.py`, which he can spell
/// `COM0_.py`, while treating it as a device in [`plain`] only ever *keeps* a `\\?\`
/// prefix, and a kept prefix always names the file it already named. Narrowing it to
/// Microsoft's exact list would be the direction that can go wrong: whether the
/// kernel's own `RtlIsDosDeviceName` stops at `1` is not documented anywhere we can
/// cite, and nobody on this project can put the question to a Windows machine. The
/// i18n string `scripts.nameDevice` and `isDeviceName` in `utils/platform.ts` say
/// `COM0`-`COM9` for the same reason; all three have to agree.
///
/// So the part that decides is what stands before the **first** dot, with trailing
/// spaces trimmed — those are what Win32 path normalization drops before it looks
/// the name up. Leading spaces are not trimmed by normalization, so ` CON` is an
/// ordinary file name and stays one here.
///
/// The answer does not depend on the platform this runs on — it is a fact about how
/// Windows reads a name, and the tests for it have to run somewhere. What each caller
/// *does* with the answer does depend on the platform: `scripts::discovery` refuses
/// the names it creates everywhere but only hides the ones on disk on Windows, where
/// they really are devices.
pub fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    if ["CON", "PRN", "AUX", "NUL"]
        .iter()
        .any(|device| stem.eq_ignore_ascii_case(device))
    {
        return true;
    }
    // `COM<unit>` and `LPT<unit>`, and nothing longer.
    let mut chars = stem.chars();
    let (Some(a), Some(b), Some(c), Some(unit)) =
        (chars.next(), chars.next(), chars.next(), chars.next())
    else {
        return false;
    };
    if chars.next().is_some() {
        return false;
    }
    let port = [
        a.to_ascii_uppercase(),
        b.to_ascii_uppercase(),
        c.to_ascii_uppercase(),
    ];
    (port == ['C', 'O', 'M'] || port == ['L', 'P', 'T'])
        && (unit.is_ascii_digit() || matches!(unit, '¹' | '²' | '³'))
}

/// The characters Win32 does not allow in a name, and therefore reads as something
/// other than part of one: `< > : " | ? *`, the control characters 1 through 31 and
/// the NUL byte (Microsoft, "Naming Files, Paths, and Namespaces", which lists those
/// two ranges separately). `/` and `\` are on that list too and are handled as
/// separators instead, one in [`is_plain_component`] and one by the split that feeds it.
///
/// A verbatim path never goes through that parse — the `\\?\` prefix "tells the
/// Windows APIs to disable all string parsing" — so a name holding one of these is
/// exactly the case where the two spellings are two different things.
fn is_win32_reserved(byte: u8) -> bool {
    matches!(
        byte,
        0..=31 | b'<' | b'>' | b':' | b'"' | b'|' | b'?' | b'*'
    )
}

/// One path component that means the same thing with and without a `\\?\` prefix.
///
/// A verbatim path is handed to the file system as it stands; an ordinary one is
/// normalized first, and normalization is what trims trailing dots and spaces, turns
/// `/` into a separator, resolves `.` and `..`, maps the DOS device names and reads
/// the reserved characters. A component that any of those would change is a component
/// whose two spellings name two different things, and [`plain`] then leaves the path
/// alone.
///
/// The reserved characters are the case a Linux or macOS CAM seat writes onto a share
/// (M8, G8): `\\?\UNC\nas\cam\2026-01-05T10:30:00.nc` is a perfectly good verbatim
/// path, and `\\nas\cam\2026-01-05T10:30:00.nc` is a request for the alternate data
/// stream `30:00.nc` of a file called `2026-01-05T10`. `?` and `*` make `CreateFileW`
/// fail with `ERROR_INVALID_NAME` instead, and `"`, `<` and `>` are the wildcards
/// `RtlDosPathNameToNtPathName` maps them onto. `dunce` refuses to strip a prefix over
/// the same set (`is_valid_filename`, dunce 1.0.5 `src/lib.rs`).
///
/// gEdit's own I/O cannot reach that case today — `std` only writes the prefix at 248
/// UTF-16 units or more, so a short path like the one above is never canonicalized,
/// and a long one is re-prefixed by `get_long_path` — but a `Resolved.path` is handed
/// unprefixed to `python.exe` and to the webview, so the rule belongs here rather than
/// in a comment saying it cannot happen.
fn is_plain_component(part: &str) -> bool {
    !part.is_empty()
        && !part.ends_with('.')
        && !part.ends_with(' ')
        && !part.contains('/')
        && !part.bytes().any(is_win32_reserved)
        && !is_device_name(part)
}

/// The ordinary spelling of a path: the `\\?\` of a canonicalized Windows path
/// removed, when removing it names the same file.
///
/// **This is the one boundary where a path becomes a string the rest of gEdit
/// compares.** `std::fs::canonicalize` is the only thing in gEdit that produces a
/// verbatim path, and everything else — the file dialog, the command line, the
/// recent list, `<config>/scripts` joined onto a file name — produces the ordinary
/// one. Two spellings of one file are two documents to
/// `pathKey` in `stores/documents.ts`, two entries to [`crate::state`]'s recent list
/// and two histories to [`crate::backup`]'s `folder_key`, so the two spellings are
/// folded into one here, at the point where a `Path` turns into something that is
/// compared or handed to the webview, and nowhere else.
///
/// It stays inside the fs scope: `Scope::allow_file` stores the path it is given
/// **and** its canonical form (`push_pattern` → `canonicalize_parent` in
/// `tauri/src/scope/fs.rs`), while `is_allowed` canonicalizes what it is asked
/// about — so granting the ordinary spelling grants the verbatim one with it.
///
/// It is not `cfg(windows)`-gated. Every path that reaches it is absolute, and an
/// absolute path on Unix begins with `/`, so the prefix cannot appear there; one
/// rule for every platform means the Windows spellings are covered by tests that run
/// on every platform, which is the only way this can be tested at all without a
/// Windows machine.
pub fn plain(path: &Path) -> Cow<'_, Path> {
    match path.to_str().and_then(plain_text) {
        Some(text) => Cow::Owned(PathBuf::from(text)),
        None => Cow::Borrowed(path),
    }
}

/// [`plain`] on the text of a path. `None` when the path is not a verbatim one, or
/// when dropping the prefix would change which file it names.
fn plain_text(path: &str) -> Option<String> {
    // The root is `server\share` for a share and `C:` for a drive; what follows it
    // are the file and folder names that normalization could change.
    let (rest, root_parts, prefix) = if let Some(rest) = path.strip_prefix(VERBATIM_UNC) {
        (rest, 2, r"\\")
    } else {
        let rest = path.strip_prefix(VERBATIM)?;
        // A drive, and only a drive: `\\?\Volume{…}` and `\\?\BootPartition` name
        // volumes that have no ordinary spelling at all.
        if !matches!(rest.as_bytes(), [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic()) {
            return None;
        }
        (rest, 1, "")
    };

    let mut parts = rest.split('\\');
    for _ in 0..root_parts {
        parts.next().filter(|part| !part.is_empty())?;
    }
    let mut parts = parts.peekable();
    while let Some(part) = parts.next() {
        // A trailing separator, as in `\\?\C:\`: the root is the whole path.
        if part.is_empty() && parts.peek().is_none() {
            break;
        }
        if !is_plain_component(part) {
            return None;
        }
    }
    Some(format!("{prefix}{rest}"))
}

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

    /// The device names, with and without an extension, in both cases, and the names
    /// that only look like one. A file called `NUL.py` is not a file (M8): writes to
    /// it vanish, so `New script ▸ NUL` would hand the user an editor tab over a bit
    /// bucket and every save would go nowhere.
    #[test]
    fn the_dos_device_names_are_recognized_whatever_the_extension() {
        for device in [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9", "COM0", "LPT0",
        ] {
            for name in [
                device.to_string(),
                device.to_lowercase(),
                format!("{device}.py"),
                format!("{device}.NC"),
                // "NUL.tar.gz ... equivalent to NUL": what counts is the first dot.
                format!("{device}.tar.gz"),
                // Normalization trims the trailing spaces before it matches.
                format!("{device} .py"),
                format!("{device}  "),
            ] {
                assert!(is_device_name(&name), "{name} names a device");
            }
        }
        // The shaped digits are the same three ports.
        assert!(is_device_name("COM¹") && is_device_name("LPT³"));
        for name in [
            "CONSOLE.py",
            "COM10.py",
            "COM.py",
            "NULL.py",
            "welle.nc",
            // A leading space is not trimmed by normalization, so this is a file.
            " CON.py",
            "my.CON",
            "",
        ] {
            assert!(!is_device_name(name), "{name} is an ordinary name");
        }
    }

    /// Both spellings of one Windows file have to come out as one string, or the file
    /// opens in two tabs, is two entries in the recent list and gets two backup
    /// histories (M8). Run on every platform on purpose: nobody here has Windows.
    #[test]
    fn a_verbatim_windows_path_is_folded_onto_its_ordinary_spelling() {
        let plain_of = |path: &str| plain(Path::new(path)).display().to_string();
        assert_eq!(plain_of(r"\\?\C:\nc\WELLE.NC"), r"C:\nc\WELLE.NC");
        assert_eq!(plain_of(r"\\?\c:\nc\WELLE.NC"), r"c:\nc\WELLE.NC");
        assert_eq!(plain_of(r"\\?\C:\"), r"C:\");
        // A share: `\\?\UNC\nas\cam\x` is `\\nas\cam\x`, which is the spelling the
        // file dialog hands back for the same file.
        assert_eq!(plain_of(r"\\?\UNC\nas\cam\WELLE.NC"), r"\\nas\cam\WELLE.NC");
        // Already ordinary, or not a path with an ordinary spelling at all.
        for path in [
            r"C:\nc\WELLE.NC",
            r"\\nas\cam\WELLE.NC",
            r"\\?\Volume{a5b2}\nc\WELLE.NC",
            r"\\?\BootPartition\x",
            "/nc/welle.nc",
            "welle.nc",
        ] {
            assert_eq!(plain_of(path), path, "{path} must be left alone");
        }
        // A bare share root folds too: `\\?\UNC\nas\cam` is `\\nas\cam`, with or
        // without the trailing separator. Never a document's own path, but `pathKey`
        // in the webview has to answer the same thing for it (G8 M8).
        assert_eq!(plain_of(r"\\?\UNC\nas\cam"), r"\\nas\cam");
        assert_eq!(plain_of(r#"\\?\UNC\nas\cam\"#), r#"\\nas\cam\"#);
        // The prefix is what keeps these from being normalized, so dropping it would
        // name something else: a device, a name a trailing dot or space is trimmed
        // off, a `/` that would become a separator, and the characters Win32 reads as
        // something other than part of a name.
        for path in [
            r"\\?\C:\nc\NUL.NC",
            r"\\?\C:\nc\welle.nc.",
            r"\\?\C:\nc\welle.nc ",
            r"\\?\C:\nc\a/b",
            r"\\?\UNC\nas\cam\NUL.NC",
            // A Linux CAM seat's timestamp name on a share. `:` would be read as an
            // alternate data stream of a file called `2026-01-05T10` (G8 M8).
            r"\\?\UNC\nas\cam\2026-01-05T10:30:00.nc",
            // `?` and `*` make `CreateFileW` fail with `ERROR_INVALID_NAME`; `"`, `<`
            // and `>` are the wildcards normalization maps them onto.
            r"\\?\C:\nc\what?.nc",
            r"\\?\C:\nc\star*.nc",
            r#"\\?\C:\nc\quote".nc"#,
            r"\\?\C:\nc\lt<gt>.nc",
            r"\\?\C:\nc\pipe|.nc",
            "\\\\?\\C:\\nc\\bell\x07.nc",
        ] {
            assert_eq!(plain_of(path), path, "{path} must keep its prefix");
        }
    }

    /// The webview has to know the same two rules: the New Script prompt says why a
    /// name is refused before the round trip, and `pathKey` folds the same two
    /// spellings so that one file is one tab. That means the rules are written twice,
    /// and this is what catches a change made to only one of them — the pattern
    /// `backup.rs` uses for the settings schema.
    #[test]
    fn the_webview_mirrors_these_two_rules() {
        let ts = crate::source_scan::lf(include_str!("../../src/lib/utils/platform.ts"));
        assert!(
            // Spelled without the escapes the regex writes the three shaped digits
            // with, so that this needle is the same characters in both files.
            ts.contains("^(CON|PRN|AUX|NUL|(COM|LPT)[0-9"),
            "platform.ts no longer knows the device names"
        );
        assert!(
            ts.contains("export function plainPath(")
                && ts.contains("export function isDeviceName("),
            "platform.ts no longer exports the two rules"
        );
        // And the third: the characters only a verbatim path can carry (G8 M8).
        assert!(
            ts.contains(r#"const WIN32_RESERVED = '<>:"|?*';"#)
                && ts.contains("charCodeAt(i) <= 31"),
            "platform.ts no longer knows Win32's reserved characters"
        );
        // And the one place a path becomes a document's identity uses it.
        let documents = crate::source_scan::lf(include_str!("../../src/lib/stores/documents.ts"));
        assert!(
            documents.contains("plainPath(path)"),
            "pathKey no longer folds the `\\\\?\\` spelling"
        );
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

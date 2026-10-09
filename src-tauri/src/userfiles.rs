//! The user's own profiles and code files: `<config>/profiles/` and `<config>/codes/`
//! (plan §7.10, §4 "User profiles and code files (M13)", AD-29).
//!
//! The rules, all of them binding (P13 wrote the name and kind rules, WP13.1 the commands):
//!
//! - **Fixed folders.** `kind` is `"profiles"` or `"codes"` ([`Kind::parse`]); the folder is
//!   `<config>/<kind>` ([`crate::paths::AppDirs::profiles_dir`], `codes_dir`). The webview
//!   never sends a folder or a path into it, only a kind and a plain name.
//! - **Names** ([`validate_name`]): `^[a-z0-9][a-z0-9._-]{0,63}\.json$`, and not a DOS device
//!   name (`con.json`, `nul.json`, `com1.json`) on any platform, because a folder of user
//!   files is copied between machines. Lower case only, so two spellings of one name can
//!   never be two files on Linux and one on macOS or Windows.
//! - **`user_files_list`**: the `.json` entries of the folder (the extension in any case),
//!   sorted by name, at most [`MAX_FILES`]; every one whose name passes is read as UTF-8 text
//!   of at most [`MAX_BYTES`]. A file that fails (too large, not UTF-8, unreadable) is listed
//!   with `text: None` and an `error`, never dropped silently; a 65th file is not read and is
//!   reported once. A symlink is never followed (`symlink_metadata`): it is listed with an
//!   error, whatever it points at, so a link cannot pull a file from outside the folder into
//!   the app. A `.json` name that fails the rule (`Lathe-Shop.json`, `my profile.json`) is
//!   listed too, with `text: None` and the reason, and is **not read**: it cannot be addressed,
//!   but the user has to be told why it is not loaded, and on a volume that does not tell
//!   `Lathe.json` from `lathe.json` it holds the name. Names that start with `.` (the staging
//!   files) and entries that are not `.json` are not listed. A missing folder lists as empty.
//!   Nothing is granted.
//! - **`user_file_create`**: `text` must parse as one JSON **object** of at most
//!   [`MAX_BYTES`]; written with [`crate::atomic::write_atomic`]; **never overwrites**
//!   (`Err` when the name exists, checked again at the rename: `create_new` semantics);
//!   the new file's path is granted to the fs scope (that one file) and returned, so the
//!   webview can open it as a document.
//! - **`user_file_path`**: the file must exist and be a regular file (not a link); its
//!   path is granted (that one file) and returned. For Open and Export.
//! - **`user_file_import`**: `src` must pass `fs_scope().is_allowed` (a file the user
//!   picked in the open dialog), must be a regular file of at most [`MAX_BYTES`] holding
//!   one JSON object; its own file name must pass [`validate_name`] after lower-casing
//!   (`Lathe-Shop.JSON` → `lathe-shop.json`; anything else is refused with the reason);
//!   the copy is atomic and never overwrites. Answers the name it got.
//! - **`user_file_delete`**: a regular file of the folder (a link is removed as a link,
//!   never followed); nothing else.
//!
//! What the implementation adds, and why it is safe to:
//!
//! - **Nothing outside the two folders is ever opened.** Every path is `<folder>/<name>` with a
//!   validated name (no separator, `..`, `:`, `<>"|`, trailing dot or space, device name), or the
//!   one `src` of the import, which has to be absolute, free of `..` and allowed by the scope.
//! - **A link is never followed.** Every read first stats the entry with `symlink_metadata`
//!   (a symlink, or on Windows any reparse point, is refused), opens it (on Unix with
//!   `O_NOFOLLOW`), and checks the opened handle is the file that was statted (Unix: same device
//!   and inode), so a swap between the stat and the open is caught. The import refuses a
//!   source that is a link, too.
//! - **A file is published without overwriting.** The bytes are written complete to a hidden
//!   staging file in the same folder ([`write_atomic`]: temp, fsync, rename), which is then
//!   *hard-linked* to its name (`link` fails when the name exists, on every platform, and
//!   leaves the file at the name whole or absent) and removed. Where the file system has no
//!   hard links the fallback is `create_new` plus a write, which still never overwrites.
//!   The staging file's name starts with `.` and so never passes [`validate_name`]: it is
//!   neither listed nor addressable, even if a crash leaves it behind.
//! - **Grants are one file.** Only `user_file_create` and `user_file_path` grant, each the
//!   one file it answers with ([`crate::state::grant_in`]); the list, the import and the
//!   delete grant nothing, and the folder is never granted. There is no revoke (as for
//!   `machines_open_file`).
//! - **The folder itself** is the app's own (`<config>/profiles`); if the user replaced it by
//!   a link on purpose, that is theirs to do and is followed. Entries inside it never are.
//! - **Hard links** of a file in the folder to somewhere else are indistinguishable from a
//!   file; the user made them, and the rules above keep the app from creating one outward.
//!
//! Errors are short English detail (AD-14); the webview words the message.

use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::atomic::write_atomic;
use crate::paths::{self, AppDirs};

/// The most files one folder lists (AD-29).
pub const MAX_FILES: usize = 64;

/// The largest file read, created or imported: 1 MiB (AD-29, the cap of `machines.json`).
pub const MAX_BYTES: u64 = 1024 * 1024;

/// Which of the two folders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Profiles,
    Codes,
}

impl Kind {
    /// `"profiles"` or `"codes"`; anything else is refused.
    pub fn parse(kind: &str) -> Result<Kind, String> {
        match kind {
            "profiles" => Ok(Kind::Profiles),
            "codes" => Ok(Kind::Codes),
            _ => Err(format!("unknown kind of user file: {kind:?}")),
        }
    }

    /// The folder of this kind.
    pub fn folder(self, dirs: &AppDirs) -> std::path::PathBuf {
        match self {
            Kind::Profiles => dirs.profiles_dir(),
            Kind::Codes => dirs.codes_dir(),
        }
    }
}

/// One file of a folder; camelCase on the wire (`platform/commands.ts` `UserFile`).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFile {
    pub name: String,
    /// The text, or `None` when it could not be read (then `error` says why).
    pub text: Option<String>,
    pub error: Option<String>,
}

/// Why `name` is not a user file name, or `None` when it is one (§4).
pub fn validate_name(name: &str) -> Option<&'static str> {
    let Some(stem) = name.strip_suffix(".json") else {
        return Some("not a .json name");
    };
    let mut chars = stem.chars();
    match chars.next() {
        None => return Some("empty"),
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        Some(_) => return Some("has to start with a lower-case letter or a digit"),
    }
    if stem.chars().count() > 64 {
        return Some("too long");
    }
    if !chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
    {
        return Some("only a-z, 0-9, '.', '_' and '-'");
    }
    if paths::is_device_name(name) {
        return Some("device name");
    }
    None
}

/// A refused name, as the commands answer it.
fn check_name(name: &str) -> Result<(), String> {
    match validate_name(name) {
        None => Ok(()),
        Some(reason) => Err(format!("{name:?} is not a user file name: {reason}")),
    }
}

// ---------------------------------------------------------------------------
// Reading one entry
// ---------------------------------------------------------------------------

/// A short reason for an I/O error; never a path, never the OS wording.
fn why(err: &io::Error) -> &'static str {
    match err.kind() {
        io::ErrorKind::NotFound => "not found",
        io::ErrorKind::PermissionDenied => "permission denied",
        io::ErrorKind::AlreadyExists => "already exists",
        _ => "could not be accessed",
    }
}

/// The reason `meta` (of `symlink_metadata`) is not a plain file, or `None` when it is one.
fn not_regular(meta: &Metadata) -> Option<&'static str> {
    if meta.file_type().is_symlink() || is_reparse_point(meta) {
        return Some("a link, not followed");
    }
    if !meta.is_file() {
        return Some("not a regular file");
    }
    None
}

/// Windows: any reparse point (symlink, junction, mount point, cloud placeholder) is not
/// a plain file. Elsewhere there is no such thing.
#[cfg(windows)]
fn is_reparse_point(meta: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_meta: &Metadata) -> bool {
    false
}

/// Whether the opened handle is the file that was statted (Unix: device and inode).
#[cfg(unix)]
fn same_file(before: &Metadata, after: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    before.dev() == after.dev() && before.ino() == after.ino()
}

#[cfg(not(unix))]
fn same_file(_before: &Metadata, _after: &Metadata) -> bool {
    true
}

/// Opens `path` for reading without following a link in its last component.
fn open_no_follow(path: &Path) -> io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// The bytes of the plain file `path`, of at most [`MAX_BYTES`]; never follows a link.
fn read_regular(path: &Path) -> Result<Vec<u8>, String> {
    let before = fs::symlink_metadata(path).map_err(|err| why(&err).to_string())?;
    if let Some(reason) = not_regular(&before) {
        return Err(reason.into());
    }
    if before.len() > MAX_BYTES {
        return Err("larger than 1 MiB".into());
    }
    let file = open_no_follow(path).map_err(|err| why(&err).to_string())?;
    let after = file.metadata().map_err(|err| why(&err).to_string())?;
    if !after.is_file() || !same_file(&before, &after) {
        return Err("changed while it was read".into());
    }
    let mut bytes = Vec::new();
    // One byte more than the cap, so a file that grew after the stat is still refused.
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| why(&err).to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("larger than 1 MiB".into());
    }
    Ok(bytes)
}

/// The text of a plain file: [`read_regular`] and UTF-8.
fn read_text(path: &Path) -> Result<String, String> {
    String::from_utf8(read_regular(path)?).map_err(|_| "not UTF-8 text".to_string())
}

/// `bytes` have to be one JSON object (the root of a profile or a code file).
fn check_object(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("larger than 1 MiB".into());
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Err("starts with a byte order mark; save it as UTF-8 without one".into());
    }
    match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Object(_)) => Ok(()),
        Ok(_) => Err("not a JSON object".into()),
        Err(_) => Err("not valid JSON".into()),
    }
}

// ---------------------------------------------------------------------------
// The commands' bodies
// ---------------------------------------------------------------------------

/// Whether a directory entry is listed: a `.json` file (the extension in any case) that is not a
/// hidden or staging file. Whether its name passes [`validate_name`] decides if it is read.
fn listed_name(name: &str) -> bool {
    !name.starts_with('.') && name.to_ascii_lowercase().ends_with(".json")
}

/// The body of `user_files_list` against a folder.
///
/// A folder that does not exist lists as empty; one that cannot be read is `Err`.
pub fn list_in(folder: &Path) -> Result<Vec<UserFile>, String> {
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("the folder could not be read: {}", why(&err))),
    };
    let mut names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| listed_name(name))
        .collect();
    names.sort();
    let mut listed = Vec::new();
    for (index, name) in names.into_iter().enumerate() {
        if index == MAX_FILES {
            // The first file past the cap says so, once; the rest are not even named.
            listed.push(UserFile {
                name,
                text: None,
                error: Some(format!("more than {MAX_FILES} files; this one is not read")),
            });
            break;
        }
        if let Some(reason) = validate_name(&name) {
            // Not read: the name cannot be addressed by any command, so nothing is opened by it.
            listed.push(UserFile {
                name,
                text: None,
                error: Some(format!(
                    "not a valid file name ({reason}); rename it to lower case without spaces"
                )),
            });
            continue;
        }
        let file = match read_text(&folder.join(&name)) {
            Ok(text) => UserFile {
                name,
                text: Some(text),
                error: None,
            },
            Err(error) => UserFile {
                name,
                text: None,
                error: Some(error),
            },
        };
        listed.push(file);
    }
    Ok(listed)
}

/// Makes the staging names unique within the process.
static NEXT_STAGING: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to `folder/name` complete or not at all, never replacing a file or a
/// link of that name. `between` runs after the name was found free and the bytes are
/// staged, before they are published: the window a concurrent create can use.
fn create_in(
    folder: &Path,
    name: &str,
    bytes: &[u8],
    between: impl FnOnce(),
) -> Result<PathBuf, String> {
    let target = folder.join(name);
    // A link counts as taken, a dangling one too (`symlink_metadata`, not `exists`).
    if fs::symlink_metadata(&target).is_ok() {
        return Err(format!("{name:?} already exists"));
    }
    let staging = folder.join(format!(
        ".{name}.new-{}-{}",
        std::process::id(),
        NEXT_STAGING.fetch_add(1, Ordering::Relaxed)
    ));
    write_atomic(&staging, bytes).map_err(|err| format!("could not be written: {}", why(&err)))?;
    between();
    let published = match fs::hard_link(&staging, &target) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => Err(err),
        // No hard links on this file system: write the name itself, still without replacing.
        Err(_) => publish_copy(bytes, &target),
    };
    let _ = fs::remove_file(&staging);
    match published {
        Ok(()) => Ok(target),
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
            Err(format!("{name:?} already exists"))
        }
        Err(err) => Err(format!("could not be written: {}", why(&err))),
    }
}

/// The fallback of [`create_in`]: `create_new` (fails on any existing name), write, fsync;
/// a failed write removes what it created.
fn publish_copy(bytes: &[u8], target: &Path) -> io::Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if written.is_err() {
        let _ = fs::remove_file(target);
    }
    written
}

/// The body of `user_file_create`: validates, writes, grants the one file, answers its path.
pub fn create_with(
    folder: &Path,
    name: &str,
    text: &str,
    grant: impl Fn(&Path),
) -> Result<String, String> {
    check_name(name)?;
    check_object(text.as_bytes())?;
    let path = create_in(folder, name, text.as_bytes(), || {})?;
    grant(&path);
    Ok(path.to_string_lossy().into_owned())
}

/// The existing plain file `folder/name`.
fn existing(folder: &Path, name: &str) -> Result<PathBuf, String> {
    check_name(name)?;
    let path = folder.join(name);
    let meta = fs::symlink_metadata(&path).map_err(|err| format!("{name:?}: {}", why(&err)))?;
    match not_regular(&meta) {
        None => Ok(path),
        Some(reason) => Err(format!("{name:?} is {reason}")),
    }
}

/// The body of `user_file_path`: the file has to exist; grants that one file.
pub fn path_with(folder: &Path, name: &str, grant: impl Fn(&Path)) -> Result<String, String> {
    let path = existing(folder, name)?;
    grant(&path);
    Ok(path.to_string_lossy().into_owned())
}

/// The body of `user_file_import`: copies the picked file `src` into `folder` under its own
/// lower-cased name. Grants nothing.
pub fn import_with(
    folder: &Path,
    src: &str,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<String, String> {
    let source = Path::new(src);
    if src.contains('\0') || !source.is_absolute() {
        return Err("not an absolute path".into());
    }
    if source
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("path is not a plain absolute path".into());
    }
    if !is_allowed(source) {
        return Err("path is not allowed".into());
    }
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("the file has no usable name")?;
    // ASCII only: a non-ASCII letter must stay one and be refused by the rule.
    let name = file_name.to_ascii_lowercase();
    check_name(&name)?;
    let bytes = read_regular(source).map_err(|reason| format!("{file_name:?}: {reason}"))?;
    check_object(&bytes).map_err(|reason| format!("{file_name:?}: {reason}"))?;
    create_in(folder, &name, &bytes, || {})?;
    Ok(name)
}

/// The body of `user_file_delete`: removes the plain file, or the link itself, never its target.
pub fn delete_in(folder: &Path, name: &str) -> Result<(), String> {
    check_name(name)?;
    let path = folder.join(name);
    let meta = fs::symlink_metadata(&path).map_err(|err| format!("{name:?}: {}", why(&err)))?;
    if meta.file_type().is_symlink() || is_reparse_point(&meta) {
        // A link to a folder is removed with `remove_dir` on Windows, never recursively.
        return fs::remove_file(&path)
            .or_else(|_| fs::remove_dir(&path))
            .map_err(|err| format!("{name:?}: {}", why(&err)));
    }
    if !meta.is_file() {
        return Err(format!("{name:?} is not a regular file"));
    }
    fs::remove_file(&path).map_err(|err| format!("{name:?}: {}", why(&err)))
}

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

/// The folder of `kind` in the app's config folder.
fn folder_of(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let kind = Kind::parse(kind)?;
    Ok(kind.folder(&paths::app_dirs(app)?))
}

/// Joins a blocking task, whose panic is the only way it can fail to answer.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "the operation failed".to_string())?
}

/// Every `.json` file of `<config>/<kind>`, read; see the module documentation.
#[tauri::command]
pub async fn user_files_list(app: AppHandle, kind: String) -> Result<Vec<UserFile>, String> {
    let folder = folder_of(&app, &kind)?;
    blocking(move || list_in(&folder)).await
}

/// A new file holding one JSON object; atomic, never overwrites, that one file granted.
#[tauri::command]
pub async fn user_file_create(
    app: AppHandle,
    kind: String,
    name: String,
    text: String,
) -> Result<String, String> {
    let folder = folder_of(&app, &kind)?;
    let scope = app.fs_scope();
    blocking(move || {
        create_with(&folder, &name, &text, |path| {
            crate::state::grant_in(&scope, path)
        })
    })
    .await
}

/// The path of an existing file, that one file granted.
#[tauri::command]
pub async fn user_file_path(app: AppHandle, kind: String, name: String) -> Result<String, String> {
    let folder = folder_of(&app, &kind)?;
    let scope = app.fs_scope();
    blocking(move || path_with(&folder, &name, |path| crate::state::grant_in(&scope, path))).await
}

/// A copy of a file the user picked into the folder; never overwrites; answers its name.
#[tauri::command]
pub async fn user_file_import(app: AppHandle, kind: String, src: String) -> Result<String, String> {
    let folder = folder_of(&app, &kind)?;
    let scope = app.fs_scope();
    blocking(move || import_with(&folder, &src, |path| scope.is_allowed(path))).await
}

/// Removes one file of the folder.
#[tauri::command]
pub async fn user_file_delete(app: AppHandle, kind: String, name: String) -> Result<(), String> {
    let folder = folder_of(&app, &kind)?;
    blocking(move || delete_in(&folder, &name)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn only_the_two_kinds_are_folders() {
        assert_eq!(Kind::parse("profiles"), Ok(Kind::Profiles));
        assert_eq!(Kind::parse("codes"), Ok(Kind::Codes));
        for bad in [
            "",
            "Profiles",
            "scripts",
            "../profiles",
            "profiles/",
            "codes\0",
        ] {
            assert!(Kind::parse(bad).is_err(), "{bad:?}");
        }
        let dirs = AppDirs {
            config: PathBuf::from("/c"),
            data: PathBuf::from("/d"),
        };
        assert_eq!(
            Kind::Profiles.folder(&dirs),
            PathBuf::from("/c").join("profiles")
        );
        assert_eq!(Kind::Codes.folder(&dirs), PathBuf::from("/c").join("codes"));
    }

    #[test]
    fn a_name_is_a_plain_lower_case_json_name() {
        for ok in [
            "lathe-shop.json",
            "fanuc-lathe.json",
            "a.json",
            "0.json",
            "my_lathe.v2.json",
            &format!("{}.json", "a".repeat(64)),
        ] {
            assert_eq!(validate_name(ok), None, "{ok}");
        }
        for (bad, why) in [
            ("lathe.JSON", "not a .json name"),
            ("lathe", "not a .json name"),
            (".json", "empty"),
            (
                "Lathe.json",
                "has to start with a lower-case letter or a digit",
            ),
            (
                "-lathe.json",
                "has to start with a lower-case letter or a digit",
            ),
            (
                ".hidden.json",
                "has to start with a lower-case letter or a digit",
            ),
            ("lathe shop.json", "only a-z, 0-9, '.', '_' and '-'"),
            ("lathe/x.json", "only a-z, 0-9, '.', '_' and '-'"),
            ("lathe\\x.json", "only a-z, 0-9, '.', '_' and '-'"),
            ("lathé.json", "only a-z, 0-9, '.', '_' and '-'"),
            ("con.json", "device name"),
            ("nul.json", "device name"),
            ("com1.json", "device name"),
        ] {
            assert_eq!(validate_name(bad), Some(why), "{bad}");
        }
        assert_eq!(
            validate_name(&format!("{}.json", "a".repeat(65))),
            Some("too long")
        );
    }

    // --- scaffolding ------------------------------------------------------------

    fn scratch(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("gedit-userfiles-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    /// A scratch root with its `profiles` folder made; returns `(root, folder)`.
    fn with_folder(name: &str) -> (PathBuf, PathBuf) {
        let root = scratch(name);
        let folder = root.join("profiles");
        fs::create_dir_all(&folder).unwrap();
        (root, folder)
    }

    fn entries(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    /// A link `link` -> `target`; `false` where the platform (or its privileges) has none.
    fn make_link(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(target, link).is_ok()
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = (target, link);
            false
        }
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("could not build the mock app")
    }

    /// `{"k":"xxx..."}` of exactly `len` bytes.
    fn object_of(len: usize) -> String {
        let overhead = r#"{"k":""}"#.len();
        format!(r#"{{"k":"{}"}}"#, "x".repeat(len - overhead))
    }

    // --- names ------------------------------------------------------------------

    #[test]
    fn every_windows_and_path_form_of_a_name_is_refused() {
        for bad in [
            "../x.json",
            "a/../b.json",
            "..\\x.json",
            "sub/x.json",
            "/etc/passwd.json",
            "C:\\x.json",
            "c:x.json",
            "a:b.json",
            "a.json:stream",
            "a.json:$DATA",
            "x.json.",
            "x.json ",
            "x .json",
            "a<b.json",
            "a>b.json",
            "a\"b.json",
            "a|b.json",
            "a*b.json",
            "a?b.json",
            "a\0b.json",
            "a\nb.json",
            "CON.json",
            "con.json",
            "prn.json",
            "aux.json",
            "nul.json",
            "com1.json",
            "com9.json",
            "lpt1.json",
            "lpt9.json",
            "con.v2.json",
            "nul.x.json",
            "com\u{b9}.json",
            "",
            ".",
            "..",
            ".json",
            "x.json.json.txt",
        ] {
            assert!(validate_name(bad).is_some(), "{bad:?}");
            assert!(check_name(bad).is_err(), "{bad:?}");
        }
        // Not devices: longer than the device name.
        assert_eq!(validate_name("console.json"), None);
        assert_eq!(validate_name("com10.json"), None);
    }

    #[test]
    fn a_bad_name_reaches_no_command_body() {
        let (root, folder) = with_folder("badnames");
        let outside = root.join("outside.json");
        fs::write(&outside, "{}").unwrap();
        for bad in [
            "../outside.json",
            "..\\outside.json",
            "con.json",
            "A.json",
            "a:b.json",
        ] {
            assert!(create_with(&folder, bad, "{}", |_| panic!("granted")).is_err());
            assert!(path_with(&folder, bad, |_| panic!("granted")).is_err());
            assert!(delete_in(&folder, bad).is_err());
        }
        assert!(outside.exists());
        assert_eq!(entries(&folder), Vec::<String>::new());
        let _ = fs::remove_dir_all(&root);
    }

    // --- list -------------------------------------------------------------------

    #[test]
    fn a_missing_folder_lists_as_empty() {
        let root = scratch("nofolder");
        assert_eq!(list_in(&root.join("profiles")).unwrap(), Vec::new());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_list_is_sorted_and_names_that_fail_the_rule_are_listed_unread() {
        let (root, folder) = with_folder("sorted");
        for name in [
            "b.json",
            "a.json",
            "c.txt",
            "Upper.json",
            ".hidden.json",
            "con.json",
            "d e.json",
        ] {
            fs::write(folder.join(name), "{}").unwrap();
        }
        fs::create_dir(folder.join("sub")).unwrap();
        let listed = list_in(&folder).unwrap();
        let names: Vec<&str> = listed.iter().map(|f| f.name.as_str()).collect();
        // `c.txt`, the hidden file and the folder are not `.json` files of the user's.
        assert_eq!(
            names,
            ["Upper.json", "a.json", "b.json", "con.json", "d e.json"]
        );
        // A name that follows the rule is read; one that does not is listed with the reason, unread.
        for name in ["a.json", "b.json"] {
            let file = listed.iter().find(|f| f.name == name).unwrap();
            assert_eq!(file.text.as_deref(), Some("{}"));
            assert_eq!(file.error, None);
        }
        for name in ["Upper.json", "con.json", "d e.json"] {
            let file = listed.iter().find(|f| f.name == name).unwrap();
            assert_eq!(file.text, None, "{name}");
            let error = file.error.as_deref().unwrap();
            assert!(
                error.starts_with("not a valid file name ("),
                "{name}: {error}"
            );
            assert!(error.contains("rename it"), "{name}: {error}");
        }
        // The upper-case extension counts as `.json` too.
        fs::write(folder.join("LATHE.JSON"), "{}").unwrap();
        let listed = list_in(&folder).unwrap();
        assert!(listed
            .iter()
            .any(|f| f.name == "LATHE.JSON" && f.text.is_none()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_list_reads_text_up_to_one_mib_and_reports_the_rest() {
        let (root, folder) = with_folder("sizes");
        let exact = object_of(MAX_BYTES as usize);
        fs::write(folder.join("exact.json"), &exact).unwrap();
        fs::write(folder.join("big.json"), object_of(MAX_BYTES as usize + 1)).unwrap();
        fs::write(folder.join("bad.json"), [0xff, 0xfe, b'{', b'}']).unwrap();
        fs::write(folder.join("ok.json"), "{\"a\":1}").unwrap();
        // A directory with a good name is listed with a reason, not read.
        fs::create_dir(folder.join("dir.json")).unwrap();
        let listed = list_in(&folder).unwrap();
        let by = |name: &str| listed.iter().find(|f| f.name == name).unwrap().clone();
        assert_eq!(by("exact.json").text.as_deref(), Some(exact.as_str()));
        assert_eq!(by("ok.json").text.as_deref(), Some("{\"a\":1}"));
        assert_eq!(by("big.json").text, None);
        assert_eq!(by("big.json").error.as_deref(), Some("larger than 1 MiB"));
        assert_eq!(by("bad.json").text, None);
        assert_eq!(by("bad.json").error.as_deref(), Some("not UTF-8 text"));
        assert_eq!(by("dir.json").text, None);
        assert_eq!(by("dir.json").error.as_deref(), Some("not a regular file"));
        assert_eq!(listed.len(), 5);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_sixty_fifth_file_is_reported_once_and_not_read() {
        let (root, folder) = with_folder("cap");
        for n in 0..70 {
            fs::write(folder.join(format!("p{n:02}.json")), "{}").unwrap();
        }
        let listed = list_in(&folder).unwrap();
        assert_eq!(listed.len(), MAX_FILES + 1);
        assert!(listed[..MAX_FILES]
            .iter()
            .all(|f| f.text.is_some() && f.error.is_none()));
        let last = &listed[MAX_FILES];
        assert_eq!(last.name, "p64.json");
        assert_eq!(last.text, None);
        assert!(last.error.as_deref().unwrap().contains("64"));
        // Exactly 64 files: all read, nothing reported.
        fs::remove_file(folder.join("p64.json")).unwrap();
        for n in 65..70 {
            fs::remove_file(folder.join(format!("p{n}.json"))).unwrap();
        }
        assert_eq!(list_in(&folder).unwrap().len(), MAX_FILES);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_link_is_listed_with_an_error_and_never_read() {
        let (root, folder) = with_folder("link-list");
        let secret = root.join("secret.json");
        fs::write(&secret, "{\"secret\":true}").unwrap();
        if !make_link(&secret, &folder.join("out.json")) {
            eprintln!("no symlinks here; skipped");
            return;
        }
        // A dangling one, and one pointing at a folder.
        assert!(make_link(
            &root.join("nowhere.json"),
            &folder.join("dangling.json")
        ));
        let listed = list_in(&folder).unwrap();
        assert_eq!(listed.len(), 2);
        for file in &listed {
            assert_eq!(file.text, None, "{}", file.name);
            assert_eq!(file.error.as_deref(), Some("a link, not followed"));
        }
        let _ = fs::remove_dir_all(&root);
    }

    // --- create -----------------------------------------------------------------

    #[test]
    fn create_writes_one_object_and_leaves_no_temp_file() {
        let (root, folder) = with_folder("create");
        let granted = std::cell::RefCell::new(Vec::new());
        let path = create_with(&folder, "lathe.json", "{\"id\":\"x\"}", |p| {
            granted.borrow_mut().push(p.to_path_buf())
        })
        .unwrap();
        assert_eq!(PathBuf::from(&path), folder.join("lathe.json"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"id\":\"x\"}");
        assert_eq!(entries(&folder), ["lathe.json"]);
        assert_eq!(*granted.borrow(), [folder.join("lathe.json")]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_makes_a_missing_folder_and_only_that_folder() {
        let root = scratch("create-mkdir");
        let folder = root.join("codes");
        create_with(&folder, "a.json", "{}", |_| {}).unwrap();
        assert_eq!(entries(&folder), ["a.json"]);
        assert_eq!(entries(&root), ["codes"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_takes_one_json_object_of_at_most_one_mib() {
        let (root, folder) = with_folder("create-json");
        for (text, why) in [
            ("[]", "not a JSON object"),
            ("\"s\"", "not a JSON object"),
            ("12", "not a JSON object"),
            ("null", "not a JSON object"),
            ("", "not valid JSON"),
            ("{", "not valid JSON"),
            ("{} {}", "not valid JSON"),
            ("not json", "not valid JSON"),
            (
                "\u{feff}{}",
                "starts with a byte order mark; save it as UTF-8 without one",
            ),
        ] {
            let err = create_with(&folder, "x.json", text, |_| panic!("granted")).unwrap_err();
            assert_eq!(err, why, "{text:?}");
        }
        let too_big = object_of(MAX_BYTES as usize + 1);
        assert_eq!(
            create_with(&folder, "x.json", &too_big, |_| {}).unwrap_err(),
            "larger than 1 MiB"
        );
        assert_eq!(entries(&folder), Vec::<String>::new());
        let exact = object_of(MAX_BYTES as usize);
        create_with(&folder, "x.json", &exact, |_| {}).unwrap();
        assert_eq!(
            fs::metadata(folder.join("x.json")).unwrap().len(),
            MAX_BYTES
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_never_overwrites() {
        let (root, folder) = with_folder("create-keep");
        fs::write(folder.join("keep.json"), "{\"old\":1}").unwrap();
        let err =
            create_with(&folder, "keep.json", "{\"new\":1}", |_| panic!("granted")).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(
            fs::read_to_string(folder.join("keep.json")).unwrap(),
            "{\"old\":1}"
        );
        assert_eq!(entries(&folder), ["keep.json"]);
        // A link of that name (also a dangling one) counts as taken.
        if make_link(&root.join("nowhere.json"), &folder.join("dang.json")) {
            assert!(create_with(&folder, "dang.json", "{}", |_| {}).is_err());
            assert!(!root.join("nowhere.json").exists());
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// The name is created between the check and the publish: the other file wins whole,
    /// ours is refused, and nothing is left behind.
    #[test]
    fn create_loses_a_race_without_touching_the_winner() {
        let (root, folder) = with_folder("create-race");
        let target = folder.join("race.json");
        let result = create_in(&folder, "race.json", b"{\"ours\":1}", || {
            fs::write(&target, "{\"theirs\":1}").unwrap();
        });
        assert!(result.unwrap_err().contains("already exists"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"theirs\":1}");
        assert_eq!(entries(&folder), ["race.json"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_fallback_without_hard_links_does_not_overwrite_either() {
        let (root, folder) = with_folder("create-copy");
        let target = folder.join("c.json");
        publish_copy(b"{\"a\":1}", &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"{\"a\":1}");
        let err = publish_copy(b"{\"b\":1}", &target).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&target).unwrap(), b"{\"a\":1}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn staged_files_are_hidden_from_the_list() {
        let (root, folder) = with_folder("staging");
        fs::write(folder.join(".a.json.new-1-1"), "{}").unwrap();
        fs::write(folder.join("..a.json.new-1-1.tmp-1-1"), "{}").unwrap();
        assert_eq!(list_in(&folder).unwrap(), Vec::new());
        let _ = fs::remove_dir_all(&root);
    }

    // --- path -------------------------------------------------------------------

    #[test]
    fn path_answers_an_existing_regular_file_and_grants_it() {
        let (root, folder) = with_folder("path");
        fs::write(folder.join("a.json"), "{}").unwrap();
        let granted = std::cell::RefCell::new(Vec::new());
        let path = path_with(&folder, "a.json", |p| {
            granted.borrow_mut().push(p.to_path_buf())
        })
        .unwrap();
        assert_eq!(PathBuf::from(path), folder.join("a.json"));
        assert_eq!(*granted.borrow(), [folder.join("a.json")]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn path_of_a_missing_file_a_folder_or_a_link_is_refused() {
        let (root, folder) = with_folder("path-bad");
        let never = |_: &Path| panic!("granted");
        assert!(path_with(&folder, "missing.json", never)
            .unwrap_err()
            .contains("not found"));
        fs::create_dir(folder.join("dir.json")).unwrap();
        assert!(path_with(&folder, "dir.json", never).is_err());
        let secret = root.join("secret.json");
        fs::write(&secret, "{}").unwrap();
        if make_link(&secret, &folder.join("out.json")) {
            assert!(path_with(&folder, "out.json", never)
                .unwrap_err()
                .contains("link"));
            assert!(make_link(
                &root.join("nowhere.json"),
                &folder.join("dang.json")
            ));
            assert!(path_with(&folder, "dang.json", never).is_err());
        }
        let _ = fs::remove_dir_all(&root);
    }

    // --- import -----------------------------------------------------------------

    #[test]
    fn import_copies_the_bytes_under_the_lower_cased_name() {
        let (root, folder) = with_folder("import");
        let src = root.join("Lathe-Shop.JSON");
        let text = "{ \"id\" : \"lathe-shop\" }\n";
        fs::write(&src, text).unwrap();
        let name = import_with(&folder, src.to_str().unwrap(), |p| p == src).unwrap();
        assert_eq!(name, "lathe-shop.json");
        assert_eq!(
            fs::read_to_string(folder.join("lathe-shop.json")).unwrap(),
            text
        );
        assert_eq!(entries(&folder), ["lathe-shop.json"]);
        assert!(src.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn import_of_a_source_the_scope_does_not_allow_is_refused() {
        let (root, folder) = with_folder("import-scope");
        let src = root.join("a.json");
        fs::write(&src, "{}").unwrap();
        let err = import_with(&folder, src.to_str().unwrap(), |_| false).unwrap_err();
        assert_eq!(err, "path is not allowed");
        assert_eq!(entries(&folder), Vec::<String>::new());
        // Against the real scope: refused until granted, and the import itself grants nothing.
        let app = mock_app();
        let scope = app.fs_scope();
        let call = || import_with(&folder, src.to_str().unwrap(), |p| scope.is_allowed(p));
        assert!(call().is_err());
        scope.allow_file(&src).unwrap();
        assert_eq!(call().unwrap(), "a.json");
        assert!(!scope.is_allowed(folder.join("a.json")));
        assert!(!scope.is_allowed(&folder));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn import_refuses_paths_that_are_not_plain_absolute_ones() {
        let (root, folder) = with_folder("import-path");
        fs::write(root.join("a.json"), "{}").unwrap();
        for bad in [
            "a.json".to_string(),
            "".to_string(),
            "a\0.json".to_string(),
            format!("{}/profiles/../a.json", root.display()),
        ] {
            assert!(import_with(&folder, &bad, |_| true).is_err(), "{bad:?}");
        }
        assert_eq!(entries(&folder), Vec::<String>::new());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn import_refuses_a_name_that_fails_the_rule_after_lower_casing() {
        let (root, folder) = with_folder("import-name");
        for bad in [
            "My Lathe.json",
            "x.txt",
            "x",
            "CON.JSON",
            "été.json",
            "-a.json",
            ".json",
        ] {
            let src = root.join(bad);
            if fs::write(&src, "{}").is_err() {
                continue;
            }
            let err = import_with(&folder, src.to_str().unwrap(), |_| true).unwrap_err();
            assert!(err.contains("not a user file name"), "{bad}: {err}");
        }
        assert_eq!(entries(&folder), Vec::<String>::new());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn import_takes_one_json_object_of_at_most_one_mib() {
        let (root, folder) = with_folder("import-json");
        let try_import = |name: &str, bytes: &[u8]| {
            let src = root.join(name);
            fs::write(&src, bytes).unwrap();
            import_with(&folder, src.to_str().unwrap(), |_| true)
        };
        assert!(try_import("arr.json", b"[1]")
            .unwrap_err()
            .contains("not a JSON object"));
        assert!(try_import("txt.json", b"hello")
            .unwrap_err()
            .contains("not valid JSON"));
        assert!(try_import("bom.json", b"\xEF\xBB\xBF{}")
            .unwrap_err()
            .contains("byte order mark"));
        assert!(try_import("latin.json", b"{\"a\":\"\xE9\"}").is_err());
        let big = object_of(MAX_BYTES as usize + 1);
        assert!(try_import("big.json", big.as_bytes())
            .unwrap_err()
            .contains("1 MiB"));
        assert_eq!(entries(&folder), Vec::<String>::new());
        let exact = object_of(MAX_BYTES as usize);
        assert_eq!(
            try_import("exact.json", exact.as_bytes()).unwrap(),
            "exact.json"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn import_refuses_a_folder_a_missing_file_and_a_link() {
        let (root, folder) = with_folder("import-kind");
        fs::create_dir(root.join("dir.json")).unwrap();
        for src in [root.join("dir.json"), root.join("missing.json")] {
            assert!(import_with(&folder, src.to_str().unwrap(), |_| true).is_err());
        }
        let real = root.join("real.json");
        fs::write(&real, "{}").unwrap();
        if make_link(&real, &root.join("link.json")) {
            let err = import_with(&folder, root.join("link.json").to_str().unwrap(), |_| true)
                .unwrap_err();
            assert!(err.contains("link"), "{err}");
        }
        assert_eq!(entries(&folder), Vec::<String>::new());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn import_never_overwrites() {
        let (root, folder) = with_folder("import-keep");
        fs::write(folder.join("a.json"), "{\"old\":1}").unwrap();
        let src = root.join("A.json");
        fs::write(&src, "{\"new\":1}").unwrap();
        let err = import_with(&folder, src.to_str().unwrap(), |_| true);
        // On a case-insensitive file system `A.json` and `a.json` in different folders are
        // different files anyway; the destination is what must survive.
        assert!(err.unwrap_err().contains("already exists"));
        assert_eq!(
            fs::read_to_string(folder.join("a.json")).unwrap(),
            "{\"old\":1}"
        );
        assert_eq!(entries(&folder), ["a.json"]);
        let _ = fs::remove_dir_all(&root);
    }

    // --- delete -----------------------------------------------------------------

    #[test]
    fn delete_removes_one_file_and_refuses_the_rest() {
        let (root, folder) = with_folder("delete");
        fs::write(folder.join("a.json"), "{}").unwrap();
        fs::write(folder.join("b.json"), "{}").unwrap();
        delete_in(&folder, "a.json").unwrap();
        assert_eq!(entries(&folder), ["b.json"]);
        assert!(delete_in(&folder, "a.json")
            .unwrap_err()
            .contains("not found"));
        fs::create_dir(folder.join("dir.json")).unwrap();
        assert!(delete_in(&folder, "dir.json").is_err());
        assert!(folder.join("dir.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_of_a_link_removes_the_link_only() {
        let (root, folder) = with_folder("delete-link");
        let target = root.join("target.json");
        fs::write(&target, "{\"keep\":1}").unwrap();
        if !make_link(&target, &folder.join("out.json")) {
            eprintln!("no symlinks here; skipped");
            return;
        }
        delete_in(&folder, "out.json").unwrap();
        assert_eq!(entries(&folder), Vec::<String>::new());
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"keep\":1}");
        assert!(make_link(
            &root.join("nowhere.json"),
            &folder.join("dang.json")
        ));
        delete_in(&folder, "dang.json").unwrap();
        assert_eq!(entries(&folder), Vec::<String>::new());
        let _ = fs::remove_dir_all(&root);
    }

    // --- grants and the surface -------------------------------------------------

    /// Against the real scope: create and path grant their one file, nothing else.
    #[test]
    fn create_and_path_grant_that_one_file_only() {
        let (root, folder) = with_folder("grants");
        let app = mock_app();
        let scope = app.fs_scope();
        let grant = |p: &Path| crate::state::grant_in(&scope, p);
        let made = create_with(&folder, "a.json", "{}", grant).unwrap();
        fs::write(folder.join("b.json"), "{}").unwrap();
        assert!(scope.is_allowed(&made));
        assert!(!scope.is_allowed(folder.join("b.json")));
        assert!(!scope.is_allowed(&folder));
        assert!(!scope.is_allowed(folder.join("c.json")));
        let opened = path_with(&folder, "b.json", grant).unwrap();
        assert!(scope.is_allowed(&opened));
        assert!(!scope.is_allowed(&folder));
        // Listing, importing and deleting grant nothing.
        fs::write(folder.join("d.json"), "{}").unwrap();
        list_in(&folder).unwrap();
        delete_in(&folder, "d.json").unwrap();
        assert!(!scope.is_allowed(folder.join("d.json")));
        let _ = fs::remove_dir_all(&root);
    }

    /// The webview names a kind and a plain name; the one path that crosses is the import's
    /// `src`. Two grants in the whole module, both from the two commands that answer a path.
    #[test]
    fn the_surface_takes_no_folder_and_grants_in_two_places() {
        let source = crate::source_scan::lf(include_str!("userfiles.rs"));
        let production = &source[..source.find("#[cfg(test)]").unwrap()];
        for command in [
            "pub async fn user_files_list(app: AppHandle, kind: String)",
            "pub async fn user_file_create(\n    app: AppHandle,\n    kind: String,\n    name: String,\n    text: String,\n)",
            "pub async fn user_file_path(app: AppHandle, kind: String, name: String)",
            "pub async fn user_file_import(app: AppHandle, kind: String, src: String)",
            "pub async fn user_file_delete(app: AppHandle, kind: String, name: String)",
        ] {
            assert!(production.contains(command), "missing or changed: {command}");
        }
        assert_eq!(production.matches(concat!("grant", "_in(")).count(), 2);
        assert_eq!(production.matches(concat!("allow", "_file")).count(), 0);
        assert_eq!(
            production.matches(concat!("scope.is", "_allowed(")).count(),
            1
        );
    }

    #[test]
    fn the_caps_are_the_plan_s() {
        assert_eq!(MAX_FILES, 64);
        assert_eq!(MAX_BYTES, 1_048_576);
    }
}

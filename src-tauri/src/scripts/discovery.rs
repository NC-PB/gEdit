//! Script discovery and the id grammar (plan AD-13, §7.6). Owner: **WP4.5**.
//!
//! Roots, in listing order:
//!
//! | Root | Folder | Editable | Note |
//! |---|---|---|---|
//! | `bundled` | `resource_dir()/scripts` | no | hidden when `scripts.showBundled` is false |
//! | `user` | `<config>/scripts` | yes | created at startup by `paths::ensure_dirs` |
//! | `extra<N>` | `scripts.folders[N]` | yes | `N` is the index in the settings list |
//!
//! The rules:
//!
//! - One level of subfolders becomes a group; deeper folders are not walked.
//! - `gedit_nc.py`, and any name starting with `_` or `.`, is skipped — in both files and
//!   folders, which is also what keeps `__pycache__` out of the menu. Those are library
//!   code, not commands.
//! - A script shadows one with the same file name in an **earlier** root, so the user
//!   folder wins over the bundled folder and an extra folder wins over both. The losing
//!   entry stays in the list with `shadowed: true`, so the UI can explain itself instead
//!   of silently dropping a script the user can see on disk.
//! - An id is `root:name.py` or `root:group/name.py`. Every segment must be a plain file
//!   name (no separators, no `.` or `..`, nothing starting with `.`), the file must end
//!   in `.py`, and `canonicalize(file)` must start with `canonicalize(root)` — which is
//!   what stops a symlink from pointing out of the folder.
//! - A missing folder is not an error: the root is reported with `exists: false` and no
//!   scripts. A dev build without the bundled resource, and an extra folder on a network
//!   share that is not mounted today, both have to give a working Scripts menu.
//!
//! The three path commands are the only ones that widen the fs scope, and only for a
//! file the user may edit. `script_source_path` on a `bundled:` id is an error, not a
//! silent copy (plan §3).
//!
//! Everything that decides anything takes plain paths, not an `AppHandle`, so the rules
//! above are tested against scratch folders rather than a mock app.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::meta::{parse_header, Header, ScriptMeta};
use super::settings::ScriptSettings;
use crate::paths;

/// The name of the bundled scripts folder inside `resource_dir()`, and of the user's
/// own folder inside the config directory.
pub const SCRIPTS_DIR_NAME: &str = "scripts";

/// The shared library that ships next to the bundled scripts. It is importable, not
/// runnable, so it is never listed.
pub const LIBRARY_FILE_NAME: &str = "gedit_nc.py";

/// How much of a script is read to find its header. A `# /// gedit` block that has not
/// closed within this is reported as unclosed rather than pulling a 200 MB file into
/// memory during a `scripts_list` that the ribbon is waiting on.
pub const MAX_HEADER_BYTES: u64 = 64 * 1024;

/// The commented starting point `script_new` writes. Kept next to this module so that a
/// change to the header grammar and a change to the template travel together.
const TEMPLATE: &str = include_str!("template.py");

/// The placeholder in [`TEMPLATE`] that takes the new script's name.
const TEMPLATE_NAME: &str = "{{name}}";

/// One script folder, for the settings UI and the "no scripts found" hint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    /// `bundled`, `user` or `extra<N>`.
    pub root: String,
    pub path: String,
    pub exists: bool,
}

/// One discovered script (§7.6 `ScriptEntry`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEntry {
    /// `bundled:x.py`, `user:grp/x.py`, `extra0:x.py`. The only thing the webview sends back.
    pub id: String,
    /// `bundled`, `user` or `extra<N>`.
    pub root: String,
    /// The one subfolder level, if the script sits in one.
    pub group: Option<String>,
    pub file_name: String,
    /// `None` when the file has no header; the script then runs in v1 (panel) mode.
    pub meta: Option<ScriptMeta>,
    /// A header that is present but unusable. English detail text (AD-14).
    pub header_error: Option<String>,
    /// A script with the same file name in a root that comes later and wins.
    pub shadowed: bool,
    /// False for `bundled:`; the UI hides "Edit" and offers "Copy to user folder".
    pub editable: bool,
}

/// What `scripts_list` answers (§7.6 `ScriptList`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptList {
    pub scripts: Vec<ScriptEntry>,
    pub folders: Vec<FolderInfo>,
}

/// One root to look in. Built from the app handle and the settings by [`roots`]; the
/// walk and the id resolution take these, so neither needs an `AppHandle`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootDir {
    /// `bundled`, `user` or `extra<N>`.
    pub name: String,
    pub dir: PathBuf,
    /// Whether the files in it may be opened for editing and granted to the fs scope.
    pub editable: bool,
    /// False for the bundled root when `scripts.showBundled` is off: the folder is still
    /// reported, its scripts are not listed — but an id that names one still resolves,
    /// so a keyboard shortcut kept from before does not break.
    pub listed: bool,
}

/// A script id, resolved against the roots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub root: String,
    pub group: Option<String>,
    pub file_name: String,
    /// The canonical path: symlinks are already followed, and it has been checked to be
    /// a regular file under the canonical root.
    pub path: PathBuf,
    pub editable: bool,
}

impl Resolved {
    /// The script's own folder, which is the cwd of a run.
    pub fn folder(&self) -> &Path {
        self.path.parent().unwrap_or(self.path.as_path())
    }
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

/// The roots for this app, in listing order. `Err` only when the platform reports no
/// config directory at all, which on the desktop means `$HOME` is unset.
pub fn roots(app: &AppHandle) -> Result<Vec<RootDir>, String> {
    roots_with(app, &ScriptSettings::load(app))
}

/// [`roots`] for a caller that has already read the settings, so one command reads
/// `settings.json` once.
pub fn roots_with(app: &AppHandle, settings: &ScriptSettings) -> Result<Vec<RootDir>, String> {
    let dirs = paths::app_dirs(app)?;
    Ok(roots_in(
        bundled_dir(app),
        dirs.user_scripts_dir(),
        &settings.folders,
        settings.show_bundled,
    ))
}

/// `resource_dir()/scripts`. `None` on the rare platform error; the bundled root is then
/// left out entirely rather than reported as an empty path.
pub fn bundled_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join(SCRIPTS_DIR_NAME))
}

/// [`roots`] with the folders passed in, so the ordering and the `extra<N>` numbering
/// can be tested without an app.
pub fn roots_in(
    bundled: Option<PathBuf>,
    user: PathBuf,
    extra: &[PathBuf],
    show_bundled: bool,
) -> Vec<RootDir> {
    let mut roots = Vec::with_capacity(extra.len() + 2);
    if let Some(dir) = bundled {
        roots.push(RootDir {
            name: "bundled".to_string(),
            dir,
            editable: false,
            listed: show_bundled,
        });
    }
    roots.push(RootDir {
        name: "user".to_string(),
        dir: user,
        editable: true,
        listed: true,
    });
    // The index is part of the id, so it is the position in `scripts.folders` and not
    // the position among the folders that happen to exist today.
    roots.extend(extra.iter().enumerate().map(|(index, dir)| RootDir {
        name: format!("extra{index}"),
        dir: dir.clone(),
        editable: true,
        listed: true,
    }));
    roots
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/// Every script in every root, with its header already parsed.
pub fn discover(roots: &[RootDir]) -> ScriptList {
    let mut scripts = Vec::new();
    let mut folders = Vec::with_capacity(roots.len());
    for root in roots {
        folders.push(FolderInfo {
            root: root.name.clone(),
            path: root.dir.to_string_lossy().into_owned(),
            exists: root.dir.is_dir(),
        });
        if root.listed {
            scripts.extend(scan_root(root));
        }
    }
    mark_shadowed(&mut scripts);
    ScriptList { scripts, folders }
}

/// The `.py` files of one root: the folder itself, then one level of subfolders.
fn scan_root(root: &RootDir) -> Vec<ScriptEntry> {
    let mut scripts: Vec<ScriptEntry> = script_files(&root.dir)
        .into_iter()
        .map(|(name, path)| entry(root, None, name, &path))
        .collect();
    for (group, dir) in sub_folders(&root.dir) {
        scripts.extend(
            script_files(&dir)
                .into_iter()
                .map(|(name, path)| entry(root, Some(group.clone()), name, &path)),
        );
    }
    // Ungrouped scripts first (`None` sorts before `Some`), then group by group, and by
    // file name inside each. Case-insensitive, because that is the order the user reads.
    scripts.sort_by_cached_key(|script| {
        (
            script.group.as_deref().map(str::to_lowercase),
            script.file_name.to_lowercase(),
        )
    });
    scripts
}

/// The runnable `.py` files directly inside `dir`, as (file name, path).
fn script_files(dir: &Path) -> Vec<(String, PathBuf)> {
    read_names(dir)
        .into_iter()
        .filter(|(name, path)| {
            name != LIBRARY_FILE_NAME
                && Path::new(name).extension().is_some_and(|ext| ext == "py")
                && path.is_file()
        })
        .collect()
}

/// The group folders directly inside `dir`, as (group name, path).
fn sub_folders(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut folders: Vec<(String, PathBuf)> = read_names(dir)
        .into_iter()
        .filter(|(_, path)| path.is_dir())
        .collect();
    folders.sort_by_cached_key(|(name, _)| name.to_lowercase());
    folders
}

/// The entries of `dir` whose names are usable as an id segment. A folder that cannot
/// be read gives an empty list: a permission problem on one extra folder must not fail
/// the whole listing.
fn read_names(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            // `_` is the "library, not a command" marker from the plan; `.` covers
            // hidden files and, with it, editor swap files and `.DS_Store`.
            if name.starts_with('_') || name.starts_with('.') || !is_safe_segment(&name) {
                return None;
            }
            Some((name, entry.path()))
        })
        .collect()
}

fn entry(root: &RootDir, group: Option<String>, file_name: String, path: &Path) -> ScriptEntry {
    let header = header_of(path);
    ScriptEntry {
        id: match &group {
            Some(group) => format!("{}:{group}/{file_name}", root.name),
            None => format!("{}:{file_name}", root.name),
        },
        root: root.name.clone(),
        group,
        file_name,
        meta: header.meta,
        header_error: header.error,
        shadowed: false,
        editable: root.editable,
    }
}

/// The `# /// gedit` header of one script file.
///
/// Only the first [`MAX_HEADER_BYTES`] are read, and they are decoded lossily: a header
/// is ASCII TOML, so a file that is not valid UTF-8 further down must still be listed
/// rather than hide the whole menu. A file that cannot be read at all is reported as a
/// header error for the same reason — the run will say the same thing, and dropping the
/// script silently would look as if it had been deleted.
///
/// `script_run` reads the header again through this, rather than trusting the webview's
/// last `scripts_list`: the file on disk is what is about to run.
pub fn header_of(path: &Path) -> Header {
    let mut bytes = Vec::new();
    match fs::File::open(path).and_then(|file| file.take(MAX_HEADER_BYTES).read_to_end(&mut bytes))
    {
        Ok(_) => parse_header(&String::from_utf8_lossy(&bytes)),
        Err(err) => Header {
            meta: None,
            error: Some(format!("{err}")),
        },
    }
}

/// Marks every script that a **later root** overrides.
///
/// Shadowing is a rule between roots: the user folder wins over the bundled one, an extra
/// folder over both. Two scripts with the same file name *inside one root* — a
/// `scale_feed.py` beside a `turning/scale_feed.py` — shadow nothing: both ids resolve,
/// both run, and the menu has to show both. Keying the whole flattened list on the file
/// name alone marked the first of them shadowed although nothing shadowed it (G8 M4).
///
/// So the winner per file name is the first entry of the **last root** that holds it, and
/// every entry of that root with that name wins. The roots are visited in listing order,
/// which is why "last" is also "highest priority".
fn mark_shadowed(scripts: &mut [ScriptEntry]) {
    // file name -> the root that wins it.
    let mut winner: HashMap<&str, &str> = HashMap::with_capacity(scripts.len());
    for script in scripts.iter() {
        winner.insert(&script.file_name, &script.root);
    }
    let winner: HashMap<String, String> = winner
        .into_iter()
        .map(|(name, root)| (name.to_string(), root.to_string()))
        .collect();
    for script in scripts.iter_mut() {
        script.shadowed = winner.get(&script.file_name) != Some(&script.root);
    }
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/// Whether `segment` is a plain file or folder name that can appear in an id.
///
/// This is the first of the two checks that keep a script id from naming a file outside
/// its root; the second is the `canonicalize` comparison in [`resolve_id`], which is
/// what catches a symlink. Rejecting `.` and anything starting with it also keeps the
/// bare `..` and hidden files out.
pub fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('.')
        && !segment.ends_with('.')
        && !segment.ends_with(' ')
        && !segment.contains(['/', '\\', ':'])
        && !segment.chars().any(char::is_control)
}

/// `root:name.py` or `root:group/name.py`, checked against the roots.
///
/// The error text never repeats a path the caller did not already have: the webview
/// sends an id and gets an id back.
pub fn resolve_id(roots: &[RootDir], id: &str) -> Result<Resolved, String> {
    let invalid = || format!("Invalid script id: {id}");
    let (root_name, rest) = id.split_once(':').ok_or_else(invalid)?;
    let root = roots
        .iter()
        .find(|root| root.name == root_name)
        .ok_or_else(|| format!("Unknown script folder: {root_name}"))?;

    let mut segments = rest.split('/');
    let (group, file_name) = match (segments.next(), segments.next(), segments.next()) {
        (Some(name), None, None) => (None, name),
        (Some(group), Some(name), None) => (Some(group), name),
        _ => return Err(invalid()),
    };
    let named = |name: &str| {
        is_safe_segment(name) && !name.starts_with('_') && !name.starts_with(char::is_whitespace)
    };
    let is_script = named(file_name)
        && file_name != LIBRARY_FILE_NAME
        && Path::new(file_name)
            .extension()
            .is_some_and(|ext| ext == "py")
        && file_name.len() > ".py".len();
    if !is_script || group.is_some_and(|group| !named(group)) {
        return Err(invalid());
    }

    let mut candidate = root.dir.clone();
    if let Some(group) = group {
        candidate.push(group);
    }
    candidate.push(file_name);

    // Both sides are canonicalized, so a symlink inside the root that points out of it
    // is refused, and so is a root reached through a link of its own.
    let root_dir = fs::canonicalize(&root.dir)
        .map_err(|_| format!("Script folder is not available: {root_name}"))?;
    let path = fs::canonicalize(&candidate).map_err(|_| format!("Script not found: {id}"))?;
    if !path.starts_with(&root_dir) || !path.is_file() {
        return Err(format!("Script not found: {id}"));
    }

    Ok(Resolved {
        root: root.name.clone(),
        group: group.map(str::to_string),
        file_name: file_name.to_string(),
        path,
        editable: root.editable,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Every script in every root, with its header already parsed.
///
/// `async` so the `read_dir` walk and the header reads stay off the main thread.
#[tauri::command(async)]
pub fn scripts_list(app: AppHandle) -> Result<ScriptList, String> {
    Ok(discover(&roots(&app)?))
}

/// Creates `<config>/scripts/<name>.py` from the commented template, grants that one
/// file to the fs scope and returns its path, so the webview can open it as a document.
#[tauri::command]
pub fn script_new(app: AppHandle, name: String) -> Result<String, String> {
    let path = create_script(&paths::app_dirs(&app)?.user_scripts_dir(), &name)?;
    Ok(grant(&app, &path))
}

/// Copies a script into the user folder (where it shadows the original), grants the copy
/// and returns its path.
#[tauri::command]
pub fn script_copy_to_user(app: AppHandle, script_id: String) -> Result<String, String> {
    let dir = paths::app_dirs(&app)?.user_scripts_dir();
    let source = resolve_id(&roots(&app)?, &script_id)?;
    let path = copy_into(&dir, &source, &script_id)?;
    Ok(grant(&app, &path))
}

/// The file behind an id, granted so it can be opened for editing.
/// A `bundled:` id is refused: bundled scripts are read-only (plan §3).
#[tauri::command]
pub fn script_source_path(app: AppHandle, script_id: String) -> Result<String, String> {
    let script = resolve_id(&roots(&app)?, &script_id)?;
    Ok(grant(&app, editable_source(&script, &script_id)?))
}

// ---------------------------------------------------------------------------
// The command bodies, split from the commands so that the rules can be tested
// against a scratch folder instead of an app handle.
// ---------------------------------------------------------------------------

/// The body of [`script_new`].
pub fn create_script(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let (file_name, title) = new_script_name(name)?;
    fs::create_dir_all(dir).map_err(|err| format!("{}: {err}", dir.display()))?;
    let path = dir.join(&file_name);
    // `create_new`, not `write`: overwriting the script the user is already editing is
    // not something a "New script" button should ever do.
    write_new_file(&path, template_for(&title).as_bytes())
        .map_err(|err| format!("{file_name}: {err}"))?;
    Ok(path)
}

/// The body of [`script_copy_to_user`].
pub fn copy_into(dir: &Path, source: &Resolved, script_id: &str) -> Result<PathBuf, String> {
    if source.root == "user" {
        return Err(format!("{script_id} is already in the user scripts folder"));
    }
    fs::create_dir_all(dir).map_err(|err| format!("{}: {err}", dir.display()))?;
    // The group is dropped on purpose: the copy has to sit directly in the user folder
    // to shadow the original, which is matched by file name.
    let path = dir.join(&source.file_name);
    let bytes = fs::read(&source.path).map_err(|err| format!("{script_id}: {err}"))?;
    write_new_file(&path, &bytes).map_err(|err| format!("{}: {err}", source.file_name))?;
    // A bundled resource can be installed read-only, and `fs::copy` would carry that
    // over; the whole point of the copy is that it can be edited.
    make_writable(&path);
    Ok(path)
}

/// The body of [`script_source_path`]: the file, or why it must not be handed out.
pub fn editable_source<'a>(script: &'a Resolved, script_id: &str) -> Result<&'a Path, String> {
    if !script.editable {
        return Err(format!(
            "{script_id} is a bundled script and cannot be edited; copy it to the user folder first"
        ));
    }
    Ok(&script.path)
}

/// Grants one file to the fs scope and hands its path back as text.
fn grant(app: &AppHandle, path: &Path) -> String {
    crate::state::grant_file(app, path);
    path.to_string_lossy().into_owned()
}

/// The file name and the header `name` for a new script. The input is what the user
/// typed in the "New script" prompt, with or without the `.py`.
fn new_script_name(name: &str) -> Result<(String, String), String> {
    let title = name.trim();
    let stem = title.strip_suffix(".py").unwrap_or(title).trim_end();
    let file_name = format!("{stem}.py");
    // The new file has to be discoverable and addressable by the same rules as any
    // other script, so it is checked against the id grammar rather than a looser one.
    if stem.is_empty()
        || stem.starts_with('_')
        || stem.ends_with('.')
        || !is_safe_segment(&file_name)
        || file_name == LIBRARY_FILE_NAME
    {
        return Err(format!("Invalid script name: {name}"));
    }
    Ok((file_name, stem.to_string()))
}

/// The template with the new script's name in its header.
fn template_for(title: &str) -> String {
    // TOML basic strings take `\` and `"` escapes; a name is one line of display text,
    // so those two are the whole of it.
    let escaped = title.replace('\\', "\\\\").replace('"', "\\\"");
    TEMPLATE.replace(TEMPLATE_NAME, &escaped)
}

/// Writes a file that must not exist yet.
fn write_new_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?
        .write_all(bytes)
}

/// Clears the read-only bit, so a copy of a read-only bundled script can be edited.
fn make_writable(path: &Path) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    let mut permissions = metadata.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // rw for the owner, r for everyone else — the same as a file the editor saves.
        permissions.set_mode(0o644);
    }
    #[cfg(not(unix))]
    {
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
    }
    let _ = fs::set_permissions(path, permissions);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway folder tree. Every name here is a relative path; one ending in `/`
    /// is a folder, anything else is a file with the given contents.
    fn scratch(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("gedit-scripts-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        for (path, contents) in files {
            let full = root.join(path);
            if let Some(parent) = full.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            if path.ends_with('/') {
                fs::create_dir_all(&full).unwrap();
            } else {
                fs::write(&full, contents).unwrap();
            }
        }
        root
    }

    fn header(name: &str) -> String {
        format!("# /// gedit\n# name = \"{name}\"\n# ///\n")
    }

    fn root(name: &str, dir: &Path, editable: bool) -> RootDir {
        RootDir {
            name: name.to_string(),
            dir: dir.to_path_buf(),
            editable,
            listed: true,
        }
    }

    fn ids(list: &ScriptList) -> Vec<&str> {
        list.scripts.iter().map(|s| s.id.as_str()).collect()
    }

    fn set_read_only(path: &Path) {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).unwrap();
    }

    fn is_writable(path: &Path) -> bool {
        !fs::metadata(path).unwrap().permissions().readonly()
    }

    #[test]
    fn lists_one_level_of_subfolders_as_groups_and_skips_library_files() {
        let dir = scratch(
            "groups",
            &[
                ("b.py", &header("B")),
                ("a.py", &header("A")),
                ("gedit_nc.py", "# library"),
                ("_private.py", "# helper"),
                (".hidden.py", "# hidden"),
                ("notes.txt", "not a script"),
                ("turning/lathe.py", &header("Lathe")),
                ("turning/_helper.py", "# helper"),
                ("__pycache__/a.cpython-312.pyc", "compiled"),
                ("milling/deep/too_deep.py", &header("Deep")),
                ("empty/", ""),
            ],
        );
        let list = discover(&[root("user", &dir, true)]);
        assert_eq!(
            ids(&list),
            ["user:a.py", "user:b.py", "user:turning/lathe.py"]
        );
        assert_eq!(list.scripts[2].group.as_deref(), Some("turning"));
        assert_eq!(list.scripts[0].meta.as_ref().unwrap().name, "A");
        assert!(list.scripts.iter().all(|s| s.editable && !s.shadowed));
        assert_eq!(list.folders.len(), 1);
        assert!(list.folders[0].exists);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_later_root_shadows_the_same_file_name_in_an_earlier_one() {
        let bundled = scratch(
            "shadow-bundled",
            &[
                ("scale_feed.py", &header("Bundled")),
                ("only.py", &header("Only")),
            ],
        );
        let user = scratch("shadow-user", &[("scale_feed.py", &header("Mine"))]);
        let extra = scratch("shadow-extra", &[("only.py", &header("Override"))]);
        let list = discover(&[
            root("bundled", &bundled, false),
            root("user", &user, true),
            root("extra0", &extra, true),
        ]);
        let shadowed: Vec<(&str, bool)> = list
            .scripts
            .iter()
            .map(|s| (s.id.as_str(), s.shadowed))
            .collect();
        assert_eq!(
            shadowed,
            [
                ("bundled:only.py", true),
                ("bundled:scale_feed.py", true),
                ("user:scale_feed.py", false),
                ("extra0:only.py", false),
            ]
        );
        for dir in [bundled, user, extra] {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// Two scripts of the same name in one root shadow nothing: both ids resolve and
    /// both run.
    ///
    /// G8 M4: `mark_shadowed` keyed the whole flattened list on the file name, so
    /// `user:scale_feed.py` came back `shadowed: true` because of
    /// `user:turning/scale_feed.py` further down the same root — and the M5 menu would
    /// have hidden or annotated a script that is perfectly live.
    #[test]
    fn two_scripts_of_the_same_name_in_one_root_do_not_shadow_each_other() {
        let user = scratch(
            "shadow-same-root",
            &[
                ("scale_feed.py", &header("Mine")),
                ("turning/scale_feed.py", &header("Turning")),
                ("a.py", &header("A")),
                ("sub/a.py", &header("Sub A")),
            ],
        );
        let list = discover(&[root("user", &user, true)]);
        let shadowed: Vec<(&str, bool)> = list
            .scripts
            .iter()
            .map(|s| (s.id.as_str(), s.shadowed))
            .collect();
        assert_eq!(
            shadowed,
            [
                ("user:a.py", false),
                ("user:scale_feed.py", false),
                ("user:sub/a.py", false),
                ("user:turning/scale_feed.py", false),
            ]
        );
        // And both really do resolve, which is what makes the flag wrong and not merely
        // pessimistic.
        for id in ["user:scale_feed.py", "user:turning/scale_feed.py"] {
            assert!(resolve_id(&[root("user", &user, true)], id).is_ok(), "{id}");
        }
        let _ = fs::remove_dir_all(&user);
    }

    /// The cross-root rule still holds when the winning root has the name twice.
    #[test]
    fn a_later_root_wins_with_every_entry_of_that_name_it_holds() {
        let bundled = scratch(
            "shadow-multi-bundled",
            &[("scale_feed.py", &header("Bundled"))],
        );
        let user = scratch(
            "shadow-multi-user",
            &[
                ("scale_feed.py", &header("Mine")),
                ("turning/scale_feed.py", &header("Turning")),
            ],
        );
        let list = discover(&[root("bundled", &bundled, false), root("user", &user, true)]);
        let shadowed: Vec<(&str, bool)> = list
            .scripts
            .iter()
            .map(|s| (s.id.as_str(), s.shadowed))
            .collect();
        assert_eq!(
            shadowed,
            [
                ("bundled:scale_feed.py", true),
                ("user:scale_feed.py", false),
                ("user:turning/scale_feed.py", false),
            ]
        );
        for dir in [bundled, user] {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// A dev build has no bundled resource, and an extra folder can be on a share that
    /// is not mounted. Both have to give a working list.
    #[test]
    fn a_missing_folder_is_reported_not_an_error() {
        let user = scratch("missing-user", &[("a.py", &header("A"))]);
        let gone = user.join("not-there");
        let list = discover(&[root("bundled", &gone, false), root("user", &user, true)]);
        assert_eq!(ids(&list), ["user:a.py"]);
        assert_eq!(list.folders.len(), 2);
        assert!(!list.folders[0].exists);
        assert!(list.folders[1].exists);
        let _ = fs::remove_dir_all(&user);
    }

    #[test]
    fn show_bundled_hides_the_scripts_but_keeps_the_folder() {
        let bundled = scratch("hide", &[("a.py", &header("A"))]);
        let user = scratch("hide-user", &[]);
        let mut roots = vec![root("bundled", &bundled, false), root("user", &user, true)];
        roots[0].listed = false;
        let list = discover(&roots);
        assert!(list.scripts.is_empty());
        assert_eq!(list.folders[0].root, "bundled");
        assert!(list.folders[0].exists);
        for dir in [bundled, user] {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn a_file_with_a_broken_header_is_still_listed() {
        let dir = scratch(
            "broken",
            &[
                ("bad.py", "# /// gedit\n# name = \n# ///\n"),
                ("plain.py", "print(1)\n"),
            ],
        );
        let list = discover(&[root("user", &dir, true)]);
        assert_eq!(ids(&list), ["user:bad.py", "user:plain.py"]);
        assert!(list.scripts[0].header_error.is_some());
        assert!(list.scripts[0].meta.is_none());
        // No header at all is not an error; the script runs in panel mode.
        assert!(list.scripts[1].header_error.is_none());
        assert!(list.scripts[1].meta.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extra_folders_are_numbered_by_their_place_in_the_settings_list() {
        let roots = roots_in(
            Some(PathBuf::from("/res/scripts")),
            PathBuf::from("/cfg/scripts"),
            &[PathBuf::from("/a"), PathBuf::from("/b")],
            true,
        );
        let names: Vec<&str> = roots.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["bundled", "user", "extra0", "extra1"]);
        assert_eq!(
            roots.iter().map(|r| r.editable).collect::<Vec<_>>(),
            [false, true, true, true]
        );
        // Without a resource directory the bundled root is left out, and `user` keeps
        // its name so ids stay stable.
        let roots = roots_in(None, PathBuf::from("/cfg/scripts"), &[], true);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].name, "user");
    }

    #[test]
    fn resolves_a_plain_id_and_a_group_id() {
        let dir = scratch(
            "resolve",
            &[("a.py", "print(1)"), ("turning/b.py", "print(2)")],
        );
        let roots = [root("user", &dir, true)];
        let a = resolve_id(&roots, "user:a.py").unwrap();
        assert_eq!(a.file_name, "a.py");
        assert_eq!(a.group, None);
        assert!(a.editable);
        assert_eq!(a.folder(), fs::canonicalize(&dir).unwrap());
        let b = resolve_id(&roots, "user:turning/b.py").unwrap();
        assert_eq!(b.group.as_deref(), Some("turning"));
        assert_eq!(b.folder(), fs::canonicalize(dir.join("turning")).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_traversal_absolute_paths_and_anything_that_is_not_a_script() {
        let dir = scratch(
            "refuse",
            &[
                ("a.py", "print(1)"),
                ("_lib.py", "print(1)"),
                ("gedit_nc.py", "print(1)"),
                ("notes.txt", "x"),
                ("sub/deep/c.py", "print(1)"),
                ("dir.py/", ""),
            ],
        );
        let outside = scratch("refuse-outside", &[("evil.py", "print('pwned')")]);
        let roots = [root("user", &dir, true)];
        for id in [
            "",
            "a.py",
            "user:",
            "user:a.PY",
            "user:.py",
            "user:notes.txt",
            "user:_lib.py",
            "user:gedit_nc.py",
            "user:../refuse-outside/evil.py",
            "user:..",
            "user:.",
            "user:./a.py",
            "user:sub/deep/c.py",
            "user:dir.py",
            "user:missing.py",
            "user:sub/missing.py",
            "bundled:a.py",
            "user:a.py:b.py",
            "user:/etc/passwd",
            "user:sub/../a.py",
            "user: a.py",
        ] {
            assert!(resolve_id(&roots, id).is_err(), "accepted {id:?}");
        }
        // An absolute path is refused whatever the platform's separator is.
        let absolute = format!("user:{}", outside.join("evil.py").display());
        assert!(resolve_id(&roots, &absolute).is_err());
        for dir in [dir, outside] {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// The name check alone cannot see a link; this is what the `canonicalize`
    /// comparison is for.
    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_points_out_of_the_root() {
        let dir = scratch("symlink", &[("a.py", "print(1)")]);
        let outside = scratch("symlink-outside", &[("evil.py", "print('pwned')")]);
        std::os::unix::fs::symlink(outside.join("evil.py"), dir.join("escape.py")).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("elsewhere")).unwrap();
        let roots = [root("user", &dir, true)];
        assert!(resolve_id(&roots, "user:escape.py").is_err());
        assert!(resolve_id(&roots, "user:elsewhere/evil.py").is_err());
        // A link that stays inside the root is fine.
        std::os::unix::fs::symlink(dir.join("a.py"), dir.join("also_a.py")).unwrap();
        assert_eq!(
            resolve_id(&roots, "user:also_a.py").unwrap().path,
            fs::canonicalize(dir.join("a.py")).unwrap()
        );
        for dir in [dir, outside] {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn a_new_script_name_is_checked_like_an_id_segment() {
        assert_eq!(
            new_script_name(" Deburr ").unwrap(),
            ("Deburr.py".to_string(), "Deburr".to_string())
        );
        assert_eq!(
            new_script_name("deburr.py").unwrap(),
            ("deburr.py".to_string(), "deburr".to_string())
        );
        for name in [
            "",
            "  ",
            ".py",
            "../evil",
            "sub/deburr",
            "sub\\deburr",
            "a:b",
            "_lib",
            ".hidden",
            "gedit_nc",
            "trailing.",
        ] {
            assert!(new_script_name(name).is_err(), "accepted {name:?}");
        }
    }

    #[test]
    fn a_new_script_is_the_template_and_nothing_is_ever_overwritten() {
        let dir = scratch("new", &[("taken.py", "print('mine')\n")]);
        let path = create_script(&dir.join("scripts"), "Deburr").unwrap();
        assert_eq!(path, dir.join("scripts").join("Deburr.py"));
        let written = fs::read_to_string(&path).unwrap();
        assert_eq!(
            parse_header(&written).meta.expect("no header").name,
            "Deburr"
        );
        // The folder is created on the way, and a second call never clobbers the file.
        assert!(create_script(&dir.join("scripts"), "Deburr.py").is_err());
        assert!(create_script(&dir, "taken").is_err());
        assert_eq!(
            fs::read_to_string(dir.join("taken.py")).unwrap(),
            "print('mine')\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// The copy has to be editable even when the bundled original was installed
    /// read-only, or "Copy to user folder" produces a file the user cannot change.
    #[test]
    fn copying_to_the_user_folder_makes_an_editable_copy_that_shadows_the_original() {
        let bundled = scratch(
            "copy-bundled",
            &[("turning/scale_feed.py", &header("Bundled"))],
        );
        let user = scratch("copy-user", &[]);
        let original = bundled.join("turning").join("scale_feed.py");
        set_read_only(&original);
        let roots = [root("bundled", &bundled, false), root("user", &user, true)];

        let source = resolve_id(&roots, "bundled:turning/scale_feed.py").unwrap();
        let path = copy_into(&user, &source, "bundled:turning/scale_feed.py").unwrap();
        // The group is dropped, so the copy shadows the original by file name.
        assert_eq!(path, user.join("scale_feed.py"));
        assert_eq!(fs::read_to_string(&path).unwrap(), header("Bundled"));
        assert!(is_writable(&path), "the copy is read-only");
        let list = discover(&roots);
        assert_eq!(
            list.scripts
                .iter()
                .map(|s| (s.id.as_str(), s.shadowed))
                .collect::<Vec<_>>(),
            [
                ("bundled:turning/scale_feed.py", true),
                ("user:scale_feed.py", false)
            ]
        );

        // A second copy would silently throw the user's edits away.
        assert!(copy_into(&user, &source, "bundled:turning/scale_feed.py").is_err());
        // And a script that is already in the user folder has nowhere to go.
        let mine = resolve_id(&roots, "user:scale_feed.py").unwrap();
        assert!(copy_into(&user, &mine, "user:scale_feed.py").is_err());

        // Removing a read-only file fails on Windows.
        make_writable(&original);
        for dir in [bundled, user] {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// Plan §3: a bundled script is never granted to the webview.
    #[test]
    fn only_an_editable_script_hands_its_path_out() {
        let bundled = scratch("grant-bundled", &[("a.py", &header("A"))]);
        let user = scratch("grant-user", &[("b.py", &header("B"))]);
        let roots = [root("bundled", &bundled, false), root("user", &user, true)];
        let script = resolve_id(&roots, "bundled:a.py").unwrap();
        let refused = editable_source(&script, "bundled:a.py").unwrap_err();
        assert!(refused.contains("bundled"), "{refused}");
        let script = resolve_id(&roots, "user:b.py").unwrap();
        assert_eq!(
            editable_source(&script, "user:b.py").unwrap(),
            fs::canonicalize(user.join("b.py")).unwrap()
        );
        for dir in [bundled, user] {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn the_template_carries_the_name_and_parses_as_a_header() {
        let source = template_for("Deburr \"O\\D\"");
        let header = parse_header(&source);
        assert_eq!(header.error, None);
        let meta = header.meta.expect("the template has no header");
        assert_eq!(meta.name, "Deburr \"O\\D\"");
        assert_eq!(meta.warnings, Vec::<String>::new());
        assert!(!source.contains(TEMPLATE_NAME));
    }
}

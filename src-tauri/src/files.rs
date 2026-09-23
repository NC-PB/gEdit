//! `files_stat`: one batched stat call for the webview (plan §7.6, AD-10).
//!
//! The webview polls this while the window has focus to notice files that changed
//! on disk, to skip a save that would write identical bytes, and to tell dropped
//! folders from dropped files. It exists so that the app needs **no** `fs:allow-stat`
//! capability: a path is answered only when the fs scope already allows it, which
//! happens when the user picked or dropped it. A path outside the scope comes back
//! as `allowed: false` with everything else empty, so the webview cannot use this
//! command to probe the file system.

use std::fs::Metadata;
use std::path::Path;
use std::time::UNIX_EPOCH;

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

/// One entry of the `files_stat` answer. Serialized in camelCase, matching
/// `FileStat` in `src/lib/platform/commands.ts`.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    /// The path exactly as it was passed in, so the caller can match answers to
    /// requests without normalizing anything.
    pub path: String,
    /// Whether the fs scope allows this path. When false, every other field is
    /// empty regardless of what is on disk.
    pub allowed: bool,
    pub exists: bool,
    pub is_dir: bool,
    /// Modification time in milliseconds since the epoch, or `None` when the
    /// platform does not report one. Fractional milliseconds are kept: an editor
    /// save and a CAM post can land in the same millisecond.
    pub mtime_ms: Option<f64>,
    /// The size in bytes of a regular file; `None` for a directory.
    pub size: Option<u64>,
    /// **Whether this user may not write the file**, which is the question AD-23
    /// asks and not the one `Permissions::readonly()` answers. See [`not_writable`].
    pub readonly: bool,
}

/// Whether the file at `path` is one the process may not write.
///
/// On Windows this is the `FILE_ATTRIBUTE_READONLY` flag, which is exactly right:
/// `std`'s `Permissions::readonly()` reads that attribute.
///
/// On macOS and Linux it is **not**. There `readonly()` is `mode & 0o222 == 0`, which
/// asks "may *nobody* write this file" — so a program owned by another operator, or by
/// root, or exported read-only by an NFS or SMB server, sits at mode 0644 and answers
/// `false`. That is the commonest read-only case on a shop share, and it was the one
/// AD-23 did not catch: the file opened unlocked with no padlock and no notice, typing
/// was allowed, Save did not go to Save As, and the user found out when the write
/// failed after a shift's editing (G8 M7). No file was damaged — `open(O_TRUNC)` is
/// refused before it truncates — but "protects archive copies" was not true.
///
/// So on Unix the question is asked of the operating system, with the *effective* ids
/// (`AT_EACCESS`) because that is who the write will be attempted as. Directories keep
/// the attribute answer: `readonly` is consumed per file, and a directory nobody may
/// write is not a locked document.
#[cfg(unix)]
fn not_writable(path: &str, meta: &Metadata) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    if meta.is_dir() {
        return meta.permissions().readonly();
    }
    let Ok(c_path) = CString::new(std::ffi::OsStr::new(path).as_bytes()) else {
        // A path with an interior NUL cannot be a file we opened; fall back rather
        // than claim anything about it.
        return meta.permissions().readonly();
    };
    // SAFETY: `c_path` is a valid NUL-terminated C string for the length of the call,
    // and `faccessat` only reads it.
    let answer = unsafe {
        libc::faccessat(
            libc::AT_FDCWD,
            c_path.as_ptr(),
            libc::W_OK,
            libc::AT_EACCESS,
        )
    };
    answer != 0
}

#[cfg(not(unix))]
fn not_writable(_path: &str, meta: &Metadata) -> bool {
    meta.permissions().readonly()
}

/// Stats every path in one round trip. The answer has one entry per input, in the
/// same order, so the caller can zip it with its own list.
#[tauri::command]
pub fn files_stat(app: AppHandle, paths: Vec<String>) -> Vec<FileStat> {
    let scope = app.fs_scope();
    stat_all(paths, |path| scope.is_allowed(path))
}

/// The command's body with the scope predicate injected, so the rules can be
/// tested without an app handle.
pub fn stat_all(paths: Vec<String>, is_allowed: impl Fn(&Path) -> bool) -> Vec<FileStat> {
    paths
        .into_iter()
        .map(|path| {
            if !is_allowed(Path::new(&path)) {
                return FileStat {
                    path,
                    ..FileStat::default()
                };
            }
            // Symlinks are followed: the document's identity is the file the user
            // opened through the link, and that is what a save rewrites.
            match std::fs::metadata(&path) {
                Ok(meta) => of_metadata(path, &meta),
                // Missing, or unreadable because a parent directory lost its
                // permissions; either way there is nothing to report.
                Err(_) => FileStat {
                    path,
                    allowed: true,
                    ..FileStat::default()
                },
            }
        })
        .collect()
}

fn of_metadata(path: String, meta: &Metadata) -> FileStat {
    let is_dir = meta.is_dir();
    let readonly = not_writable(&path, meta);
    FileStat {
        path,
        allowed: true,
        exists: true,
        is_dir,
        mtime_ms: mtime_ms(meta),
        size: (!is_dir).then_some(meta.len()),
        readonly,
    }
}

/// `SystemTime` as epoch milliseconds. A modification time before 1970 is
/// negative rather than clamped, so a comparison with the stored stamp still sees
/// a change.
fn mtime_ms(meta: &Metadata) -> Option<f64> {
    let modified = meta.modified().ok()?;
    Some(match modified.duration_since(UNIX_EPOCH) {
        Ok(since) => since.as_secs_f64() * 1000.0,
        Err(before) => -(before.duration().as_secs_f64() * 1000.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gedit-stat-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.nc"), "G0 X0\n").unwrap();
        fs::write(dir.join("secret.nc"), "G0 X1\n").unwrap();
        dir
    }

    fn s(path: &Path) -> String {
        path.to_str().unwrap().to_owned()
    }

    /// Everything under the scratch directory is allowed except `secret.nc`.
    fn allow_except_secret(path: &Path) -> bool {
        path.file_name().is_none_or(|name| name != "secret.nc")
    }

    /// The single answer for one path.
    fn one(path: String) -> FileStat {
        let mut stats = stat_all(vec![path], allow_except_secret);
        assert_eq!(stats.len(), 1);
        stats.remove(0)
    }

    #[test]
    fn answers_one_entry_per_path_in_order() {
        let dir = scratch_dir("order");
        let paths = vec![s(&dir.join("a.nc")), s(&dir.join("gone.nc")), s(&dir)];
        let stats = stat_all(paths.clone(), allow_except_secret);
        assert_eq!(
            stats.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
            paths
        );
        assert_eq!(stat_all(vec![], allow_except_secret), vec![]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_an_allowed_file() {
        let dir = scratch_dir("file");
        let stat = one(s(&dir.join("a.nc")));
        assert!(stat.allowed && stat.exists && !stat.is_dir && !stat.readonly);
        assert_eq!(stat.size, Some(6));
        // Within an hour of now, so the clock source is plausible.
        let now_ms = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            * 1000.0;
        let mtime = stat.mtime_ms.expect("no mtime");
        assert!(
            (now_ms - mtime).abs() < 3_600_000.0,
            "mtime {mtime} vs now {now_ms}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// A forbidden path must not leak whether it exists.
    #[test]
    fn a_forbidden_path_is_answered_empty() {
        let dir = scratch_dir("forbidden");
        let path = s(&dir.join("secret.nc"));
        let stat = one(path.clone());
        assert_eq!(
            stat,
            FileStat {
                path,
                ..FileStat::default()
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_path_is_allowed_but_absent() {
        let dir = scratch_dir("missing");
        let path = s(&dir.join("gone.nc"));
        let stat = one(path.clone());
        assert_eq!(
            stat,
            FileStat {
                path,
                allowed: true,
                ..FileStat::default()
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_reports_no_size() {
        let dir = scratch_dir("dir");
        let stat = one(s(&dir.join("sub")));
        assert!(stat.allowed && stat.exists && stat.is_dir);
        assert_eq!(stat.size, None);
        assert!(stat.mtime_ms.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_file_is_flagged() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch_dir("readonly");
        let file = dir.join("a.nc");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o444)).unwrap();
        let stat = one(s(&file));
        assert!(stat.readonly, "{stat:?}");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        let stat = one(s(&file));
        assert!(!stat.readonly, "{stat:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// G8 M7. `Permissions::readonly()` asks "may **nobody** write this file", not
    /// "may **I**". On a shop share the commonest read-only program is one at mode
    /// 0644 owned by another operator, by root, or exported read-only by the server —
    /// and every one of those answered `false`, so AD-23 opened it unlocked, let the
    /// user type into it all shift, and found out at the write.
    ///
    /// A file owned by a second uid cannot be made here, but the discrepancy does not
    /// need one: a file **this user owns** at mode 0424 is writable by its group and
    /// not by its owner, and on Unix the owner's bits are the ones that apply to the
    /// owner. So `permissions().readonly()` says `false` ("somebody may write it")
    /// while the process may not write a byte of it — the same disagreement, the same
    /// direction, reproducible. Root bypasses the check, so the case is skipped there.
    #[cfg(unix)]
    #[test]
    fn readonly_answers_whether_this_user_may_write_it() {
        use std::os::unix::fs::PermissionsExt;
        // SAFETY: `geteuid` takes nothing, touches nothing and cannot fail.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let dir = scratch_dir("writable");
        let file = dir.join("a.nc");

        // Writable by its owner, which is us.
        assert!(!one(s(&file)).readonly);

        // Writable by the group and not by the owner. `readonly()` answers false here.
        fs::set_permissions(&file, fs::Permissions::from_mode(0o424)).unwrap();
        let meta = fs::metadata(&file).unwrap();
        assert!(
            !meta.permissions().readonly(),
            "the case this test exists for is not set up"
        );
        assert!(
            fs::OpenOptions::new().write(true).open(&file).is_err(),
            "the file really has to be one we cannot write"
        );
        assert!(
            one(s(&file)).readonly,
            "a file we may not write reads as writable"
        );

        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        // A directory keeps the attribute answer: `readonly` is about documents.
        assert!(!one(s(&dir.join("sub"))).readonly);
        let _ = fs::remove_dir_all(&dir);
    }
}

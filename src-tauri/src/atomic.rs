//! Crash-safe writes for the app's own small JSON files (plan AD-8).
//!
//! Documents are written in place, because that keeps file identity and ACLs on
//! network shares. `settings.json` and `state.json` are the opposite case: they
//! are small, rewritten often and worthless when truncated, so they are written
//! to a temp file in the *same* folder, fsynced, and renamed over the target.
//! Rename within a folder is atomic on every platform gEdit supports, so a
//! reader sees either the old file or the new one and never a half-written one.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Makes the temp file name unique within the process; the process id makes it
/// unique between processes. Two gEdit windows, or a save racing the harness,
/// therefore never write to the same temp file.
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// The prefix every temp file gets, so a leftover from a killed process is
/// recognizable (and hidden on Unix).
const TEMP_PREFIX: char = '.';

/// Writes `bytes` over `path`: temp file in the same folder, fsync, rename.
/// The temp file is removed when any step fails, so a failed write leaves the
/// previous file intact and no leftovers behind.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{} has no parent directory", path.display()),
            )
        })?;
    // The folder normally exists (`paths::ensure_dirs` ran at startup), but the
    // user can delete it while the app runs and a save must still work.
    fs::create_dir_all(parent)?;

    let temp = temp_path(path, parent);
    match write_then_rename(&temp, path, bytes) {
        Ok(()) => {
            // Best effort: on Unix the rename is only durable once the directory
            // entry is flushed too. A failure here means the data is written but
            // may not survive a power cut, which is not worth failing the save.
            #[cfg(unix)]
            let _ = File::open(parent).and_then(|dir| dir.sync_all());
            Ok(())
        }
        Err(err) => {
            let _ = fs::remove_file(&temp);
            Err(err)
        }
    }
}

fn write_then_rename(temp: &Path, path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(temp)?;
    file.write_all(bytes)?;
    // Before the rename, so that the rename never publishes an empty file.
    file.sync_all()?;
    drop(file);
    fs::rename(temp, path)
}

/// `<parent>/.<name>.tmp-<pid>-<n>`, next to the target so that the rename stays
/// within one file system.
fn temp_path(path: &Path, parent: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let n = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(
        "{TEMP_PREFIX}{name}.tmp-{}-{n}",
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gedit-atomic-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Every leftover temp file of ours in `dir`, so a test can prove there are none.
    fn temp_files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp-"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn creates_the_file_and_leaves_no_temp_file() {
        let dir = scratch("create");
        let file = dir.join("settings.json");
        write_atomic(&file, b"{\"a\":1}").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"{\"a\":1}");
        assert_eq!(temp_files(&dir), Vec::<String>::new());
        let _ = fs::remove_dir_all(&dir);
    }

    /// The replacement is whole: a shorter payload must not leave a tail of the
    /// longer one behind, which is what an in-place write would do.
    #[test]
    fn replaces_the_previous_contents_completely() {
        let dir = scratch("replace");
        let file = dir.join("state.json");
        write_atomic(&file, b"a long previous payload").unwrap();
        write_atomic(&file, b"{}").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"{}");
        assert_eq!(temp_files(&dir), Vec::<String>::new());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_a_missing_parent_folder() {
        let dir = scratch("parent");
        let file = dir.join("deep").join("nested").join("settings.json");
        write_atomic(&file, b"{}").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"{}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The rename step fails (the target is a non-empty directory). The previous
    /// state has to survive untouched, and no temp file may be left behind.
    #[test]
    fn a_failed_rename_leaves_no_partial_file_and_no_temp_file() {
        let dir = scratch("rename-fails");
        let target = dir.join("settings.json");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("inside"), b"keep me").unwrap();

        let err = write_atomic(&target, b"{\"a\":1}").unwrap_err();
        assert!(err.kind() != io::ErrorKind::NotFound, "{err:?}");
        assert!(target.is_dir(), "the target was replaced");
        assert_eq!(fs::read(target.join("inside")).unwrap(), b"keep me");
        assert_eq!(temp_files(&dir), Vec::<String>::new());
        let _ = fs::remove_dir_all(&dir);
    }

    /// The create step fails (the folder is read-only). The previous file has to
    /// survive with its old contents, and no temp file may be left behind.
    #[cfg(unix)]
    #[test]
    fn a_failed_create_keeps_the_previous_file() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("create-fails");
        let file = dir.join("settings.json");
        write_atomic(&file, b"{\"old\":true}").unwrap();

        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        // root ignores the mode bits, so only assert when the folder really is closed.
        let closed = fs::write(dir.join("probe"), b"").is_err();
        if closed {
            let err = write_atomic(&file, b"{\"new\":true}").unwrap_err();
            assert_eq!(err.kind(), io::ErrorKind::PermissionDenied, "{err:?}");
            assert_eq!(fs::read(&file).unwrap(), b"{\"old\":true}");
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(temp_files(&dir), Vec::<String>::new());
        } else {
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_a_path_without_a_parent_folder() {
        let err = write_atomic(Path::new("settings.json"), b"{}").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput, "{err:?}");
    }

    /// Two writes of the same file must not pick the same temp name.
    #[test]
    fn temp_names_are_unique() {
        let dir = scratch("unique");
        let file = dir.join("settings.json");
        let first = temp_path(&file, &dir);
        let second = temp_path(&file, &dir);
        assert_ne!(first, second);
        assert_eq!(first.parent(), Some(dir.as_path()));
        let _ = fs::remove_dir_all(&dir);
    }
}

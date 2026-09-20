//! The `GEDIT_CONTEXT` temp folder (plan AD-13). Owner: **WP4.5**.
//!
//! stdin stays plain text, so a v1 habit keeps working; everything else a script needs —
//! the document's metadata, the input range, the cursor, the parameters, the resolved
//! profile and the code database — goes into one JSON file whose path is handed over in
//! the `GEDIT_CONTEXT` environment variable. The webview builds that JSON
//! (`ScriptContextV2`, plan §7.5) and Rust only writes it out.
//!
//! What that file holds is why it gets a folder of its own rather than a name in the
//! shared temp directory: the document's path, its text range and the resolved profile
//! are the user's work, and on a shared machine `/tmp` is world readable. So:
//!
//! - a fresh folder per run, created with mode `0700` on Unix, and the file inside it
//!   with mode `0600`;
//! - the name is unpredictable and the folder is created with `create_dir`, never
//!   `create_dir_all`, so an attacker who guessed the name and put a symlink there loses
//!   the race instead of choosing where the file lands;
//! - the folder is removed when [`ContextDir`] is dropped — on the success path, on an
//!   error, on a timeout and on a cancel.
//!
//! `documents: all-open` (P2) will write one text file per document into the same
//! folder. P1 only ever writes `context.json`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// The file name inside the folder. `GEDIT_CONTEXT` points at it.
pub const CONTEXT_FILE_NAME: &str = "context.json";

/// How many names are tried before giving up. A collision needs two runs to pick the
/// same nanosecond *and* the same counter, so one retry is already generous.
const MAX_ATTEMPTS: u32 = 8;

/// Makes each folder of this process distinct without asking the clock twice.
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// A run's private temp folder. Dropping it removes the folder and everything in it.
#[derive(Debug)]
pub struct ContextDir {
    dir: PathBuf,
}

impl ContextDir {
    /// Creates the folder and writes `context` into it.
    ///
    /// The returned value always owns a folder that exists; dropping it takes the
    /// folder with it.
    pub fn create(context: &serde_json::Value) -> Result<Self, String> {
        let parent = std::env::temp_dir();
        let mut last = String::new();
        for _ in 0..MAX_ATTEMPTS {
            let dir = parent.join(next_name());
            match create_private_dir(&dir) {
                // From here on the folder is owned, so every way out removes it.
                Ok(()) => {
                    let owned = Self { dir };
                    owned.write_context(context)?;
                    return Ok(owned);
                }
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                    last = err.to_string();
                }
                Err(err) => return Err(format!("{}: {err}", parent.display())),
            }
        }
        Err(format!("{}: {last}", parent.display()))
    }

    fn write_context(&self, context: &serde_json::Value) -> Result<(), String> {
        let path = self.context_file();
        let mut file = private_file(&path).map_err(|err| format!("{CONTEXT_FILE_NAME}: {err}"))?;
        serde_json::to_writer(&mut file, context)
            .map_err(|err| format!("{CONTEXT_FILE_NAME}: {err}"))?;
        file.flush()
            .map_err(|err| format!("{CONTEXT_FILE_NAME}: {err}"))
    }

    /// The folder itself; `documents: all-open` writes the per-document text files here.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// What `GEDIT_CONTEXT` is set to.
    pub fn context_file(&self) -> PathBuf {
        self.dir.join(CONTEXT_FILE_NAME)
    }
}

impl Drop for ContextDir {
    /// Best effort: a folder that cannot be removed (a file still open on Windows) must
    /// not fail the run that produced a perfectly good result.
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// A name no other run will pick: the process, a counter and the clock.
fn next_name() -> String {
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.subsec_nanos())
        .unwrap_or_default();
    format!("gedit-run-{}-{sequence}-{nanos}", std::process::id())
}

/// Creates one directory, owner-only on Unix, and fails when it already exists.
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        // Set at creation, not afterwards: a `chmod` after the fact leaves a window in
        // which the folder is world readable.
        builder.mode(0o700);
    }
    builder.create(dir)
}

/// Creates one file, owner-only on Unix, and fails when it already exists.
fn private_file(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_the_context_and_removes_the_folder_when_dropped() {
        let context = json!({ "contract": 2, "params": { "percent": 90 } });
        let dir;
        {
            let owned = ContextDir::create(&context).unwrap();
            dir = owned.dir().to_path_buf();
            assert!(dir.is_dir());
            assert_eq!(owned.context_file(), dir.join(CONTEXT_FILE_NAME));
            let written: serde_json::Value =
                serde_json::from_slice(&fs::read(owned.context_file()).unwrap()).unwrap();
            assert_eq!(written, context);
        }
        assert!(!dir.exists(), "{} survived the drop", dir.display());
    }

    /// The file carries the document's path and text, so it must not be readable by
    /// another user on a shared machine.
    #[cfg(unix)]
    #[test]
    fn the_folder_and_the_file_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let owned = ContextDir::create(&json!({})).unwrap();
        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(owned.dir()), 0o700);
        assert_eq!(mode(&owned.context_file()), 0o600);
    }

    #[test]
    fn every_run_gets_its_own_folder() {
        let first = ContextDir::create(&json!({ "n": 1 })).unwrap();
        let second = ContextDir::create(&json!({ "n": 2 })).unwrap();
        assert_ne!(first.dir(), second.dir());
        // Dropping one must not take the other's folder with it.
        let kept = second.dir().to_path_buf();
        drop(first);
        assert!(kept.is_dir());
    }

    /// A folder that was already removed (a `tmpwatch`, a test that cleaned up) must
    /// not panic the drop.
    #[test]
    fn dropping_a_folder_that_is_already_gone_is_harmless() {
        let owned = ContextDir::create(&json!({})).unwrap();
        fs::remove_dir_all(owned.dir()).unwrap();
        drop(owned);
    }
}

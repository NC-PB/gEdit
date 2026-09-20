//! Finding the Python interpreter that runs user scripts.
//!
//! An app started from Finder or the Dock only gets launchd's minimal PATH, so a
//! bare `python3` would be the Xcode stub rather than the user's own install. The
//! platform module below does the lookup; [`interpreter`] caches its answer.

use std::path::PathBuf;
use std::sync::OnceLock;

use imp::{is_fallback, resolve};

/// The Python interpreter for scripts, resolved on first use. Only a real
/// install is cached (not a fallback), so installing Python later works
/// without a restart.
pub fn interpreter() -> PathBuf {
    static PYTHON: OnceLock<PathBuf> = OnceLock::new();
    // GEDIT_PYTHON (e.g. /path/to/venv/bin/python) skips the lookup.
    if let Some(path) = std::env::var_os("GEDIT_PYTHON").filter(|p| !p.is_empty()) {
        return PathBuf::from(path);
    }
    if let Some(path) = PYTHON.get() {
        return path.clone();
    }
    match resolve() {
        Some(path) if !is_fallback(&path) => PYTHON.get_or_init(|| path).clone(),
        Some(path) => path,
        None => PathBuf::from("python3"),
    }
}

/// Windows installs usually expose `python` on PATH.
#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};

    pub fn resolve() -> Option<PathBuf> {
        Some("python".into())
    }

    pub fn is_fallback(_path: &Path) -> bool {
        false
    }
}

/// Finds `python3` the way the user's terminal would. An app started from
/// Finder or the Dock only gets launchd's minimal PATH, where a bare `python3`
/// is the Xcode stub rather than the Homebrew or python.org install.
#[cfg(unix)]
mod imp {
    use std::io::Read;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::time::{Duration, Instant};

    /// A slow or hanging shell profile must not stall the first script run.
    const SHELL_TIMEOUT: Duration = Duration::from_secs(3);
    /// Only the tail of the shell's output is kept; `command -v` prints last.
    const MAX_SHELL_OUTPUT: usize = 64 * 1024;

    /// The macOS system stub; a login shell reports it when the user's own
    /// Python is only put on PATH in an rc file such as `~/.zshrc`.
    #[cfg(target_os = "macos")]
    const SYSTEM_STUB: Option<&str> = Some("/usr/bin/python3");
    #[cfg(not(target_os = "macos"))]
    const SYSTEM_STUB: Option<&str> = None;

    /// Probed in order when the login shell gives no usable answer.
    #[cfg(target_os = "macos")]
    const WELL_KNOWN: &[&str] = &[
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
    ];
    #[cfg(not(target_os = "macos"))]
    const WELL_KNOWN: &[&str] = &["/usr/local/bin/python3", "/usr/bin/python3"];

    #[cfg(target_os = "macos")]
    const DEFAULT_SHELL: &str = "/bin/zsh";
    #[cfg(not(target_os = "macos"))]
    const DEFAULT_SHELL: &str = "/bin/sh";

    /// The user's `python3`: the login shell's answer, then well-known install
    /// locations, then the system stub. None if there is no Python at all.
    pub fn resolve() -> Option<PathBuf> {
        rank(login_shell_python(), is_executable_file)
    }

    /// The system stub is used but not cached: a Python installed later wins.
    pub fn is_fallback(path: &Path) -> bool {
        SYSTEM_STUB.is_some_and(|stub| path == Path::new(stub))
    }

    fn rank(from_shell: Option<PathBuf>, is_executable: impl Fn(&Path) -> bool) -> Option<PathBuf> {
        let stub = SYSTEM_STUB.map(Path::new);
        from_shell
            .filter(|path| Some(path.as_path()) != stub)
            .or_else(|| {
                WELL_KNOWN
                    .iter()
                    .map(Path::new)
                    .chain(stub)
                    .find(|p| is_executable(p))
                    .map(Path::to_path_buf)
            })
    }

    /// Asks `$SHELL -l -c 'command -v python3'`. A login shell reads the
    /// user's profile (and so their PATH); it is not interactive, so rc files
    /// such as `~/.zshrc` are not read.
    fn login_shell_python() -> Option<PathBuf> {
        let shell = std::env::var_os("SHELL")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_SHELL.into());
        let mut child = Command::new(shell)
            // The leading echo keeps the answer on its own line even if the
            // profile prints something without a trailing newline.
            .args(["-l", "-c", "echo; command -v python3"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;

        // Read on another thread so that neither a hanging profile nor a
        // background job holding stdout open can block past the timeout.
        let mut stdout = child.stdout.take()?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n @ 1..) = stdout.read(&mut buf) {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        let deadline = Instant::now() + SHELL_TIMEOUT;
        let mut out = Vec::new();
        let mut exited_at = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(20)) {
                Ok(chunk) => {
                    out.extend(chunk);
                    if out.len() > MAX_SHELL_OUTPUT {
                        out.drain(..out.len() - MAX_SHELL_OUTPUT);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break, // stdout closed
                Err(RecvTimeoutError::Timeout) => {}
            }
            // Checked on every pass, so steady output can't outlast the deadline.
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            // Once the shell has exited, its answer is in the pipe; don't wait
            // for background jobs that inherited stdout.
            if exited_at.is_none() && matches!(child.try_wait(), Ok(Some(_))) {
                exited_at = Some(now);
            }
            if exited_at.is_some_and(|t| now - t > Duration::from_millis(100)) {
                break;
            }
        }

        // Reap the shell; the kill only matters if it is still running.
        let _ = child.kill();
        let _ = child.wait();
        pick_shell_python(&String::from_utf8_lossy(&out), is_executable_file)
    }

    /// Picks the last non-empty line of the shell's stdout that is an absolute
    /// path to an executable `python3`. Other lines are profile noise.
    fn pick_shell_python(stdout: &str, is_executable: impl Fn(&Path) -> bool) -> Option<PathBuf> {
        stdout
            .lines()
            .rev()
            .map(|line| Path::new(line.trim()))
            .find(|path| {
                path.is_absolute()
                    && path.file_name().is_some_and(|name| name == "python3")
                    && is_executable(path)
            })
            .map(Path::to_path_buf)
    }

    fn is_executable_file(path: &Path) -> bool {
        path.metadata()
            .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::fs;

        /// Stands in for the file system: only these paths are executable.
        fn exists(path: &Path) -> bool {
            [
                "/usr/local/bin/python3",
                "/opt/homebrew/bin/python3",
                "/bin/zsh",
            ]
            .iter()
            .any(|p| path == Path::new(p))
        }

        fn pick(stdout: &str) -> Option<PathBuf> {
            pick_shell_python(stdout, exists)
        }

        #[test]
        fn picks_path_after_profile_noise() {
            let stdout = "Welcome back!\n/bin/zsh\nnvm loaded\n/usr/local/bin/python3\n";
            assert_eq!(pick(stdout), Some(PathBuf::from("/usr/local/bin/python3")));
        }

        #[test]
        fn picks_last_usable_line() {
            let stdout = "/usr/local/bin/python3\n/opt/homebrew/bin/python3\n\nbye\n";
            assert_eq!(
                pick(stdout),
                Some(PathBuf::from("/opt/homebrew/bin/python3"))
            );
        }

        #[test]
        fn tolerates_missing_newline_and_crlf() {
            let expected = Some(PathBuf::from("/usr/local/bin/python3"));
            assert_eq!(pick("/usr/local/bin/python3"), expected);
            assert_eq!(pick("  /usr/local/bin/python3 \r\n\n"), expected);
        }

        #[test]
        fn rejects_unusable_output() {
            for stdout in [
                "",
                "\n\n  \n",
                // Relative path, alias, missing file, and something that
                // is not python3 at all.
                "bin/python3\n",
                "python3\n",
                "alias python3='/usr/local/bin/python3'\n",
                "/missing/bin/python3\n",
                "/bin/zsh\n",
            ] {
                assert_eq!(pick(stdout), None, "accepted {stdout:?}");
            }
        }

        #[test]
        fn prefers_user_python_over_system_stub() {
            let shell = |p: &str| Some(PathBuf::from(p));
            // A real answer from the shell wins.
            assert_eq!(
                rank(shell("/opt/homebrew/bin/python3"), exists),
                shell("/opt/homebrew/bin/python3")
            );
            // Nothing from the shell: first installed well-known location.
            assert_eq!(rank(None, exists), shell(WELL_KNOWN[0]));
            // No Python anywhere.
            assert_eq!(rank(None, |_| false), None);
        }

        #[cfg(target_os = "macos")]
        #[test]
        fn system_stub_is_the_last_resort() {
            let stub = Some(PathBuf::from("/usr/bin/python3"));
            let with_stub = |p: &Path| exists(p) || p == Path::new("/usr/bin/python3");
            assert_eq!(
                rank(stub.clone(), with_stub),
                Some(PathBuf::from("/opt/homebrew/bin/python3"))
            );
            assert_eq!(
                rank(stub.clone(), |p| p == Path::new("/usr/bin/python3")),
                stub
            );
        }

        #[test]
        fn checks_executable_bit() {
            let dir = std::env::temp_dir().join(format!("gedit-py-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(dir.join("dir")).unwrap();
            let file = dir.join("python3");
            fs::write(&file, "").unwrap();

            fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(!is_executable_file(&file));
            fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
            assert!(is_executable_file(&file));
            assert!(!is_executable_file(&dir.join("dir")));
            assert!(!is_executable_file(&dir.join("missing")));
            let _ = fs::remove_dir_all(&dir);
        }

        /// Shows what this machine resolves to. To mimic a Finder launch:
        /// `env -i HOME=$HOME SHELL=$SHELL PATH=/usr/bin:/bin:/usr/sbin:/sbin
        /// ~/.cargo/bin/cargo test -- --ignored --nocapture resolves_on_this_machine`
        #[test]
        #[ignore = "depends on this machine's shell and Python install"]
        fn resolves_on_this_machine() {
            let start = std::time::Instant::now();
            let from_shell = login_shell_python();
            println!(
                "login shell lookup: {from_shell:?} in {:?}",
                start.elapsed()
            );
            println!("PATH: {:?}", std::env::var_os("PATH"));
            println!("resolved: {:?}", resolve());
            assert!(from_shell.is_some());
        }
    }
}

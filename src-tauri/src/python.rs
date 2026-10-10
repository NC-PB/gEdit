//! Finding the Python interpreter that runs user scripts.
//!
//! Both platforms have the same shape of problem — the interpreter a bare name resolves
//! to is not the one the user means — but for opposite reasons:
//!
//! - **macOS**: an app started from Finder or the Dock only gets launchd's minimal PATH,
//!   so a bare `python3` would be the Xcode stub rather than the user's own install.
//! - **Windows**: `python.exe` and `python3.exe` are on the PATH of a clean Windows 10/11
//!   *whether or not Python is installed*, because Windows ships app execution aliases
//!   for them under `%LOCALAPPDATA%\Microsoft\WindowsApps` that only open the Microsoft
//!   Store. A bare name would resolve to one of those.
//!
//! The platform module below does the lookup; [`interpreter`] caches its answer.
//!
//! **The same login shell also tells us the user's `PATH`** ([`login_path`]). A script
//! that calls a tool by name (`git`, `ffmpeg`, a Homebrew binary) needs the directories
//! the user's terminal has, and an app started from Finder does not have them. The shell
//! is asked once, for both, and both answers are cached together and dropped together by
//! [`forget`]. `~/.zshrc` is **not** read (the shell is a login shell, not an interactive
//! one): a Python or a `PATH` that is only set there is not seen, and the user guide says
//! to set `scripts.python` in that case.
//!
//! **Why the cache is a `Mutex` and not a `OnceLock`** (G8 M5). The lookup spawns a child
//! process and waits seconds for it, so the plan's "asked once per app" is a cost, not a
//! nicety. The `OnceLock` version got it wrong twice:
//!
//! - It resolved *outside* the cell, so two callers that both missed the cache both
//!   shelled out. The lock plus the re-check after the wait is what closes that.
//! - It refused to cache the macOS system stub, so on a stock Mac with no Homebrew
//!   and no python.org install — where the stub is the only answer — **every**
//!   `script_run` and `python_check` shelled out again, adding up to 3 s each time on
//!   a machine with a slow `~/.zprofile`. The stub is now cached like any other
//!   answer; what preserves "a Python installed later wins" is [`forget`], which
//!   `python_check` calls, because that probe is exactly the user asking gEdit to
//!   look again.

use std::ffi::OsString;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// What [`interpreter`] answers when the lookup found nothing: a bare name, left for the
/// OS to resolve when a run actually happens.
///
/// The name is not the same on both platforms. `python3` is the Unix convention. On
/// Windows it is `python`, which is the name a python.org install puts on `PATH` ("it
/// will be available from any Command Prompt or PowerShell session by typing `python`" —
/// *Using Python on Windows*), and which on a machine with no Python at all reaches the
/// Microsoft Store alias — whose exit code 9009 `scripts::runner::judge` already reports
/// as "Python was not found". Either way the user is told the truth.
const FALLBACK: &str = if cfg!(windows) { "python" } else { "python3" };

/// What one lookup found out.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Lookup {
    /// The interpreter, or `None` when there is none this lookup will vouch for.
    python: Option<PathBuf>,
    /// The `PATH` the user's login shell has, when it answered with one (Unix only).
    login_path: Option<OsString>,
}

/// The cached answer: the interpreter (with [`FALLBACK`] already applied) and the login
/// shell's `PATH`.
#[derive(Debug, Clone)]
struct Cached {
    python: PathBuf,
    login_path: Option<OsString>,
}

/// The answer to the last lookup, or `None` before the first one and after [`forget`].
static PYTHON: Mutex<Option<Cached>> = Mutex::new(None);

/// The Python interpreter for scripts, resolved on first use and then cached.
pub fn interpreter() -> PathBuf {
    // GEDIT_PYTHON (e.g. /path/to/venv/bin/python) skips the lookup.
    if let Some(path) = std::env::var_os("GEDIT_PYTHON").filter(|p| !p.is_empty()) {
        return PathBuf::from(path);
    }
    cached_or(imp::lookup).python
}

/// The `PATH` of the user's login shell, from the same cached lookup as
/// [`interpreter`], or `None` when there is none (Windows, or a shell that did not say).
///
/// This asks the shell the first time even when the interpreter comes from a setting or
/// `GEDIT_PYTHON`: a script needs the user's tools whichever Python runs it.
pub fn login_path() -> Option<OsString> {
    cached_or(imp::lookup).login_path
}

/// The cache itself, with the lookup injected so a test can count how often it runs.
fn cached_or(lookup: impl FnOnce() -> Lookup) -> Cached {
    // A poisoned lock would mean a panic inside this function; the cached path is still
    // whatever it was, so reading through the poison is safe and better than panicking on
    // every later script run.
    let mut cached = PYTHON.lock().unwrap_or_else(|e| e.into_inner());
    // The lock is held across `lookup()` on purpose: a second caller waits for the first
    // answer instead of spawning a second login shell of its own.
    if let Some(found) = cached.as_ref() {
        return found.clone();
    }
    let found = lookup();
    let found = Cached {
        python: found.python.unwrap_or_else(|| PathBuf::from(FALLBACK)),
        login_path: found.login_path,
    };
    *cached = Some(found.clone());
    found
}

/// Every child process gEdit starts is started through this: the
/// interpreter probes here and a script run in `scripts::runner`. On Windows it applies
/// [`CREATE_NO_WINDOW`], so a release build — which has no console of its own — never
/// flashes one for a child; on macOS and Linux there is no such window and it does
/// nothing. It is unconditional so that every spawn site calls it on every platform, and
/// `spawn_sites_tests` checks that each one does.
pub(crate) fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    suppress_console(command);
    command
}

/// Windows-only: the seam behind [`hidden`].
///
/// `std::process::Command` never hands its creation flags back out, so there is nothing
/// on a real `Command` a test could inspect after the fact. [`SetCreationFlags`] is the
/// seam that works around that: the real `Command` and a test double both implement it,
/// so [`suppress_console`] itself — what [`hidden`] calls — is what gets proved, in
/// `creation_flags_tests` below, rather than some parallel copy of the logic.
#[cfg(windows)]
trait SetCreationFlags {
    fn set_creation_flags(&mut self, flags: u32);
}

#[cfg(windows)]
impl SetCreationFlags for Command {
    fn set_creation_flags(&mut self, flags: u32) {
        use std::os::windows::process::CommandExt;
        self.creation_flags(flags);
    }
}

/// `CREATE_NO_WINDOW`, from `<processthreadsapi.h>`: the child gets no console at all,
/// rather than inheriting gEdit's (a release build has none) or creating its own.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Applies [`CREATE_NO_WINDOW`] to `command`. Piped stdin/stdout/stderr are unaffected —
/// the flag only stops a *new* console from being created; handles that are explicitly
/// redirected, as every spawn here does, are unchanged.
#[cfg(windows)]
fn suppress_console<C: SetCreationFlags>(command: &mut C) {
    command.set_creation_flags(CREATE_NO_WINDOW);
}

#[cfg(all(test, windows))]
mod creation_flags_tests {
    //! Regression test: a release build must never flash a console
    //! for a script run or an interpreter probe. `Command` gives no way to read its flags
    //! back, so this proves [`suppress_console`] against a recording double instead — see
    //! the doc comment on [`SetCreationFlags`] for why that is the real spawn path and not
    //! a parallel copy. `spawn_sites_tests` checks that every spawn goes through it.
    use super::*;

    #[derive(Default)]
    struct Recorded(Option<u32>);

    impl SetCreationFlags for Recorded {
        fn set_creation_flags(&mut self, flags: u32) {
            self.0 = Some(flags);
        }
    }

    #[test]
    fn suppress_console_sets_create_no_window() {
        let mut recorded = Recorded::default();
        suppress_console(&mut recorded);
        assert_eq!(recorded.0, Some(CREATE_NO_WINDOW));
    }
}

#[cfg(test)]
mod spawn_sites_tests {
    //! The flag test above proves what [`hidden`] does, not that anything calls it: a
    //! refactor that dropped the call from a spawn site would have left it green and the
    //! console flashing again on Windows (from a review). So every `.spawn()` in
    //! the two modules that start processes has to follow a [`hidden`] call in the same
    //! function. Scanned on every platform, because the call is unconditional.
    use crate::source_scan;

    /// Each process spawn in the code of `source` (comments are not code), with the
    /// function it is in, up to it.
    fn spawns(source: &str) -> Vec<&str> {
        let needle = concat!(".spa", "wn()");
        source
            .match_indices(needle)
            .filter(|(at, _)| {
                let line = source[..*at].rfind('\n').map_or(0, |start| start + 1);
                !source[line..*at].trim_start().starts_with("//")
            })
            .map(|(at, _)| {
                let before = &source[..at];
                let function = before.rfind("fn ").expect("a spawn outside any function");
                &before[function..]
            })
            .collect()
    }

    #[test]
    fn every_child_is_started_hidden() {
        for (name, source) in [
            ("python.rs", source_scan::lf(include_str!("python.rs"))),
            (
                "scripts/runner.rs",
                source_scan::lf(include_str!("scripts/runner.rs")),
            ),
        ] {
            let found = spawns(&source);
            assert!(
                !found.is_empty(),
                "{name}: no spawn found, so nothing is checked"
            );
            for function in found {
                let head = function.lines().next().unwrap_or_default();
                assert!(
                    function.contains(concat!("hid", "den(")),
                    "{name}: `{head}` spawns a child without `hidden`"
                );
            }
        }
    }
}

/// Runs `command` and answers with what it wrote to stdout within `timeout`, keeping at
/// most the last `max_output` bytes — the answer is printed last on both platforms.
///
/// Both lookups need this and neither can use `wait_with_output`, for the same reason:
/// the program being asked may hand its stdout to something that outlives it. On Unix a
/// login shell's profile can start a background job that inherits the pipe; on Windows
/// `py.exe` starts the interpreter as a *child* process, which holds the pipe open if the
/// launcher is killed. So the reader runs on a thread that is never joined, the wait is
/// against a deadline, and the child's own exit ends the wait without waiting for the
/// pipe to close.
///
/// An empty answer covers every failure — the spawn, the timeout, a program that printed
/// nothing — because every caller has to treat all three the same way anyway.
fn capture(command: &mut Command, timeout: Duration, max_output: usize) -> Vec<u8> {
    let Ok(mut child) = hidden(command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Vec::new();
    };
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Vec::new();
    };

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n @ 1..) = stdout.read(&mut buf) {
            if tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + timeout;
    let mut out = Vec::new();
    let mut exited_at = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => {
                out.extend(chunk);
                if out.len() > max_output {
                    out.drain(..out.len() - max_output);
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
        // Once the program has exited, its answer is in the pipe; don't wait for
        // whatever else inherited stdout.
        if exited_at.is_none() && matches!(child.try_wait(), Ok(Some(_))) {
            exited_at = Some(now);
        }
        if exited_at.is_some_and(|t| now - t > Duration::from_millis(100)) {
            break;
        }
    }

    // Reap it; the kill only matters if it is still running.
    let _ = child.kill();
    let _ = child.wait();
    out
}

/// Forgets the cached answer (the interpreter and the login `PATH`), so the next
/// [`interpreter`] or [`login_path`] call asks the shell again.
///
/// Called by `python_check`, which is the one place the user asks gEdit to look for an
/// interpreter — after installing Python, or after changing the setting. Without it the
/// cache would outlive an install for the whole session.
pub fn forget() {
    *PYTHON.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Finds the interpreter a Command Prompt would run — except for the one it must not.
///
/// A clean Windows 10/11 has `python.exe` and `python3.exe` on the user's PATH before
/// anything the user installed: Windows creates *app execution aliases* for them in
/// `%LOCALAPPDATA%\Microsoft\WindowsApps`, and that folder is put at the front of the
/// user's `Path`. When no Python is installed those aliases are the App Installer's
/// redirector, which prints "Python was not found" and exits 9009 (and, run with no
/// arguments, opens the Microsoft Store instead of running anything).
///
/// **The redirector cannot be recognised by looking at the file.** An app execution alias
/// is a zero-byte reparse point with the `IO_REPARSE_TAG_APPEXECLINK` tag, and that tag is
/// not a name surrogate, so `std`'s own `FileType::new` (`library/std/src/sys/fs/
/// windows.rs`) reports it as neither a directory nor a symlink — an ordinary, empty,
/// perfectly existing file. A real Microsoft Store Python's alias is exactly the same kind
/// of object. So the rule here is about the *path*, not the file: an answer under
/// `WindowsApps` is never taken. Nothing is lost when the Store Python is genuine, because
/// [`FALLBACK`] is the bare name `python`, which `Command` still resolves through `PATH`
/// where the alias sits first.
///
/// That also keeps `C:\Program Files\WindowsApps\<package>\python.exe` out of the cache,
/// which is right for a second reason: the package version is part of that path, so it
/// stops being valid the next time the Store updates Python.
#[cfg(windows)]
mod imp {
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::Duration;

    /// How long the launcher gets to say which interpreter it would start. Generous: it
    /// starts a real Python, which on a cold file cache is not instant.
    const LAUNCHER_TIMEOUT: Duration = Duration::from_secs(5);

    /// Only the tail of the launcher's output is kept; the path is printed last.
    const MAX_LAUNCHER_OUTPUT: usize = 64 * 1024;

    /// What the launcher is asked. `sys.executable` is the interpreter's own path, which
    /// is what turns "the launcher" into something [`super::interpreter`] can cache.
    const WHICH_PYTHON: &str = "import sys; print(sys.executable)";

    /// The Python launcher. It is not an interpreter, so it is handled apart from the
    /// other candidates.
    const LAUNCHER: &str = "py";

    /// The names that are tried, best first.
    ///
    /// The launcher comes first because it is the one candidate whose meaning is defined:
    /// `-3` "only ever selects from core Python releases" and picks the newest installed
    /// (*Python Launcher for Windows*), and a system-wide install puts it in the Windows
    /// directory, which `Command` searches before `PATH`. `python` is next because that
    /// is the name a python.org install adds to `PATH`. `python3` is last: on Windows it
    /// is mostly the Microsoft Store's spelling, and that one is skipped below.
    const CANDIDATES: &[&str] = &[LAUNCHER, "python", "python3"];

    /// The path component that marks an app execution alias or a Store package.
    const STORE: &str = "WindowsApps";

    /// The user's Python, or `None` when there is none this lookup will vouch for.
    pub fn resolve() -> Option<PathBuf> {
        let dirs = search_dirs();
        rank(|name| which(name, &dirs, is_program), launcher_python)
    }

    /// What [`super::interpreter`] caches. Windows children inherit the user's `PATH`
    /// as it is, so there is no login `PATH` to add.
    pub fn lookup() -> super::Lookup {
        super::Lookup {
            python: resolve(),
            login_path: None,
        }
    }

    /// Which candidate wins, given a way to find a name and a way to ask the launcher.
    ///
    /// Pure, so the order and the skipping are tested without a Python on the machine.
    fn rank(
        find: impl Fn(&str) -> Option<PathBuf>,
        ask_launcher: impl Fn(&Path) -> Option<PathBuf>,
    ) -> Option<PathBuf> {
        for name in CANDIDATES {
            let Some(found) = find(name) else { continue };
            // Never *run* something under WindowsApps: with no arguments the redirector
            // opens the Store, and that must not happen because gEdit started.
            if is_store_path(&found) {
                continue;
            }
            let answer = if *name == LAUNCHER {
                ask_launcher(&found)
            } else {
                Some(found)
            };
            // A launcher that cannot answer — no Python 3, a hang, a shim that printed
            // something else — is simply not the answer; the next candidate gets its turn.
            match answer {
                Some(python) if !is_store_path(&python) => return Some(python),
                _ => continue,
            }
        }
        None
    }

    /// Where `Command::new(name)` would find `name`.
    ///
    /// `.exe` is appended because that is what happens for a name with no extension:
    /// "If the file name does not contain an extension, .exe is appended", which `std`
    /// reproduces in `resolve_exe` (`library/std/src/sys/process/windows.rs`) and does
    /// **not** widen with `PATHEXT` — so looking for anything else would find a candidate
    /// that a later `Command` could not start.
    fn which(name: &str, dirs: &[PathBuf], exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
        dirs.iter()
            .map(|dir| dir.join(format!("{name}.exe")))
            .find(|path| exists(path))
    }

    /// The directories `Command` searches for a bare program name, in its order.
    ///
    /// From `std`'s `search_paths` (`library/std/src/sys/process/windows.rs`): the child's
    /// own `PATH` when one was set, then the application's directory, then the system
    /// directory, then the Windows directory, and only then the inherited `PATH`. gEdit
    /// never gives the child a `PATH` of its own, so the first step does not apply;
    /// `%SystemRoot%` is the documented spelling of the two folders `GetSystemDirectoryW`
    /// and `GetWindowsDirectoryW` answer with.
    ///
    /// The order is what makes a system-wide `C:\Windows\py.exe` beat the Store alias that
    /// sits at the front of `PATH`.
    fn search_dirs() -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        if let Some(parent) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
        {
            dirs.push(parent);
        }
        if let Some(windows) = std::env::var_os("SystemRoot").or_else(|| std::env::var_os("windir"))
        {
            let windows = PathBuf::from(windows);
            dirs.push(windows.join("System32"));
            dirs.push(windows);
        }
        if let Some(path) = std::env::var_os("PATH") {
            dirs.extend(std::env::split_paths(&path).filter(|dir| !dir.as_os_str().is_empty()));
        }
        dirs
    }

    /// Whether the path is inside a Windows app package folder — the aliases in
    /// `%LOCALAPPDATA%\Microsoft\WindowsApps` or the packages in
    /// `C:\Program Files\WindowsApps`.
    fn is_store_path(path: &Path) -> bool {
        path.components()
            .any(|part| part.as_os_str().eq_ignore_ascii_case(STORE))
    }

    /// Asks the launcher which interpreter `py -3` would start.
    fn launcher_python(launcher: &Path) -> Option<PathBuf> {
        let out = super::capture(
            Command::new(launcher).args(["-3", "-c", WHICH_PYTHON]),
            LAUNCHER_TIMEOUT,
            MAX_LAUNCHER_OUTPUT,
        );
        pick_launcher_python(&String::from_utf8_lossy(&out), is_program)
    }

    /// Picks the last non-empty line of the launcher's stdout that is an absolute path to
    /// an existing `python*.exe`. Anything before it is a shim's or a profile's noise.
    fn pick_launcher_python(stdout: &str, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
        stdout
            .lines()
            .rev()
            .map(|line| Path::new(line.trim()))
            .find(|path| {
                path.is_absolute() && path.file_name().is_some_and(is_python_exe) && exists(path)
            })
            .map(Path::to_path_buf)
    }

    fn is_python_exe(name: &OsStr) -> bool {
        let name = name.to_string_lossy().to_ascii_lowercase();
        name.starts_with("python") && name.ends_with(".exe")
    }

    /// Whether the path names a file `CreateProcess` could start. Windows has no
    /// executable bit, so existing and not being a folder is the whole test.
    fn is_program(path: &Path) -> bool {
        path.metadata().is_ok_and(|meta| meta.is_file())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        const LAUNCHER_EXE: &str = r"C:\Windows\py.exe";
        const REAL: &str = r"C:\Users\p\AppData\Local\Programs\Python\Python312\python.exe";
        const ALIAS: &str = r"C:\Users\p\AppData\Local\Microsoft\WindowsApps\python.exe";
        const ALIAS3: &str = r"C:\Users\p\AppData\Local\Microsoft\WindowsApps\python3.exe";
        const PACKAGE: &str =
            r"C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.12_x64\python.exe";

        /// Stands in for `which`: a table of name to what PATH would resolve it to.
        fn finds(
            table: &'static [(&'static str, &'static str)],
        ) -> impl Fn(&str) -> Option<PathBuf> {
            move |name| {
                table
                    .iter()
                    .find(|(candidate, _)| *candidate == name)
                    .map(|(_, path)| PathBuf::from(path))
            }
        }

        fn launcher_says(path: &'static str) -> impl Fn(&Path) -> Option<PathBuf> {
            move |_| Some(PathBuf::from(path))
        }

        fn launcher_is_silent(_: &Path) -> Option<PathBuf> {
            None
        }

        #[test]
        fn the_launcher_is_asked_first_and_its_answer_is_the_interpreter() {
            let found = rank(
                finds(&[(LAUNCHER, LAUNCHER_EXE), ("python", REAL)]),
                launcher_says(REAL),
            );
            assert_eq!(found, Some(PathBuf::from(REAL)));
        }

        /// The launcher is a locator, not the answer: `py` itself is never cached,
        /// because `py -c` without `-3` is not the same interpreter.
        #[test]
        fn the_launcher_itself_is_never_the_answer() {
            assert_eq!(
                rank(finds(&[(LAUNCHER, LAUNCHER_EXE)]), launcher_is_silent),
                None
            );
        }

        #[test]
        fn a_launcher_that_cannot_answer_lets_the_next_candidate_win() {
            let found = rank(
                finds(&[(LAUNCHER, LAUNCHER_EXE), ("python", REAL)]),
                launcher_is_silent,
            );
            assert_eq!(found, Some(PathBuf::from(REAL)));
        }

        /// The whole point: on a clean Windows the only candidates are the Store's
        /// redirector stubs, and gEdit must answer "no Python" rather than name one.
        #[test]
        fn the_store_aliases_are_never_the_answer() {
            assert_eq!(
                rank(
                    finds(&[("python", ALIAS), ("python3", ALIAS3)]),
                    launcher_is_silent,
                ),
                None
            );
            // And a real install still wins over them.
            assert_eq!(
                rank(
                    finds(&[("python", ALIAS), ("python3", REAL)]),
                    launcher_is_silent,
                ),
                Some(PathBuf::from(REAL))
            );
        }

        /// A launcher under WindowsApps is not asked at all — running the redirector with
        /// no usable arguments is what opens the Store.
        #[test]
        fn a_launcher_under_windowsapps_is_not_even_asked() {
            let asked = std::cell::Cell::new(false);
            let found = rank(
                finds(&[
                    (
                        LAUNCHER,
                        r"C:\Users\p\AppData\Local\Microsoft\WindowsApps\py.exe",
                    ),
                    ("python", REAL),
                ]),
                |_| {
                    asked.set(true);
                    Some(PathBuf::from(REAL))
                },
            );
            assert_eq!(found, Some(PathBuf::from(REAL)));
            assert!(!asked.get(), "the redirector was run");
        }

        /// `py -3` can land on a Store package, whose path carries the package version and
        /// stops existing at the next update. It is refused like any other Store path.
        #[test]
        fn a_launcher_answer_inside_a_store_package_is_refused() {
            assert_eq!(
                rank(finds(&[(LAUNCHER, LAUNCHER_EXE)]), launcher_says(PACKAGE)),
                None
            );
        }

        #[test]
        fn store_paths_are_recognised_whatever_the_spelling() {
            for path in [ALIAS, ALIAS3, PACKAGE] {
                assert!(is_store_path(Path::new(path)), "{path}");
            }
            // Case and separator are both the file system's business, not ours.
            assert!(is_store_path(Path::new(
                r"c:\users\p\appdata\local\microsoft\windowsapps\python.exe"
            )));
            assert!(is_store_path(Path::new(
                "C:/Users/p/AppData/Local/Microsoft/WindowsApps/python.exe"
            )));
            for path in [REAL, LAUNCHER_EXE, r"C:\WindowsAppsOfMine\python.exe"] {
                assert!(!is_store_path(Path::new(path)), "{path}");
            }
        }

        #[test]
        fn which_appends_exe_and_takes_the_first_directory_that_has_it() {
            let dirs = [
                PathBuf::from(r"C:\nothing\here"),
                PathBuf::from(r"C:\Windows"),
                PathBuf::from(r"C:\Python312"),
            ];
            let exists = |path: &Path| {
                path == Path::new(r"C:\Windows\py.exe")
                    || path == Path::new(r"C:\Python312\python.exe")
            };
            assert_eq!(
                which("py", &dirs, exists),
                Some(PathBuf::from(r"C:\Windows\py.exe"))
            );
            assert_eq!(
                which("python", &dirs, exists),
                Some(PathBuf::from(r"C:\Python312\python.exe"))
            );
            // The extension is never guessed: `python3` is not `python`.
            assert_eq!(which("python3", &dirs, exists), None);
            assert_eq!(which("py", &[], exists), None);
        }

        #[test]
        fn picks_the_launchers_answer_after_any_noise() {
            let exists = |path: &Path| path == Path::new(REAL);
            let pick = |stdout: &str| pick_launcher_python(stdout, exists);
            let expected = Some(PathBuf::from(REAL));

            assert_eq!(pick(&format!("{REAL}\r\n")), expected);
            // No trailing newline, and leading space, are both possible.
            assert_eq!(pick(REAL), expected);
            assert_eq!(pick(&format!("  {REAL} \r\n\r\n")), expected);
            // A wrapper that greets first still ends with the answer.
            assert_eq!(
                pick(&format!("Installed Pythons found by py\r\n{REAL}\r\n")),
                expected
            );
        }

        #[test]
        fn refuses_a_launcher_answer_that_is_not_a_python_path() {
            let exists = |path: &Path| path == Path::new(REAL);
            for stdout in [
                "",
                "\r\n  \r\n",
                // Relative, not an interpreter, and a path that is not there.
                r"Python312\python.exe",
                "python.exe",
                r"C:\Windows\py.exe",
                r"C:\Python312\python.exe",
                "No suitable Python runtime found",
            ] {
                assert_eq!(pick_launcher_python(stdout, exists), None, "{stdout:?}");
            }
        }

        /// The search really is a search on this machine: `cmd.exe` is in the system
        /// directory on every Windows, and `Command::new("cmd")` finds it the same way.
        #[test]
        fn the_search_directories_find_a_program_windows_always_has() {
            let dirs = search_dirs();
            let found = which("cmd", &dirs, is_program).expect("cmd.exe was not found");
            assert!(found.is_absolute(), "{}", found.display());
            assert_eq!(
                found.file_name().and_then(OsStr::to_str),
                Some("cmd.exe"),
                "{}",
                found.display()
            );
            assert!(is_program(&found));
        }

        /// Whatever this machine has, the answer is a real interpreter path and never the
        /// Store's. A machine with no Python answers `None`, which is also correct.
        #[test]
        fn whatever_is_resolved_here_is_usable() {
            if let Some(python) = resolve() {
                assert!(python.is_absolute(), "{}", python.display());
                assert!(is_program(&python), "{}", python.display());
                assert!(!is_store_path(&python), "{}", python.display());
            }
        }

        /// Shows what this machine resolves to, and how long the launcher took.
        #[test]
        #[ignore = "depends on this machine's Python install"]
        fn resolves_on_this_machine() {
            let start = std::time::Instant::now();
            let resolved = resolve();
            println!("resolved: {resolved:?} in {:?}", start.elapsed());
            println!("PATH: {:?}", std::env::var_os("PATH"));
            for name in CANDIDATES {
                println!("{name}: {:?}", which(name, &search_dirs(), is_program));
            }
            assert!(resolved.is_some());
        }
    }
}

/// Finds `python3` the way the user's terminal would. An app started from
/// Finder or the Dock only gets launchd's minimal PATH, where a bare `python3`
/// is the Xcode stub rather than the Homebrew or python.org install.
#[cfg(unix)]
mod imp {
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::Duration;

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
    ///
    /// The stub is a legitimate last answer, not a sentinel — on a stock Mac with the
    /// Command Line Tools it is the only Python there is. `interpreter` caches it like
    /// any other, and `forget` is what lets a later install win.
    #[cfg(test)]
    pub fn resolve() -> Option<PathBuf> {
        lookup().python
    }

    /// One login shell answers both questions: where `python3` is, and what `PATH` the
    /// user's terminal has.
    pub fn lookup() -> super::Lookup {
        let asked = ask_login_shell();
        super::Lookup {
            python: rank(
                pick_shell_python(&asked, is_executable_file),
                is_executable_file,
            ),
            login_path: pick_shell_path(&asked),
        }
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

    /// What the shell prints in front of the `PATH` it reports, so the line can be told
    /// from anything a profile prints.
    const PATH_MARK: &str = "GEDIT_LOGIN_PATH=";

    /// Asks `$SHELL -l -c 'command -v python3; …$PATH'`. A login shell reads the
    /// user's profile (and so their PATH); it is not interactive, so rc files
    /// such as `~/.zshrc` are not read.
    fn ask_login_shell() -> String {
        let shell = std::env::var_os("SHELL")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_SHELL.into());
        let out = super::capture(
            // The leading echo keeps the answer on its own line even if the
            // profile prints something without a trailing newline. `printf` rather
            // than `echo` for the `PATH`: some `echo`s read backslashes.
            Command::new(shell).args([
                "-l",
                "-c",
                "echo; command -v python3; printf '\\n%s%s\\n' 'GEDIT_LOGIN_PATH=' \"$PATH\"",
            ]),
            SHELL_TIMEOUT,
            MAX_SHELL_OUTPUT,
        );
        String::from_utf8_lossy(&out).into_owned()
    }

    #[cfg(test)]
    fn login_shell_python() -> Option<PathBuf> {
        pick_shell_python(&ask_login_shell(), is_executable_file)
    }

    /// The last line that starts with [`PATH_MARK`], when what follows is a `PATH`:
    /// at least one directory, and every directory absolute. A line from a shell that
    /// printed a list in some other shape (`fish` spaces) or a relative entry is not
    /// trusted, because it would put the current folder on a script's `PATH`.
    fn pick_shell_path(stdout: &str) -> Option<std::ffi::OsString> {
        let value = stdout
            .lines()
            .rev()
            .find_map(|line| line.trim().strip_prefix(PATH_MARK))?
            .trim();
        let dirs: Vec<PathBuf> = std::env::split_paths(value)
            .filter(|dir| !dir.as_os_str().is_empty())
            .collect();
        if dirs.is_empty() || dirs.iter().any(|dir| !dir.is_absolute()) {
            return None;
        }
        std::env::join_paths(dirs).ok()
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

        /// The shell's `PATH` is read from its marked line, whatever the profile printed
        /// around it, and the python3 line is still found with the extra line after it.
        #[test]
        fn picks_the_marked_path_line_and_still_finds_python() {
            let stdout = "hello\n/usr/local/bin/python3\n\nGEDIT_LOGIN_PATH=/opt/homebrew/bin:/usr/bin:/bin\nbye\n";
            assert_eq!(
                pick_shell_path(stdout),
                Some(std::ffi::OsString::from("/opt/homebrew/bin:/usr/bin:/bin"))
            );
            assert_eq!(pick(stdout), Some(PathBuf::from("/usr/local/bin/python3")));
        }

        #[test]
        fn a_path_that_is_not_a_clean_list_of_absolute_folders_is_not_trusted() {
            for stdout in [
                "",
                "no marker here\n",
                "GEDIT_LOGIN_PATH=\n",
                // A relative entry would put the current folder on a script's PATH.
                "GEDIT_LOGIN_PATH=/usr/bin:bin\n",
                "GEDIT_LOGIN_PATH=.:/usr/bin\n",
            ] {
                assert_eq!(pick_shell_path(stdout), None, "accepted {stdout:?}");
            }
        }

        #[test]
        fn the_last_marked_line_wins() {
            let stdout = "GEDIT_LOGIN_PATH=/a\nGEDIT_LOGIN_PATH=/b:/c\n";
            assert_eq!(
                pick_shell_path(stdout),
                Some(std::ffi::OsString::from("/b:/c"))
            );
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

#[cfg(test)]
mod cache_tests {
    //! The cache, not the lookup: `imp`'s own tests cover what `resolve` picks.
    //!
    //! `PYTHON` is process-wide, so these tests own it — nothing else in the crate calls
    //! `interpreter()` from a test. If something ever does, it needs a shared lock.

    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Cargo runs tests in parallel and `PYTHON` is one static; these two take turns.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// The regression (G8 M5): the macOS system stub used to be returned *without* being
    /// cached, so on a stock Mac — where it is the only Python there is — every
    /// `script_run` spawned a login shell again and waited up to 3 s for it.
    #[test]
    fn looks_up_once_even_when_the_answer_is_the_system_stub() {
        let _serial = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let calls = AtomicUsize::new(0);
        let lookup = || {
            calls.fetch_add(1, Ordering::SeqCst);
            Lookup {
                python: Some(PathBuf::from("/usr/bin/python3")),
                login_path: None,
            }
        };
        let stub = PathBuf::from("/usr/bin/python3");

        forget();
        assert_eq!(cached_or(lookup).python, stub);
        assert_eq!(cached_or(lookup).python, stub);
        assert_eq!(cached_or(lookup).python, stub);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "the lookup ran more than once"
        );

        // `python_check` calls `forget`, which is what lets a Python installed while the
        // app was running still win.
        forget();
        assert_eq!(cached_or(lookup).python, stub);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        forget();
    }

    /// No Python at all still answers, and still only asks once.
    #[test]
    fn caches_the_bare_name_when_nothing_was_found() {
        let _serial = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let calls = AtomicUsize::new(0);
        let lookup = || {
            calls.fetch_add(1, Ordering::SeqCst);
            Lookup::default()
        };
        forget();
        assert_eq!(cached_or(lookup).python, PathBuf::from(FALLBACK));
        assert_eq!(cached_or(lookup).python, PathBuf::from(FALLBACK));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        forget();
    }

    /// The login shell's `PATH` rides on the same lookup as the interpreter: one shell
    /// for both, cached together, and dropped together by `forget`.
    #[test]
    fn the_login_path_is_cached_with_the_interpreter_and_forgotten_with_it() {
        let _serial = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let calls = AtomicUsize::new(0);
        let lookup = || {
            calls.fetch_add(1, Ordering::SeqCst);
            Lookup {
                python: Some(PathBuf::from("/opt/homebrew/bin/python3")),
                login_path: Some(OsString::from("/opt/homebrew/bin:/usr/bin")),
            }
        };
        forget();
        let first = cached_or(lookup);
        let second = cached_or(lookup);
        assert_eq!(
            first.login_path,
            Some(OsString::from("/opt/homebrew/bin:/usr/bin"))
        );
        assert_eq!(second.python, PathBuf::from("/opt/homebrew/bin/python3"));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "one shell for both answers"
        );

        forget();
        let after = || {
            calls.fetch_add(1, Ordering::SeqCst);
            Lookup::default()
        };
        assert_eq!(
            cached_or(after).login_path,
            None,
            "forget drops the PATH too"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        forget();
    }

    /// The bare name is the one the platform's own installs answer to. On Windows it also
    /// has to be the name whose Microsoft Store alias exits 9009, because that is how
    /// `scripts::runner::judge` turns "no Python" into a message the user can act on.
    #[test]
    fn the_fallback_is_the_name_this_platform_uses() {
        assert_eq!(FALLBACK, if cfg!(windows) { "python" } else { "python3" });
    }
}

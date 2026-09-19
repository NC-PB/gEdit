use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

#[derive(serde::Serialize)]
struct ScriptResult {
    stdout: String,
    stderr: String,
    success: bool,
    data: serde_json::Value,
}

/// Resolves `script_name` inside `folder_path`. Only a bare `*.py` file name is
/// accepted (no separators, no `.`/`..`), so the script is always a direct child
/// of the chosen folder.
fn resolve_script(folder_path: &str, script_name: &str) -> Result<PathBuf, String> {
    let name = Path::new(script_name);
    let is_bare_py = !script_name.contains(['/', '\\'])
        && name.file_name() == Some(name.as_os_str())
        && name.extension().is_some_and(|ext| ext == "py");
    if !is_bare_py {
        return Err(format!("Invalid script name: {script_name}"));
    }

    let folder = Path::new(folder_path);
    if !folder.is_dir() {
        return Err(format!("Not a valid directory: {folder_path}"));
    }

    let script = folder.join(name);
    if !script.is_file() {
        return Err(format!("Script not found: {}", script.display()));
    }
    Ok(script)
}

/// The Python interpreter for scripts, resolved on first use. Only a real
/// install is cached (not a fallback), so installing Python later works
/// without a restart.
fn python_interpreter() -> PathBuf {
    static PYTHON: OnceLock<PathBuf> = OnceLock::new();
    // GEDIT_PYTHON (e.g. /path/to/venv/bin/python) skips the lookup.
    if let Some(path) = std::env::var_os("GEDIT_PYTHON").filter(|p| !p.is_empty()) {
        return PathBuf::from(path);
    }
    if let Some(path) = PYTHON.get() {
        return path.clone();
    }
    match python::resolve() {
        Some(path) if !python::is_fallback(&path) => PYTHON.get_or_init(|| path).clone(),
        Some(path) => path,
        None => PathBuf::from("python3"),
    }
}

/// Windows installs usually expose `python` on PATH.
#[cfg(windows)]
mod python {
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
mod python {
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

/// Runs `script_name` from `folder_path` with `input_text` on stdin and returns
/// its output. `data` holds stdout parsed as JSON, or stdout as a string.
///
/// `async` makes Tauri run this on its async runtime instead of the main
/// thread, so the UI stays responsive while the script runs.
#[tauri::command(async)]
fn run_python_script(
    folder_path: String,
    script_name: String,
    input_text: String,
) -> Result<ScriptResult, String> {
    let script = resolve_script(&folder_path, &script_name)?;
    let python = python_interpreter();

    let mut child = Command::new(&python)
        .arg(&script)
        // Run from the script's folder so relative imports and files work.
        .current_dir(&folder_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Python ({}): {e}", python.display()))?;

    // Write stdin from a separate thread to avoid a deadlock when the script
    // produces a lot of output before it has read all of its input.
    if let Some(mut stdin) = child.stdin.take() {
        std::thread::spawn(move || {
            // A script that exits without reading stdin closes the pipe early;
            // that is not an error. Dropping `stdin` closes our end.
            let _ = stdin.write_all(input_text.as_bytes());
        });
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for script execution: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let data =
        serde_json::from_str(&stdout).unwrap_or_else(|_| serde_json::Value::String(stdout.clone()));

    Ok(ScriptResult {
        stdout,
        stderr,
        success: output.status.success(),
        data,
    })
}

/// Lists the `.py` files directly inside `folder_path`, sorted by name.
#[tauri::command]
fn list_python_scripts(folder_path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&folder_path);
    if !path.is_dir() {
        return Err(format!("Not a valid directory: {folder_path}"));
    }

    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {e}"))?;

    let mut scripts: Vec<String> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "py"))
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();

    scripts.sort();
    Ok(scripts)
}

/// macOS app menu whose Quit goes through the main window's close guard.
///
/// Tauri's default menu uses the predefined Quit item (`terminate:`), which
/// exits without emitting `CloseRequested`, so Cmd+Q would skip the frontend's
/// unsaved-changes prompt. This mirrors `tauri::menu::Menu::default` on macOS
/// but swaps that item for a custom one handled by [`request_quit`].
#[cfg(target_os = "macos")]
mod app_menu {
    use tauri::menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    };
    use tauri::{AppHandle, Manager, Runtime};

    pub const QUIT_ID: &str = "quit";
    const MAIN_WINDOW: &str = "main";

    pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
        let pkg_info = app.package_info();
        let config = app.config();
        let about_metadata = AboutMetadata {
            name: Some(pkg_info.name.clone()),
            version: Some(pkg_info.version.to_string()),
            copyright: config.bundle.copyright.clone(),
            authors: config.bundle.publisher.clone().map(|p| vec![p]),
            ..Default::default()
        };
        let quit = MenuItem::with_id(
            app,
            QUIT_ID,
            format!("Quit {}", pkg_info.name),
            true,
            Some("CmdOrCtrl+Q"),
        )?;

        Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    &pkg_info.name,
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &quit,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[&PredefinedMenuItem::close_window(app, None)?],
                )?,
                &Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "View",
                    true,
                    &[&PredefinedMenuItem::fullscreen(app, None)?],
                )?,
                &Submenu::with_id_and_items(
                    app,
                    WINDOW_SUBMENU_ID,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app, None)?,
                        &PredefinedMenuItem::maximize(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::close_window(app, None)?,
                    ],
                )?,
                &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?,
            ],
        )
    }

    /// Asks the main window to close, which emits `CloseRequested` so the
    /// frontend can keep it open; closing the last window then exits the app.
    /// Exits directly if there is no main window.
    pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
        match app.get_webview_window(MAIN_WINDOW) {
            Some(window) => {
                if let Err(e) = window.close() {
                    eprintln!("Failed to close the main window: {e}");
                }
            }
            None => app.exit(0),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            run_python_script,
            list_python_scripts
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu::build).on_menu_event(|app, event| {
        if event.id() == app_menu::QUIT_ID {
            app_menu::request_quit(app);
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::resolve_script;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gedit-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::create_dir_all(dir.join("dir.py")).unwrap();
        fs::write(dir.join("ok.py"), "").unwrap();
        fs::write(dir.join("sub").join("nested.py"), "").unwrap();
        fs::write(dir.join("notes.txt"), "").unwrap();
        dir
    }

    #[test]
    fn resolves_bare_py_file_in_folder() {
        let dir = scratch_dir("ok");
        let folder = dir.to_str().unwrap();
        assert_eq!(resolve_script(folder, "ok.py").unwrap(), dir.join("ok.py"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_everything_else() {
        let dir = scratch_dir("reject");
        let folder = dir.to_str().unwrap();
        for name in [
            "",
            ".",
            "..",
            ".py",
            "../ok.py",
            "sub/nested.py",
            "sub\\nested.py",
            "/etc/ok.py",
            "notes.txt",
            "ok.PY",
            "missing.py",
            "dir.py",
        ] {
            assert!(resolve_script(folder, name).is_err(), "accepted {name:?}");
        }
        assert!(resolve_script(dir.join("missing").to_str().unwrap(), "ok.py").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Cmd+Q must emit `CloseRequested` on the main window (so the frontend's
    /// unsaved-changes guard runs) instead of terminating the app directly.
    #[cfg(target_os = "macos")]
    #[test]
    fn quit_requests_close_of_main_window() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use tauri::test::{mock_builder, mock_context, noop_assets};
        use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

        let app = mock_builder()
            .setup(|app| {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?;
                super::app_menu::request_quit(app.handle());
                Ok(())
            })
            .build(mock_context(noop_assets()))
            .unwrap();

        let close_requested = Arc::new(AtomicBool::new(false));
        let seen = close_requested.clone();
        let mut ticks = 0;
        app.run_return(move |app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { .. },
                ..
            } => seen.store(label == "main", Ordering::SeqCst),
            // The mock event loop only ends once no window is left; destroy
            // the window after a few idle ticks so a regression fails, not hangs.
            RunEvent::MainEventsCleared => {
                ticks += 1;
                if let Some(window) = app.get_webview_window("main").filter(|_| ticks > 3) {
                    window.destroy().unwrap();
                }
            }
            _ => {}
        });
        assert!(close_requested.load(Ordering::SeqCst));
    }
}

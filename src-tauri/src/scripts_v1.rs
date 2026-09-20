//! The v1 scripting commands: the frontend passes a folder it picked with the
//! native dialog plus a bare script name, and gets the script's output back.
//!
//! This is the Phase 0 surface. M4 replaces it with id-based discovery and running
//! (`scripts_list` / `script_run`), and M5 removes both commands here.
//!
//! **Carried into M4, deliberately (plan §11 "Script processes leak"):** a run here has
//! no deadline, no cap on the output it collects and no way to cancel it, and quitting
//! does not ask about one that is still running, so a `while True:` script keeps its
//! Python child alive past the window and leaves `scriptRunning` latched for the rest of
//! the session. This code is unchanged from `feat/phase-1` — M1 only moved it out of
//! `lib.rs` — but M1 does newly promote `scriptRunning` to a `CommandContext` flag, which
//! makes the gap look handled. It is not: `scripts.timeoutSeconds`, the Unix
//! process-group kill and `kill_all` on exit belong to M4's Rust runner, together with
//! making `list_python_scripts` (a blocking `read_dir` on the main thread) async.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::python;

#[derive(serde::Serialize)]
pub struct ScriptResult {
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

/// Runs `script_name` from `folder_path` with `input_text` on stdin and returns
/// its output. `data` holds stdout parsed as JSON, or stdout as a string.
///
/// `async` makes Tauri run this on its async runtime instead of the main
/// thread, so the UI stays responsive while the script runs.
#[tauri::command(async)]
pub fn run_python_script(
    folder_path: String,
    script_name: String,
    input_text: String,
) -> Result<ScriptResult, String> {
    let script = resolve_script(&folder_path, &script_name)?;
    let python = python::interpreter();

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
pub fn list_python_scripts(folder_path: String) -> Result<Vec<String>, String> {
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
}

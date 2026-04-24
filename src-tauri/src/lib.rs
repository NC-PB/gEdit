// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::fs;
use std::path::Path;
use std::process::Command as ProcessCommand;

#[derive(serde::Serialize)]
struct ScriptResult {
    stdout: String,
    stderr: String,
    success: bool,
    data: serde_json::Value,
}

/// Execute a Python script, passing input_text via stdin.
/// Returns the script's stdout and stderr.
#[tauri::command]
fn run_python_script(script_path: String, input_text: String) -> Result<ScriptResult, String> {
    eprintln!(
        "DEBUG: run_python_script called with script (lib.rs, run_python_script): {}",
        script_path
    );
    // Verify script exists
    if !Path::new(&script_path).exists() {
        return Err(format!("Script not found: {}", script_path));
    }

    // Try "python" first (standard on Windows), then "python3"
    let python_cmd = if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    };

    eprintln!(
        "DEBUG: Preparing to spawn: {} with script: {}",
        python_cmd, script_path
    );

    let mut child = ProcessCommand::new(python_cmd)
        .arg(&script_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Set current dir to script location so relative imports/files work
        .current_dir(Path::new(&script_path).parent().unwrap_or(Path::new(".")))
        .spawn()
        .map_err(|e| {
            eprintln!("DEBUG: Spawn failed: {}", e);
            format!("Failed to spawn Python: {}", e)
        })?;

    eprintln!("DEBUG: Process spawned. PID: {:?}", child.id());

    // Write input_text to stdin in a separate thread to avoid deadlocks
    // if the script produces a lot of output before reading all input.
    if let Some(mut stdin) = child.stdin.take() {
        let input = input_text.clone();
        std::thread::spawn(move || {
            use std::io::Write;
            eprintln!(
                "DEBUG: Stdin thread started. Writing {} bytes...",
                input.len()
            );
            if let Err(e) = stdin.write_all(input.as_bytes()) {
                eprintln!("DEBUG: Failed to write to stdin: {}", e);
            }
            eprintln!("DEBUG: Stdin write complete. Input: {}", input);
            // stdin dropped here, closing pipe
        });
    }

    eprintln!("DEBUG: Waiting for process to complete...");
    match child.wait_with_output() {
        Ok(output) => {
            eprintln!(
                "DEBUG: Process finished. Success: {}, Stdout len: {}, Stderr len: {}",
                output.status.success(),
                output.stdout.len(),
                output.stderr.len()
            );
            let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

            eprintln!("DEBUG: Stdout: {}", stdout_str);
            eprintln!("DEBUG: Stderr: {}", stderr_str);

            // Attempt to parse stdout as JSON
            let json_data: serde_json::Value = serde_json::from_str(&stdout_str)
                .unwrap_or_else(|_| serde_json::Value::String(stdout_str.clone()));

            Ok(ScriptResult {
                stdout: stdout_str,
                stderr: stderr_str,
                success: output.status.success(),
                data: json_data,
            })
        }
        Err(e) => {
            eprintln!("DEBUG: wait_with_output failed: {}", e);
            Err(format!("Failed to wait for script execution: {}", e))
        }
    }
}

/// List all .py files in the given folder.
#[tauri::command]
fn list_python_scripts(folder_path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&folder_path);
    if !path.is_dir() {
        return Err(format!("Not a valid directory: {}", folder_path));
    }

    eprintln!("DEBUG: list_python_scripts called for: {}", folder_path);
    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut scripts: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let file_path = entry.path();
        if file_path.is_file() {
            if let Some(ext) = file_path.extension() {
                if ext == "py" {
                    if let Some(name) = file_path.file_name() {
                        scripts.push(name.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    scripts.sort();
    Ok(scripts)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!("DEBUG: Starting gEdit Tauri Backend...");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            run_python_script,
            list_python_scripts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

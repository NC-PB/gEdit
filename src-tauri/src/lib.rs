//! The gEdit backend: it wires the plugins, the commands and the macOS menu
//! together and hands the event loop over to Tauri.
//!
//! Everything else lives in a module of its own, so that this file stays a single
//! readable description of the app's native surface:
//!
//! - [`files`] — `files_stat`, the only command the editor core calls
//! - [`menu`] — the macOS menu and the two window-closing requests (macOS only)
//! - [`python`] — finding the user's Python interpreter
//! - [`scripts_v1`] — the Phase 0 scripting commands
//!
//! Keep the shape of [`run`]: the runtime harness (`tests/runtime/sync.sh`) builds
//! its test variant by string-replacing the builder expression and the opening of
//! the command-handler macro, and refuses to patch a `lib.rs` that spells either
//! of them more than once — a mention in a comment counts.

mod files;
#[cfg(target_os = "macos")]
mod menu;
mod python;
mod scripts_v1;

use tauri::{App, AppHandle, RunEvent};

/// Runs once, before the window is shown. The milestones that add config, state
/// and the recent-files list hook in here.
fn setup_app(_app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

/// Called for every event of the running app (`ExitRequested`, `Exit`, window and
/// menu events). M4 uses it to kill script processes on exit.
fn on_run_event(_app: &AppHandle, _event: RunEvent) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            files::files_stat,
            scripts_v1::run_python_script,
            scripts_v1::list_python_scripts
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_menu_event);

    builder
        .build(tauri::generate_context!())
        .expect("error while building the tauri application")
        .run(on_run_event);
}

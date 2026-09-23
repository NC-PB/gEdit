//! The gEdit backend: it wires the plugins, the commands and the macOS menu
//! together and hands the event loop over to Tauri.
//!
//! Everything else lives in a module of its own, so that this file stays a single
//! readable description of the app's native surface:
//!
//! - [`files`] — `files_stat`, the only command the editor core calls
//! - [`paths`] — where the config, data and user-script folders are
//! - [`atomic`] — crash-safe writes for the app's own small JSON files
//! - [`config`] — `settings.json`
//! - [`machines`] — `machines.json`: the user's machine configurations (M6)
//! - [`quit`] — the macOS quit guard (M6)
//! - [`state`] — `state.json`: the recent-files list and the webview's UI state
//! - [`menu`] — the macOS menu and the two window-closing requests (macOS only)
//! - [`python`] — finding the user's Python interpreter
//! - [`scripts`] — the v2 scripting backend: discovery, the TOML header and the runner
//!
//! Window geometry is not ours: `tauri-plugin-window-state` saves and restores it
//! into `.window-state.json` next to `settings.json` in the config folder. Its
//! `VISIBLE` flag is left out on purpose, so that a window the user closed while
//! hidden cannot come back hidden.
//!
//! Keep the shape of [`run`]: the runtime harness (`tests/runtime/sync.sh`) builds
//! its test variant by string-replacing the builder expression and the opening of
//! the command-handler macro, and refuses to patch a `lib.rs` that spells either
//! of them more than once — a mention in a comment counts.

mod atomic;
mod config;
mod files;
mod machines;
#[cfg(target_os = "macos")]
mod menu;
mod paths;
mod python;
mod quit;
pub mod scripts;
mod state;

use tauri::{App, AppHandle, RunEvent};
use tauri_plugin_window_state::StateFlags;

/// Runs once, before the window is shown: the folders the app writes to have to
/// exist, and the recent files have to be back in the fs scope before the webview
/// can ask to reopen one.
fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    paths::ensure_dirs(handle);
    state::grant_recent_on_startup(handle);
    // macOS only in effect: Dock -> Quit and a logout never reach the window, so the
    // answer to "may I terminate?" has to be ready before one is asked (AD-20).
    quit::install(handle);
    Ok(())
}

/// Called for every event of the running app (`ExitRequested`, `Exit`, window and
/// menu events).
///
/// On `Exit` every script process is stopped (plan AD-13), so a `while True:` script
/// cannot outlive the window. `RunEvent` is `#[non_exhaustive]`, hence the `matches!`.
fn on_run_event(app: &AppHandle, event: RunEvent) {
    if matches!(event, RunEvent::Exit) {
        scripts::kill_all(app);
    }
}

/// Everything the window-state plugin tracks except `VISIBLE` (plan AD-9): size,
/// position, maximized, decorations and fullscreen.
fn window_state_flags() -> StateFlags {
    StateFlags::all().difference(StateFlags::VISIBLE)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .build(),
        )
        // The in-flight script runs, so that `script_cancel` and `kill_all` reach the
        // same registry the runner polls (plan AD-13).
        .manage(scripts::RunRegistry::default())
        // Whether any document has unsaved changes, for the macOS termination hook
        // (AD-20): the delegate answers from this flag, never by asking the webview.
        .manage(quit::QuitGuard::default())
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            files::files_stat,
            config::config_load,
            config::settings_save,
            config::settings_open_file,
            machines::machines_save,
            machines::machines_open_file,
            quit::quit_guard_set_dirty,
            state::ui_state_save,
            state::recent_list,
            state::recent_touch,
            state::recent_remove,
            state::recent_clear,
            scripts::discovery::scripts_list,
            scripts::discovery::script_new,
            scripts::discovery::script_copy_to_user,
            scripts::discovery::script_source_path,
            scripts::runner::script_run,
            scripts::runner::script_cancel,
            scripts::runner::python_check
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_menu_event);

    builder
        .build(tauri::generate_context!())
        .expect("error while building the tauri application")
        .run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AD-9: everything but `VISIBLE`, so a restart always shows the window.
    #[test]
    fn window_state_tracks_everything_but_visibility() {
        let flags = window_state_flags();
        assert!(!flags.contains(StateFlags::VISIBLE));
        for flag in [
            StateFlags::SIZE,
            StateFlags::POSITION,
            StateFlags::MAXIMIZED,
            StateFlags::DECORATIONS,
            StateFlags::FULLSCREEN,
        ] {
            assert!(flags.contains(flag), "missing {flag:?}");
        }
    }
}

//! The macOS application menu.
//!
//! Tauri's default menu is built from predefined items, which act on the window
//! through AppKit directly:
//!
//! - Quit is `terminate:`, which exits the process without emitting
//!   `CloseRequested`, so Cmd+Q would skip the frontend's unsaved-changes prompt.
//! - Close Window is `performClose:` on **Cmd+W**, which the webview needs: from
//!   M1 on a document lives in a tab, and Cmd+W closes the tab, not the window.
//!
//! This menu therefore mirrors `tauri::menu::Menu::default` on macOS but replaces
//! both with custom items ([`QUIT_ID`], [`CLOSE_WINDOW_ID`]) that go through
//! [`request_quit`] and [`request_close_window`], i.e. through the guarded
//! `window.close()`.
//!
//! **Close Window carries no accelerator** (D-WP1.4-1). Its shortcut is Cmd+Shift+W,
//! but muda cannot express that on macOS: it sets the item's `keyEquivalent` to the
//! *lowercase* character and puts Shift in `keyEquivalentModifierMask`, while AppKit
//! takes Shift from the case of the key equivalent and ignores that mask bit. An
//! item declared as `CmdOrCtrl+Shift+W` therefore answers to **Cmd+W** and never to
//! Cmd+Shift+W — measured, see the note below — which is exactly the key this
//! milestone has to hand to the webview. Since tauri only takes the accelerator as a
//! string, and parses it through `Accelerator`/`Code` (always lowercased), there is
//! no way to ask for the uppercase key equivalent AppKit needs. The item is
//! therefore click-only here, and the webview binds Cmd+Shift+W to the same guarded
//! close (WP1.6, `contrib/files.ts`).
//!
//! Measured with a probe build whose menu carried four extra items (gEdit 0.1.0,
//! tauri 2.11.5, muda 0.19.3, macOS 15): `CmdOrCtrl+Shift+W` fired on Cmd+W,
//! `CmdOrCtrl+Shift+E` on Cmd+E, while `CmdOrCtrl+Alt+W` and `CmdOrCtrl+R` answered
//! to their own chords. Only Shift is affected.
//!
//! The menu is described first, as [`Item`]s, and materialized by [`build`]. A
//! cargo test cannot look at the built menu — muda creates items only on the main
//! thread, and has no accelerator getter — so the description is what the unit
//! tests assert on. The built menu is checked by the runtime harness, which reads
//! the real one with `h_menu_dump`.

use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
    HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Manager, Runtime};

pub const QUIT_ID: &str = "quit";
pub const CLOSE_WINDOW_ID: &str = "close_window";
const QUIT_ACCEL: &str = "CmdOrCtrl+Q";
const MAIN_WINDOW: &str = "main";

/// The predefined items this menu uses. There is deliberately no `CloseWindow`
/// variant: the predefined item owns Cmd+W and closes the window without a way to
/// change its accelerator, so the menu cannot contain one by construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Predef {
    About,
    Separator,
    Services,
    Hide,
    HideOthers,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Fullscreen,
    Minimize,
    Maximize,
}

/// One entry of the menu description.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Item {
    /// A `PredefinedMenuItem`: AppKit supplies the text, the accelerator and the
    /// action.
    Predefined(Predef),
    /// A `MenuItem` whose id [`on_menu_event`] dispatches on.
    Custom {
        id: &'static str,
        text: String,
        accelerator: Option<&'static str>,
    },
    Submenu {
        /// Set for the submenus macOS recognizes by id (Window, Help).
        id: Option<&'static str>,
        text: String,
        items: Vec<Item>,
    },
}

fn submenu(id: Option<&'static str>, text: &str, items: Vec<Item>) -> Item {
    Item::Submenu {
        id,
        text: text.to_owned(),
        items,
    }
}

/// The Close Window item. It appears in both File and Window, the way the
/// predefined one did; two items with the same id raise the same menu event.
///
/// No accelerator: see the module docs. Cmd+Shift+W is bound in the webview, and
/// any accelerator here would claim Cmd+W instead.
fn close_window() -> Item {
    Item::Custom {
        id: CLOSE_WINDOW_ID,
        text: "Close Window".to_owned(),
        accelerator: None,
    }
}

/// The whole menu as data. `app_name` is the product name, which names the first
/// submenu and the Quit item.
pub fn layout(app_name: &str) -> Vec<Item> {
    use Item::Predefined as P;
    use Predef::*;
    vec![
        submenu(
            None,
            app_name,
            vec![
                P(About),
                P(Separator),
                P(Services),
                P(Separator),
                P(Hide),
                P(HideOthers),
                P(Separator),
                Item::Custom {
                    id: QUIT_ID,
                    text: format!("Quit {app_name}"),
                    accelerator: Some(QUIT_ACCEL),
                },
            ],
        ),
        submenu(None, "File", vec![close_window()]),
        submenu(
            None,
            "Edit",
            vec![
                P(Undo),
                P(Redo),
                P(Separator),
                P(Cut),
                P(Copy),
                P(Paste),
                P(SelectAll),
            ],
        ),
        submenu(None, "View", vec![P(Fullscreen)]),
        submenu(
            Some(WINDOW_SUBMENU_ID),
            "Window",
            vec![P(Minimize), P(Maximize), P(Separator), close_window()],
        ),
        submenu(Some(HELP_SUBMENU_ID), "Help", vec![]),
    ]
}

/// Builds the real menu from [`layout`]. Passed to `Builder::menu`.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let items = make_all(app, &layout(&pkg_info.name), &about)?;
    Menu::with_items(app, &refs(&items))
}

fn make_all<R: Runtime>(
    app: &AppHandle<R>,
    items: &[Item],
    about: &AboutMetadata,
) -> tauri::Result<Vec<Box<dyn IsMenuItem<R>>>> {
    items.iter().map(|item| make(app, item, about)).collect()
}

fn refs<R: Runtime>(items: &[Box<dyn IsMenuItem<R>>]) -> Vec<&dyn IsMenuItem<R>> {
    items.iter().map(Box::as_ref).collect()
}

fn make<R: Runtime>(
    app: &AppHandle<R>,
    item: &Item,
    about: &AboutMetadata,
) -> tauri::Result<Box<dyn IsMenuItem<R>>> {
    Ok(match item {
        Item::Predefined(kind) => {
            let p = match kind {
                Predef::About => PredefinedMenuItem::about(app, None, Some(about.clone()))?,
                Predef::Separator => PredefinedMenuItem::separator(app)?,
                Predef::Services => PredefinedMenuItem::services(app, None)?,
                Predef::Hide => PredefinedMenuItem::hide(app, None)?,
                Predef::HideOthers => PredefinedMenuItem::hide_others(app, None)?,
                Predef::Undo => PredefinedMenuItem::undo(app, None)?,
                Predef::Redo => PredefinedMenuItem::redo(app, None)?,
                Predef::Cut => PredefinedMenuItem::cut(app, None)?,
                Predef::Copy => PredefinedMenuItem::copy(app, None)?,
                Predef::Paste => PredefinedMenuItem::paste(app, None)?,
                Predef::SelectAll => PredefinedMenuItem::select_all(app, None)?,
                Predef::Fullscreen => PredefinedMenuItem::fullscreen(app, None)?,
                Predef::Minimize => PredefinedMenuItem::minimize(app, None)?,
                Predef::Maximize => PredefinedMenuItem::maximize(app, None)?,
            };
            Box::new(p)
        }
        Item::Custom {
            id,
            text,
            accelerator,
        } => Box::new(MenuItem::with_id(app, *id, text, true, *accelerator)?),
        Item::Submenu { id, text, items } => {
            let children = make_all(app, items, about)?;
            let children = refs(&children);
            match id {
                Some(id) => Box::new(Submenu::with_id_and_items(app, *id, text, true, &children)?),
                None => Box::new(Submenu::with_items(app, text, true, &children)?),
            }
        }
    })
}

/// Handles the two custom items. Passed to `Builder::on_menu_event`.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        QUIT_ID => request_quit(app),
        CLOSE_WINDOW_ID => request_close_window(app),
        _ => {}
    }
}

/// Asks the main window to close, which emits `CloseRequested` so the frontend can
/// keep it open; closing the last window then exits the app. Exits directly if
/// there is no main window.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    if !close_main_window(app) {
        app.exit(0);
    }
}

/// The guarded `window.close()` behind the Close Window item. Unlike
/// [`request_quit`] it never exits on its own: with no main window there is
/// nothing to close.
pub fn request_close_window<R: Runtime>(app: &AppHandle<R>) {
    close_main_window(app);
}

/// Returns whether there was a main window to ask.
fn close_main_window<R: Runtime>(app: &AppHandle<R>) -> bool {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => {
            if let Err(e) = window.close() {
                eprintln!("Failed to close the main window: {e}");
            }
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

    fn submenu_named<'a>(items: &'a [Item], text: &str) -> &'a [Item] {
        items
            .iter()
            .find_map(|item| match item {
                Item::Submenu { text: t, items, .. } if t == text => Some(items.as_slice()),
                _ => None,
            })
            .unwrap_or_else(|| panic!("no {text} submenu"))
    }

    /// Close Window is a custom item in both the File and the Window menu, where
    /// the predefined one used to be.
    #[test]
    fn close_window_is_a_custom_item_in_file_and_window() {
        let items = layout("gEdit");
        for menu in ["File", "Window"] {
            let found = submenu_named(&items, menu)
                .iter()
                .filter(|item| **item == close_window())
                .count();
            assert_eq!(found, 1, "{menu} has no custom Close Window");
        }
        assert_eq!(
            close_window(),
            Item::Custom {
                id: "close_window",
                text: "Close Window".to_owned(),
                accelerator: None,
            }
        );
    }

    /// Cmd+Q is ours as well, so that it goes through the close guard (F16).
    #[test]
    fn quit_is_custom_and_names_the_app() {
        let items = layout("gEdit");
        assert!(submenu_named(&items, "gEdit").contains(&Item::Custom {
            id: "quit",
            text: "Quit gEdit".to_owned(),
            accelerator: Some("CmdOrCtrl+Q"),
        }));
    }

    fn flatten(items: &[Item], out: &mut Vec<Item>) {
        for item in items {
            out.push(item.clone());
            if let Item::Submenu { items, .. } = item {
                flatten(items, out);
            }
        }
    }

    /// Cmd+W belongs to the webview from M1 on, so nothing in this menu may claim
    /// it. Quit's is the only accelerator left, and no accelerator anywhere names a
    /// letter with Shift, which AppKit would bind to the unshifted chord (see the
    /// module docs). The `Predef` enum has no Close Window variant, so a predefined
    /// item cannot claim Cmd+W either.
    ///
    /// muda exposes no accelerator getter, and creates items only on the main
    /// thread, so this is as far as cargo can check; the runtime scenario reads the
    /// real menu through `h_menu_dump` and presses the keys.
    #[test]
    fn nothing_claims_cmd_w() {
        let mut all = Vec::new();
        flatten(&layout("gEdit"), &mut all);
        let accelerated: Vec<_> = all
            .iter()
            .filter_map(|item| match item {
                Item::Custom {
                    id,
                    accelerator: Some(accel),
                    ..
                } => Some((*id, *accel)),
                _ => None,
            })
            .collect();
        assert_eq!(accelerated, vec![(QUIT_ID, QUIT_ACCEL)]);
        for (id, accel) in accelerated {
            assert!(
                !accel.to_ascii_uppercase().contains("SHIFT"),
                "{id}: a Shift accelerator binds the unshifted chord on macOS"
            );
        }
    }

    /// Runs `ask` against a mock app with a main window and reports whether the
    /// window saw a `CloseRequested`. That event is what the frontend's
    /// unsaved-changes guard hangs off, so both menu items must raise it rather
    /// than tear the window down.
    fn emits_close_requested(ask: fn(&AppHandle<tauri::test::MockRuntime>)) -> bool {
        let app = mock_builder()
            .setup(move |app| {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?;
                ask(app.handle());
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
        close_requested.load(Ordering::SeqCst)
    }

    /// Cmd+Q must emit `CloseRequested` on the main window (so the frontend's
    /// unsaved-changes guard runs) instead of terminating the app directly.
    #[test]
    fn quit_requests_close_of_main_window() {
        assert!(emits_close_requested(request_quit));
    }

    /// Close Window is the same guarded close, so a dirty document still asks.
    #[test]
    fn close_window_requests_close_of_main_window() {
        assert!(emits_close_requested(request_close_window));
    }
}

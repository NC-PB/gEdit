//! The macOS quit guard (plan §7.10, AD-20, owner decision D27). Owner: WP6.5.
//!
//! The problem it solves: gEdit can veto a window close, but Dock → Quit, ⌘Q from
//! another app's menu and a logout do not go through the window at all. On macOS
//! the application object asks its delegate `applicationShouldTerminate:` and
//! expects an answer **on the spot** — there is no time to ask the webview, and a
//! `Cancel` that arrives a frame later is a lost document (D10).
//!
//! So the state is kept here, in an [`AtomicBool`] the webview updates on every
//! flip of "any document has unsaved changes" ([`quit_guard_set_dirty`], called
//! from `contrib/quitGuard.ts`), and [`decide`] answers from it:
//!
//! * clean → `NSTerminateNow`, the app quits at once;
//! * dirty → `NSTerminateCancel`, the termination is called off and gEdit shows
//!   its own unsaved-changes prompt (the same one the window close uses). A
//!   logout is interrupted, which is what D27 asks for.
//!
//! Windows and Linux cannot veto a session end (F29). There [`install`] does
//! nothing, the command only stores the flag, and the recovery snapshots of M7
//! are the protection — the user guide says so (D28).
//!
//! This is the only file in the backend that talks to Objective-C, and G8 checks
//! that. Everything it does there is best effort: every step is checked, a step
//! that does not answer the way AD-20 expects is logged and gives up, and giving
//! up leaves exactly the Phase 1 behaviour (a Dock quit that is not guarded). A
//! quit guard that cannot be installed must never stop the app from starting, and
//! it must never hold a quit when nothing is dirty.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, State};

/// `NSApplicationTerminateReply.NSTerminateCancel`: do not quit.
pub const TERMINATE_CANCEL: u64 = 0;
/// `NSApplicationTerminateReply.NSTerminateNow`: quit.
pub const TERMINATE_NOW: u64 = 1;

/// Whether any open document has unsaved changes, as the webview last said.
///
/// Managed state, so the command and the delegate method read the same flag.
/// It starts `false`: an app with no documents has nothing to lose.
#[derive(Debug, Default)]
pub struct QuitGuard {
    dirty: AtomicBool,
}

impl QuitGuard {
    /// Stores what the webview says. Called on flips only, not on every keystroke.
    pub fn set_dirty(&self, dirty: bool) {
        self.dirty.store(dirty, Ordering::Relaxed);
    }

    /// The flag as it stands. `Relaxed` is enough: the value is a single bool and
    /// nothing else is published with it.
    // Only the delegate method reads it, and that exists on macOS alone.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::Relaxed)
    }
}

/// What to answer `applicationShouldTerminate:` for a given dirty flag.
///
/// Separate from the Objective-C plumbing so the decision itself is testable on
/// every platform — the rule is the product decision (D27), the delegate is the
/// mechanism.
// Only the delegate method calls it, and that exists on macOS alone.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn decide(dirty: bool) -> u64 {
    if dirty {
        TERMINATE_CANCEL
    } else {
        TERMINATE_NOW
    }
}

/// Installs the termination hook. Called once, from `setup_app`, on the main thread.
///
/// On macOS: read `[NSApp delegate]` and its class, leave a delegate that already
/// answers `applicationShouldTerminate:` alone, otherwise add the method with
/// `class_addMethod(…, c"Q@:@")` and re-assign the same delegate so AppKit refreshes
/// any cached selector check. The method reads the guard through a `OnceLock`, answers
/// [`decide`] and, when dirty, schedules `menu::request_quit` with `run_on_main_thread`
/// so the existing guarded close shows its one combined unsaved-changes alert.
///
/// Everywhere else this is a no-op by design (F29, D28).
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Gives the Close Window items of the application menu their Shift+Cmd+W shortcut.
/// Called from `setup_app` after the menu exists; a no-op off macOS. See
/// [`macos::set_close_window_shortcut`] for why this cannot be a menu accelerator.
pub fn install_menu_shortcuts(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::set_close_window_shortcut(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Tells the backend whether any document has unsaved changes (§7.10).
#[tauri::command]
pub fn quit_guard_set_dirty(guard: State<'_, QuitGuard>, dirty: bool) {
    guard.set_dirty(dirty);
}

/// The Objective-C half (AD-20). Nothing outside this module is `unsafe`.
///
/// The shape follows the two things that can go wrong. AppKit hands out raw
/// pointers, so every one of them is checked before it is used; and the delegate
/// class belongs to tao, not to us, so the method is only *added* — never replaced.
/// A tao that grows its own `applicationShouldTerminate:` therefore keeps it, and
/// gEdit simply goes back to being unguarded (logged, and the user guide's D28 note
/// already describes that state for Windows and Linux).
#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CStr;
    use std::panic::catch_unwind;
    use std::sync::OnceLock;

    use objc2::ffi::{class_addMethod, object_getClass};
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{msg_send, sel};
    use tauri::{AppHandle, Manager};

    use super::{decide, QuitGuard, TERMINATE_NOW};

    /// The type encoding of
    /// `- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender`:
    /// `Q` an `unsigned long` return (`NSUInteger`, F28), then the two implicit
    /// arguments `@` self and `:` the selector, then `@` the sender.
    const ENCODING: &CStr = c"Q@:@";

    /// The handle the added method answers from. A `OnceLock` rather than managed
    /// state because the method is a bare C function: it is handed the delegate, not
    /// anything of ours, so the way back into the app has to be a static.
    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// What [`install_on_class`] did, so the caller can log it and the test can read it.
    #[derive(Debug, PartialEq, Eq)]
    pub(super) enum Outcome {
        /// The class did not answer the selector and now does.
        Added,
        /// The class already answered it; its implementation was left untouched.
        AlreadyThere,
        /// The runtime refused to add the method.
        Refused,
    }

    /// `- applicationShouldTerminate:`, as AppKit calls it: on the main thread, with
    /// an answer expected before it returns.
    ///
    /// `catch_unwind` because unwinding out of here would cross into Objective-C. A
    /// panic must end as a plain quit — refusing to terminate because our own code
    /// broke would trap the user in an app that cannot be closed.
    unsafe extern "C-unwind" fn should_terminate(
        _this: *mut AnyObject,
        _cmd: Sel,
        _sender: *mut AnyObject,
    ) -> u64 {
        catch_unwind(answer).unwrap_or(TERMINATE_NOW)
    }

    /// The answer itself, without any Objective-C in sight.
    fn answer() -> u64 {
        // No handle means `install` never got that far. Phase 1 behaviour: quit.
        let Some(app) = APP.get() else {
            return TERMINATE_NOW;
        };
        let Some(guard) = app.try_state::<QuitGuard>() else {
            eprintln!("The quit guard is not managed; letting the app terminate.");
            return TERMINATE_NOW;
        };
        let dirty = guard.is_dirty();
        if dirty {
            // `run_on_main_thread` is the contract that this lands on the main thread,
            // not a promise that it lands later: called from the main thread, which is
            // where AppKit asks, tauri-runtime-wry 2.11 runs the closure inline. That
            // is still safe, because the close itself is not: a window dispatcher's
            // `close()` deliberately goes through the event-loop proxy whatever thread
            // it is called on, so `request_quit` only *posts* the close and the alert
            // it leads to comes up after `applicationShouldTerminate:` has answered.
            let handle = app.clone();
            if let Err(e) = app.run_on_main_thread(move || crate::menu::request_quit(&handle)) {
                eprintln!("The quit guard could not ask the window to close: {e}");
            }
        }
        decide(dirty)
    }

    /// Adds `applicationShouldTerminate:` to `cls` unless it is already there.
    ///
    /// Split out from [`install`] so the whole decision can be tested on a class the
    /// test builds itself — `NSApp`'s delegate exists only in a running app.
    pub(super) fn install_on_class(cls: &AnyClass) -> Outcome {
        let sel = sel!(applicationShouldTerminate:);
        // A later tao may implement it (F26). Replacing it would break its own quit.
        if cls.responds_to(sel) {
            return Outcome::AlreadyThere;
        }
        let imp: Imp = unsafe {
            std::mem::transmute::<
                unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> u64,
                Imp,
            >(should_terminate)
        };
        // SAFETY: `imp` has the signature `ENCODING` describes, and the selector is
        // not on the class, so nothing is being replaced.
        let added = unsafe {
            class_addMethod(
                (cls as *const AnyClass).cast_mut(),
                sel,
                imp,
                ENCODING.as_ptr(),
            )
        };
        if added.as_bool() {
            Outcome::Added
        } else {
            Outcome::Refused
        }
    }

    /// The whole hook, on the main thread, at setup.
    pub(super) fn install(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            eprintln!("The quit guard is already installed; leaving it as it is.");
            return;
        }
        let Some(ns_app) = shared_application() else {
            eprintln!("The quit guard found no NSApplication; Dock quit stays unguarded.");
            return;
        };
        // SAFETY: `ns_app` is a non-null NSApplication; `delegate` returns an
        // unowned `id` and is not in a method family that transfers ownership.
        let delegate: *mut AnyObject = unsafe { msg_send![ns_app, delegate] };
        if delegate.is_null() {
            eprintln!("The quit guard found no application delegate; Dock quit stays unguarded.");
            return;
        }
        // SAFETY: `delegate` is a non-null object, so it has a class.
        let cls = unsafe { object_getClass(delegate) };
        let Some(cls) = (unsafe { cls.as_ref() }) else {
            eprintln!("The quit guard could not read the delegate's class.");
            return;
        };
        match install_on_class(cls) {
            Outcome::Added => {
                // AppKit may have cached which selectors the delegate answers; setting
                // the same delegate again is the cheap way to make it look afresh.
                // SAFETY: `setDelegate:` takes an `id`, and this is the object AppKit
                // just handed us, so the app keeps exactly the delegate it had.
                unsafe { msg_send![ns_app, setDelegate: delegate] }
            }
            Outcome::AlreadyThere => {
                eprintln!(
                    "The application delegate already answers applicationShouldTerminate:; \
                     the quit guard left it alone and Dock quit stays unguarded."
                );
            }
            Outcome::Refused => {
                eprintln!(
                    "The runtime refused applicationShouldTerminate:; Dock quit stays unguarded."
                );
            }
        }
    }

    /// `NSEventModifierFlagCommand`.
    const COMMAND_MASK: usize = 1 << 20;

    /// Sets Shift+Cmd+W on every menu item titled `title` below `menu` (an `NSMenu`),
    /// recursing into submenus. Returns how many items were changed.
    ///
    /// The key equivalent is the **uppercase** `W` with only Command in the mask:
    /// AppKit takes Shift from the case of the key equivalent and ignores the Shift
    /// bit of the mask, which is why muda's `CmdOrCtrl+Shift+W` ends up on Cmd+W.
    /// The item stays the custom one, so a click or the key goes through
    /// `menu::request_close_window`, i.e. the guarded `window.close()`.
    pub(super) fn set_shortcut_in_menu(menu: *mut AnyObject, title: &CStr) -> usize {
        if menu.is_null() {
            return 0;
        }
        let mut changed = 0;
        // SAFETY: `menu` is a non-null NSMenu; `itemArray` and the element getters
        // return unowned objects that live as long as the menu, and every pointer
        // taken from them is checked before use. Main thread only (callers).
        unsafe {
            let items: *mut AnyObject = msg_send![menu, itemArray];
            if items.is_null() {
                return 0;
            }
            let count: usize = msg_send![items, count];
            for i in 0..count {
                let item: *mut AnyObject = msg_send![items, objectAtIndex: i];
                if item.is_null() {
                    continue;
                }
                let sub: *mut AnyObject = msg_send![item, submenu];
                changed += set_shortcut_in_menu(sub, title);
                let t: *const std::ffi::c_char = {
                    let ns: *mut AnyObject = msg_send![item, title];
                    if ns.is_null() {
                        std::ptr::null()
                    } else {
                        msg_send![ns, UTF8String]
                    }
                };
                if t.is_null() || CStr::from_ptr(t) != title {
                    continue;
                }
                let Some(ns_string) = AnyClass::get(c"NSString") else {
                    continue;
                };
                let key: *mut AnyObject = msg_send![ns_string, stringWithUTF8String: c"W".as_ptr()];
                if key.is_null() {
                    continue;
                }
                let _: () = msg_send![item, setKeyEquivalent: key];
                let _: () = msg_send![item, setKeyEquivalentModifierMask: COMMAND_MASK];
                changed += 1;
            }
        }
        changed
    }

    /// The Close Window items of the application's main menu get Shift+Cmd+W.
    /// Best effort and logged: without it the webview's own Mod+Shift+W still closes
    /// the window through the same guard, only the menu loses its shortcut text.
    pub(super) fn set_close_window_shortcut(_app: &AppHandle) {
        let Some(ns_app) = shared_application() else {
            eprintln!("No NSApplication; Close Window keeps no menu shortcut.");
            return;
        };
        // SAFETY: `mainMenu` returns an unowned NSMenu or nil.
        let main: *mut AnyObject = unsafe { msg_send![ns_app, mainMenu] };
        let n = set_shortcut_in_menu(main, c"Close Window");
        if n == 0 {
            eprintln!("The main menu has no Close Window item yet; no shortcut was set.");
        }
    }

    /// `[NSApplication sharedApplication]`, or `None` when there is no AppKit to ask.
    ///
    /// **Never call this before the event loop exists.** `+sharedApplication` creates
    /// the application object if there is none, and tao wants to create it itself, as a
    /// subclass of its own. [`install`] is safe because it runs from `setup`, and by
    /// then tao has built the event loop, made the application and set the delegate
    /// (F26) — which is also why a null delegate here means the ordering changed under
    /// us and the right thing to do is to give up.
    fn shared_application() -> Option<*mut AnyObject> {
        let cls = AnyClass::get(c"NSApplication")?;
        // SAFETY: `+sharedApplication` takes no argument and answers the one
        // application object, which it does not transfer ownership of.
        let ns_app: *mut AnyObject = unsafe { msg_send![cls, sharedApplication] };
        (!ns_app.is_null()).then_some(ns_app)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use objc2::runtime::{ClassBuilder, NSObject};
        use objc2::ClassType;

        unsafe fn new_obj(cls: &CStr) -> *mut AnyObject {
            let c = AnyClass::get(cls).expect("AppKit is linked");
            let o: *mut AnyObject = msg_send![c, alloc];
            msg_send![o, init]
        }

        unsafe fn ns(s: &CStr) -> *mut AnyObject {
            let c = AnyClass::get(c"NSString").unwrap();
            msg_send![c, stringWithUTF8String: s.as_ptr()]
        }

        /// A File and a Window submenu each hold a Close Window; both get an
        /// uppercase W with Command only, and other items are left alone.
        #[test]
        fn close_window_items_get_shift_cmd_w() {
            unsafe {
                let root = new_obj(c"NSMenu");
                let mut close_items = Vec::new();
                for name in [c"File", c"Window"] {
                    let top: *mut AnyObject = new_obj(c"NSMenuItem");
                    let sub = new_obj(c"NSMenu");
                    let close: *mut AnyObject = new_obj(c"NSMenuItem");
                    let _: () = msg_send![close, setTitle: ns(c"Close Window")];
                    let other: *mut AnyObject = new_obj(c"NSMenuItem");
                    let _: () = msg_send![other, setTitle: ns(c"Minimize")];
                    let _: () = msg_send![sub, addItem: other];
                    let _: () = msg_send![sub, addItem: close];
                    let _: () = msg_send![top, setTitle: ns(name)];
                    let _: () = msg_send![top, setSubmenu: sub];
                    let _: () = msg_send![root, addItem: top];
                    close_items.push((close, other));
                }
                assert_eq!(set_shortcut_in_menu(root, c"Close Window"), 2);
                for (close, other) in close_items {
                    let key: *mut AnyObject = msg_send![close, keyEquivalent];
                    let utf8: *const std::ffi::c_char = msg_send![key, UTF8String];
                    assert_eq!(CStr::from_ptr(utf8), c"W");
                    let mask: usize = msg_send![close, keyEquivalentModifierMask];
                    assert_eq!(mask, COMMAND_MASK);
                    let key: *mut AnyObject = msg_send![other, keyEquivalent];
                    let utf8: *const std::ffi::c_char = msg_send![key, UTF8String];
                    assert_eq!(CStr::from_ptr(utf8), c"");
                }
            }
        }

        /// Stands in for a tao that grew its own answer. The value is distinctive so
        /// the test can tell it apart from [`super::should_terminate`].
        unsafe extern "C-unwind" fn other_answer(
            _this: *mut AnyObject,
            _cmd: Sel,
            _sender: *mut AnyObject,
        ) -> u64 {
            7
        }

        fn empty_class(name: &CStr) -> &'static AnyClass {
            ClassBuilder::new(name, NSObject::class())
                .expect("the test class name is unique")
                .register()
        }

        /// The delegate tao builds today (F26): no `applicationShouldTerminate:`.
        #[test]
        fn a_delegate_without_the_selector_gets_it() {
            let cls = empty_class(c"GEditQuitGuardTestPlainDelegate");
            let sel = sel!(applicationShouldTerminate:);
            assert!(!cls.responds_to(sel), "the test class starts without it");

            assert_eq!(install_on_class(cls), Outcome::Added);

            assert!(
                cls.responds_to(sel),
                "respondsToSelector: is YES afterwards"
            );
        }

        /// A later tao that answers it already keeps its own implementation (AD-20).
        #[test]
        fn a_delegate_that_already_answers_is_left_alone() {
            let sel = sel!(applicationShouldTerminate:);
            let mut builder =
                ClassBuilder::new(c"GEditQuitGuardTestAnsweringDelegate", NSObject::class())
                    .expect("the test class name is unique");
            // SAFETY: the signature matches `ENCODING`, the same one AppKit calls with.
            unsafe {
                builder.add_method::<AnyObject, _>(
                    sel,
                    other_answer
                        as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> u64,
                );
            }
            let cls = builder.register();
            let before = cls
                .instance_method(sel)
                .expect("just added")
                .implementation();

            assert_eq!(install_on_class(cls), Outcome::AlreadyThere);

            let after = cls
                .instance_method(sel)
                .expect("still there")
                .implementation();
            assert_eq!(
                before as usize, after as usize,
                "the class keeps the implementation it had"
            );
        }

        /// Before `install`, and after a failed one, the method must not hold a quit.
        #[test]
        fn without_a_handle_the_answer_is_terminate_now() {
            assert!(APP.get().is_none(), "no test installs a real app handle");
            assert_eq!(answer(), TERMINATE_NOW);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// D27: a dirty document cancels the termination, a clean app quits at once.
    #[test]
    fn decide_cancels_only_while_something_is_unsaved() {
        assert_eq!(decide(true), TERMINATE_CANCEL);
        assert_eq!(decide(false), TERMINATE_NOW);
    }

    #[test]
    fn the_guard_starts_clean_and_follows_the_webview() {
        let guard = QuitGuard::default();
        assert!(!guard.is_dirty());
        guard.set_dirty(true);
        assert!(guard.is_dirty());
        guard.set_dirty(false);
        assert!(!guard.is_dirty());
    }
}

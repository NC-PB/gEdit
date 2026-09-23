//! The list of files that were open when gEdit was last closed (plan §7.10,
//! AD-22). Stub written by the M7 prelude (P7); **WP7.1** owns it.
//!
//! Rust owns the list, in the `session` member of `state.json`, for the same reason
//! it owns `recent` (P1 AD-9): reopening a file at start needs that path to be in the
//! fs scope **before** the webview asks for it, and only Rust can widen the scope.
//! [`grant_on_startup`] does that, for the paths as written and canonicalized, which
//! is the bounded widening of D6; [`session_save`] keeps only paths the scope already
//! allows, so the webview cannot smuggle a path in through this list either.
//!
//! The webview side (which tab is active, when the list is written, what happens to a
//! file that has gone) is `app/session.ts`; here there is only the file and the scope.
//!
//! **`active` travels with its path.** It is an index, so dropping a path that the
//! scope does not allow renumbers everything after it. A save that filtered the list
//! without moving the index would restore the wrong tab — and restoring the wrong tab
//! is how a session restore starts looking untrustworthy. [`SessionState::keep`] moves
//! it, and forgets it when its own path did not survive.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::paths::{self, AppDirs};
use crate::state::{self, StateWrite};

/// The most files one session restores. A window with more tabs than this is not a
/// session anyone meant to keep, and every entry costs a grant and a file read at
/// start (§7.10, AD-22).
pub const MAX_SESSION_PATHS: usize = 50;

/// How many of the paths a save is handed are looked at all.
///
/// Four times what is stored, so that dropping a handful of tabs the scope does not
/// allow never costs a path that would have been kept, while the work one call can
/// ask for stays bounded whatever the webview sends: `is_allowed` walks the scope's
/// allow list for every path, and that list already holds a grant per recent file.
const MAX_SCANNED_PATHS: usize = MAX_SESSION_PATHS * 4;

/// `state.json` → `session`. Serialized in camelCase, matching `SessionState` in
/// `src/lib/platform/commands.ts`.
///
/// `active` is an **index into `paths`**, not a document id: ids do not survive a
/// restart. An index that no longer has a path is simply ignored by the restore.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub paths: Vec<String>,
    pub active: Option<u32>,
}

impl SessionState {
    /// The session as the file holds it, read the way [`crate::state::read_state`]
    /// reads `recent`: leniently, because this member can be hand-edited and a
    /// mistake in it may not stop the app from starting. Anything that is not a
    /// non-empty string is dropped, and an `active` that points past the list is
    /// forgotten rather than restored onto some other tab.
    ///
    /// The list is cut to [`MAX_SESSION_PATHS`] **here**, on the read side, and not
    /// only where it is written: `grant_on_startup` stops after that many paths have
    /// *passed* its existence check, so a hand-edited list of 100,000 names would
    /// otherwise be walked and stat'd in full before the window appears (the same
    /// trap `read_state` documents for `recent`).
    pub fn from_value(value: Option<&Value>) -> Self {
        let Some(Value::Object(object)) = value else {
            return Self::default();
        };
        let mut paths: Vec<String> = object
            .get("paths")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|path| !path.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        paths.truncate(MAX_SESSION_PATHS);
        let active = object
            .get("active")
            .and_then(Value::as_u64)
            .filter(|index| (*index as usize) < paths.len())
            .map(|index| index as u32);
        Self { paths, active }
    }

    /// The list as it may be stored: only paths `allowed` agrees to, at most
    /// [`MAX_SESSION_PATHS`] of them, with `active` moved to wherever its own path
    /// ended up — or dropped, when that path was not one of the ones kept.
    ///
    /// A path the scope does not allow is not an error. A tab opened from a dialog
    /// in this session is allowed; one that somehow is not has no business being
    /// reopened without the user picking it again, and refusing the whole call would
    /// throw away the other 49 tabs with it.
    pub fn keep(paths: Vec<String>, active: Option<u32>, allowed: impl Fn(&str) -> bool) -> Self {
        let active = active.map(|index| index as usize);
        let mut kept: Vec<String> = Vec::new();
        let mut moved = None;
        for (index, path) in paths.into_iter().take(MAX_SCANNED_PATHS).enumerate() {
            if kept.len() == MAX_SESSION_PATHS {
                break;
            }
            if path.is_empty() || !allowed(&path) {
                continue;
            }
            if active == Some(index) {
                moved = Some(kept.len() as u32);
            }
            kept.push(path);
        }
        Self {
            paths: kept,
            active: moved,
        }
    }
}

/// The body of [`session_save`], without the fs-scope check: that one needs the app
/// handle and is the command's own first step.
///
/// The write goes through [`crate::state::update_state`], so it cannot race the
/// webview's `ui` save or a recent-list change — all three edit one document, and a
/// tab change triggers two of them a second apart.
pub fn save(dirs: &AppDirs, session: &SessionState) -> Result<(), String> {
    let value = serde_json::to_value(session)
        .map_err(|err| format!("{}: {err}", crate::paths::STATE_FILE_NAME))?;
    state::update_state(&dirs.state_file(), |state| {
        Ok((
            StateWrite {
                recent: state.recent.clone(),
                ui: state.ui.clone(),
                session: Some(value),
            },
            (),
        ))
    })
}

/// The body of [`session_load`].
pub fn load(dirs: &AppDirs) -> SessionState {
    let state = state::read_state(&dirs.state_file());
    SessionState::from_value(state.file.value.get(state::SESSION_KEY))
}

/// Replaces the stored session list. Paths the fs scope does not allow are dropped
/// (not an error: a tab opened from a dialog in this session is allowed, one that
/// was never granted has no business being reopened without one), and the list is
/// truncated to [`MAX_SESSION_PATHS`].
///
/// An empty list is written like any other: closing every tab and quitting means the
/// next start opens nothing, not that the session before it comes back.
#[tauri::command]
pub fn session_save(app: AppHandle, paths: Vec<String>, active: Option<u32>) -> Result<(), String> {
    let scope = app.fs_scope();
    let session = SessionState::keep(paths, active, |path| scope.is_allowed(path));
    save(&paths::app_dirs(&app)?, &session)
}

/// The stored session. Infallible on purpose, like `recent_list`: a broken
/// `state.json` answers with an empty session rather than an error, because nothing
/// about restoring the last window may stop the app from starting.
#[tauri::command]
pub fn session_load(app: AppHandle) -> SessionState {
    match paths::app_dirs(&app) {
        Ok(dirs) => load(&dirs),
        Err(_) => SessionState::default(),
    }
}

/// Grants the stored session paths that still exist to the fs scope, as written and
/// canonicalized, so the webview can reopen them without a dialog. Called from
/// `setup_app`, before the window appears. Never fails and never panics: a home
/// directory that cannot be read means "no session", not "no editor".
///
/// Nothing is granted for a path that is gone: the webview reports it as missing
/// (AD-22) and the user picks it again if it comes back.
pub fn grant_on_startup(app: &AppHandle) {
    let Ok(dirs) = paths::app_dirs(app) else {
        return;
    };
    let session = load(&dirs);
    state::grant_paths(&app.fs_scope(), &session.paths, MAX_SESSION_PATHS);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// The wire shape is a contract with `platform/commands.ts`: `active` is an
    /// index and may be absent, and both members are camelCase.
    #[test]
    fn the_session_serializes_as_the_webview_reads_it() {
        let state = SessionState {
            paths: vec!["/nc/a.nc".to_owned(), "/nc/b.nc".to_owned()],
            active: Some(1),
        };
        assert_eq!(
            serde_json::to_value(&state).unwrap(),
            serde_json::json!({ "paths": ["/nc/a.nc", "/nc/b.nc"], "active": 1 })
        );
        assert_eq!(
            serde_json::to_value(SessionState::default()).unwrap(),
            serde_json::json!({ "paths": [], "active": null })
        );
        // And it reads back what an older or hand-edited file may hold.
        let parsed: SessionState =
            serde_json::from_value(serde_json::json!({ "paths": ["/x.nc"] })).unwrap();
        assert_eq!(parsed.paths, vec!["/x.nc".to_owned()]);
        assert_eq!(parsed.active, None);
    }

    /// AD-22 caps the list at 50, and P1 AD-9 grants at most 50 recent entries, so a
    /// start can never widen the scope without bound.
    #[test]
    fn the_cap_matches_the_startup_grant_budget() {
        assert_eq!(MAX_SESSION_PATHS, 50);
        assert_eq!(MAX_SESSION_PATHS, crate::state::MAX_GRANTED_ON_STARTUP);
    }

    /// Standing rule 8 (G8): no path from the webview is used here without the fs
    /// scope agreeing first. This pins the signatures and that `session_save` asks
    /// the scope before it builds anything out of what it was sent.
    #[test]
    fn the_commands_keep_their_pinned_signatures() {
        let source = include_str!("session.rs");
        for command in [
            concat!(
                "pub fn session_",
                "save(app: AppHandle, paths: Vec<String>, active: Option<u32>) -> Result<(), String>"
            ),
            concat!("pub fn session_", "load(app: AppHandle) -> SessionState"),
            concat!("pub fn grant_on_", "startup(app: &AppHandle)"),
        ] {
            assert!(source.contains(command), "missing or changed: {command}");
        }
        let signature = concat!(
            "pub fn session_",
            "save(app: AppHandle, paths: Vec<String>, active: Option<u32>) -> Result<(), String> {"
        );
        let at = source.find(signature).expect("the signature changed");
        let body = &source[at + signature.len()..];
        let asked = body
            .find(concat!("is_", "allowed(path)"))
            .expect("no fs-scope check");
        assert!(
            !body[..asked].contains("app_dirs"),
            "the state file is reached before the scope is asked"
        );
    }

    // --- what may be stored --------------------------------------------------

    fn list(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path| (*path).to_owned()).collect()
    }

    #[test]
    fn only_paths_the_scope_allows_are_kept() {
        let kept = SessionState::keep(
            list(&["/nc/a.nc", "/etc/passwd", "", "/nc/b.nc"]),
            None,
            |path| path.starts_with("/nc/"),
        );
        assert_eq!(kept.paths, list(&["/nc/a.nc", "/nc/b.nc"]));
        assert_eq!(kept.active, None);
    }

    /// The index is worth nothing on its own: it has to end up on the same file it
    /// started on. Filtering without moving it restores the wrong tab.
    #[test]
    fn the_active_index_follows_its_own_path() {
        let paths = list(&["/no/a.nc", "/nc/b.nc", "/no/c.nc", "/nc/d.nc"]);
        let allowed = |path: &str| path.starts_with("/nc/");

        // `/nc/d.nc` was active at index 3 and is second in what is kept.
        let kept = SessionState::keep(paths.clone(), Some(3), allowed);
        assert_eq!(kept.paths, list(&["/nc/b.nc", "/nc/d.nc"]));
        assert_eq!(kept.active, Some(1));

        // The active tab was one of the dropped ones: no tab is restored active,
        // rather than some other file being focused in its place.
        assert_eq!(
            SessionState::keep(paths.clone(), Some(2), allowed).active,
            None
        );
        // An index past the end of the list is not an error either.
        assert_eq!(SessionState::keep(paths, Some(99), allowed).active, None);
    }

    #[test]
    fn the_list_stops_at_fifty_entries() {
        let many: Vec<String> = (0..MAX_SESSION_PATHS + 20)
            .map(|n| format!("/nc/f{n}.nc"))
            .collect();
        let kept = SessionState::keep(many.clone(), Some(3), |_| true);
        assert_eq!(kept.paths.len(), MAX_SESSION_PATHS);
        assert_eq!(kept.paths[0], "/nc/f0.nc");
        assert_eq!(kept.active, Some(3));

        // A tab past the cap cannot be the active one, because it is not stored.
        assert_eq!(
            SessionState::keep(many, Some(MAX_SESSION_PATHS as u32 + 1), |_| true).active,
            None
        );
    }

    /// Whatever the webview sends, the number of scope questions this call asks is
    /// bounded.
    #[test]
    fn a_huge_list_is_not_walked_to_the_end() {
        let asked = std::cell::Cell::new(0);
        let many: Vec<String> = (0..10_000).map(|n| format!("/no/f{n}.nc")).collect();
        let kept = SessionState::keep(many, None, |_| {
            asked.set(asked.get() + 1);
            false
        });
        assert_eq!(kept.paths, Vec::<String>::new());
        assert_eq!(asked.get(), MAX_SCANNED_PATHS);
    }

    // --- what the file holds -------------------------------------------------

    #[test]
    fn a_hand_edited_session_is_read_as_far_as_it_makes_sense() {
        // Not an object at all.
        assert_eq!(SessionState::from_value(None), SessionState::default());
        assert_eq!(
            SessionState::from_value(Some(&serde_json::json!("nonsense"))),
            SessionState::default()
        );
        // Members that are not non-empty strings are dropped, and `active` is only
        // kept while it points at a path that is still there.
        assert_eq!(
            SessionState::from_value(Some(&serde_json::json!({
                "paths": ["/nc/a.nc", 7, "", null, "/nc/b.nc"],
                "active": 3
            }))),
            SessionState {
                paths: list(&["/nc/a.nc", "/nc/b.nc"]),
                active: None
            }
        );
        assert_eq!(
            SessionState::from_value(Some(&serde_json::json!({
                "paths": ["/nc/a.nc", "/nc/b.nc"], "active": 1
            })))
            .active,
            Some(1)
        );
        // A list far past the cap is cut on the way in, so the startup grant never
        // stats more than it is allowed to grant.
        let long: Vec<Value> = (0..1_000)
            .map(|n| Value::String(format!("/nc/f{n}.nc")))
            .collect();
        assert_eq!(
            SessionState::from_value(Some(&serde_json::json!({ "paths": long })))
                .paths
                .len(),
            MAX_SESSION_PATHS
        );
    }

    // --- the round trip through `state.json` ---------------------------------

    fn scratch_dirs(name: &str) -> (PathBuf, AppDirs) {
        let root =
            std::env::temp_dir().join(format!("gedit-session-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        dirs.ensure();
        (root, dirs)
    }

    #[test]
    fn the_session_survives_a_round_trip_through_the_file() {
        let (root, dirs) = scratch_dirs("round-trip");
        assert_eq!(load(&dirs), SessionState::default());

        let session = SessionState {
            paths: list(&["/nc/a.nc", "/nc/b.nc"]),
            active: Some(1),
        };
        save(&dirs, &session).unwrap();
        assert_eq!(load(&dirs), session);

        // Closing every tab is a session too, not "keep the last one".
        save(&dirs, &SessionState::default()).unwrap();
        assert_eq!(load(&dirs), SessionState::default());
        let _ = fs::remove_dir_all(&root);
    }

    /// `state.json` is shared. A session write may not disturb the recent list, the
    /// webview's `ui`, or a member a newer build wrote that this one knows nothing
    /// about.
    #[test]
    fn saving_the_session_keeps_every_other_member() {
        let (root, dirs) = scratch_dirs("other-members");
        let file = dirs.state_file();
        fs::write(
            &file,
            serde_json::to_vec_pretty(&serde_json::json!({
                "$version": 1,
                "recent": ["/nc/old.nc"],
                "ui": { "layout": { "sidebar": 240 } },
                "somethingNewer": { "kept": true }
            }))
            .unwrap(),
        )
        .unwrap();

        save(
            &dirs,
            &SessionState {
                paths: list(&["/nc/a.nc"]),
                active: Some(0),
            },
        )
        .unwrap();

        let after: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(
            after,
            serde_json::json!({
                "$version": 1,
                "recent": ["/nc/old.nc"],
                "ui": { "layout": { "sidebar": 240 } },
                "somethingNewer": { "kept": true },
                "session": { "paths": ["/nc/a.nc"], "active": 0 }
            })
        );
        // And the other way round: a `ui` save leaves the session alone.
        crate::state::save_ui(&dirs, serde_json::json!({ "lastScript": "bundled:x.py" })).unwrap();
        assert_eq!(load(&dirs).paths, list(&["/nc/a.nc"]));
        let _ = fs::remove_dir_all(&root);
    }

    // --- the startup grant ---------------------------------------------------

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("could not build the mock app")
    }

    /// The point of the startup grant: a file from the last session reopens without
    /// a dialog, and the grant covers the canonical spelling too, because
    /// `is_allowed` canonicalizes what it is asked about and the temp directory on
    /// macOS is reached through a symlink.
    #[test]
    fn the_stored_session_is_granted_before_the_window_appears() {
        let (root, dirs) = scratch_dirs("grant");
        let here = root.join("a.nc");
        fs::write(&here, b"G0\n").unwrap();
        let gone = root.join("gone.nc");
        let untouched = root.join("b.nc");
        fs::write(&untouched, b"G0\n").unwrap();

        save(
            &dirs,
            &SessionState {
                paths: list(&[here.to_str().unwrap(), gone.to_str().unwrap()]),
                active: Some(0),
            },
        )
        .unwrap();

        let app = mock_app();
        let scope = app.fs_scope();
        assert!(!scope.is_allowed(&here));

        let session = load(&dirs);
        assert_eq!(
            state::grant_paths(&scope, &session.paths, MAX_SESSION_PATHS),
            1
        );
        assert!(scope.is_allowed(&here));
        // The canonical spelling of the same file, which is what `is_allowed`
        // compares against.
        assert!(scope.is_allowed(fs::canonicalize(&here).unwrap()));
        // A file that is gone is not granted ahead of time, and a file that was
        // never in the session stays out.
        assert!(!scope.is_allowed(&gone));
        assert!(!scope.is_allowed(&untouched));
        let _ = fs::remove_dir_all(&root);
    }
}

//! The list of files that were open when gEdit was last closed (plan §7.10,
//! AD-22). Built by WP7.1.
//!
//! Rust owns the list, in the `session` member of `state.json`, for the same reason
//! it owns `recent` (P1 AD-9): reopening a file at start needs that path to be in the
//! fs scope **before** the webview asks for it, and only Rust can widen the scope.
//! [`grant_on_startup`] does that, for the paths as written and canonicalized, which
//! is the bounded widening of D6; [`session_save`] keeps only paths the scope already
//! allows **or that the stored list already held**, so the webview cannot smuggle a
//! new path in through this list either.
//!
//! The webview side (which tab is active, when the list is written, what happens to a
//! file that has gone) is `app/session.ts`; here there is only the file and the scope.
//!
//! **`active` travels with its path.** It is an index, so dropping a path that the
//! scope does not allow renumbers everything after it. A save that filtered the list
//! without moving the index would restore the wrong tab — and restoring the wrong tab
//! is how a session restore starts looking untrustworthy. [`SessionState::keep`] moves
//! it, and forgets it when its own path did not survive.
//!
//! **A file that is offline at start stays in the list**. A share that
//! mounts after login, or a USB stick that is not in, is not granted at start (nothing
//! is granted for a path that is not there), so the scope refuses it at the first save
//! — and before this rule the first tab change dropped it for good. Now a refused path
//! survives a save when the stored list already held it: keeping a path in the list is
//! not granting it, and the list can still only hold paths that were allowed when they
//! entered it (or were written into `state.json` by hand, which the startup grant
//! trusts already).
//!
//! **But not forever.** A deleted program would otherwise be skipped, with its status
//! line, at every start until the end of time. `session.missing` counts, per path, the
//! starts in a row at which it was not there and when that began; a path is dropped by
//! the start that finds it missing for the [`MISSING_STARTS_BEFORE_DROP`]th time in a
//! row, **and** at least [`MISSING_SECS_BEFORE_DROP`] after it was first missed. Both,
//! so that neither a morning of restarts nor a holiday with the laptop away from the
//! office network loses the list; one start that finds the file again resets the count.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Duration;

use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::files;
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

/// A stored path that was missing at this many starts in a row may be dropped …
pub const MISSING_STARTS_BEFORE_DROP: u32 = 5;

/// … once it has also been missing for this long (14 days, in seconds).
pub const MISSING_SECS_BEFORE_DROP: u64 = 14 * 24 * 60 * 60;

/// `state.json` → `session` → `missing`: the bookkeeping behind the two limits above.
/// Rust's own; `session_load` never sends it.
const MISSING_KEY: &str = "missing";

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
        Self::keep_by(paths, active, |_, path| allowed(path))
    }

    /// [`Self::keep`] with the position of each path in what was sent, for a caller
    /// whose answers were worked out ahead, one per position.
    fn keep_by(
        paths: Vec<String>,
        active: Option<u32>,
        mut allowed: impl FnMut(usize, &str) -> bool,
    ) -> Self {
        let active = active.map(|index| index as usize);
        let mut kept: Vec<String> = Vec::new();
        let mut moved = None;
        for (index, path) in paths.into_iter().take(MAX_SCANNED_PATHS).enumerate() {
            if kept.len() == MAX_SESSION_PATHS {
                break;
            }
            if path.is_empty() || !allowed(index, &path) {
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

/// How long one stored path has been missing at start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Missing {
    /// When the first start that missed it ran, in seconds since 1970.
    pub since: u64,
    /// How many starts in a row have missed it.
    pub starts: u32,
}

/// The whole `session` member: the list, plus the bookkeeping for its paths that were
/// not there at the last start. `missing` only ever names paths that are in the list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StoredSession {
    pub session: SessionState,
    pub missing: BTreeMap<String, Missing>,
}

impl StoredSession {
    /// Read as leniently as [`SessionState::from_value`]: a `missing` entry that is not
    /// `{ since, starts }` with whole numbers, or that names a path the list does not
    /// hold, is dropped — which only ever makes a path wait longer before it goes.
    pub fn from_value(value: Option<&Value>) -> Self {
        let session = SessionState::from_value(value);
        let listed: HashSet<&str> = session.paths.iter().map(String::as_str).collect();
        let missing = value
            .and_then(|value| value.get(MISSING_KEY))
            .and_then(Value::as_object)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|(path, _)| listed.contains(path.as_str()))
                    .filter_map(|(path, entry)| {
                        let since = entry.get("since")?.as_u64()?;
                        let starts = u32::try_from(entry.get("starts")?.as_u64()?).ok()?;
                        Some((path.clone(), Missing { since, starts }))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { session, missing }
    }

    /// The member as it is written: `paths` and `active` as the webview reads them, and
    /// `missing` only while there is something in it.
    pub fn to_value(&self) -> Value {
        let mut object = Map::new();
        object.insert("paths".to_owned(), serde_json::json!(self.session.paths));
        object.insert("active".to_owned(), serde_json::json!(self.session.active));
        if !self.missing.is_empty() {
            let missing: Map<String, Value> = self
                .missing
                .iter()
                .map(|(path, entry)| {
                    (
                        path.clone(),
                        serde_json::json!({ "since": entry.since, "starts": entry.starts }),
                    )
                })
                .collect();
            object.insert(MISSING_KEY.to_owned(), Value::Object(missing));
        }
        Value::Object(object)
    }

    /// One start: every listed path that is `present` is no longer missing, every other
    /// one has been missing one start more, and a path past both limits is dropped
    /// (with `active` following, as in [`SessionState::keep`]).
    pub fn note_start(&self, present: impl Fn(&str) -> bool, now: u64) -> Self {
        let mut missing = BTreeMap::new();
        let mut dropped: HashSet<&str> = HashSet::new();
        for path in &self.session.paths {
            if present(path) || missing.contains_key(path) || dropped.contains(path.as_str()) {
                continue;
            }
            let before = self.missing.get(path).copied().unwrap_or(Missing {
                since: now,
                starts: 0,
            });
            let entry = Missing {
                since: before.since,
                starts: before.starts.saturating_add(1),
            };
            // A clock that went backwards reads as "not long yet": the safe direction.
            if entry.starts >= MISSING_STARTS_BEFORE_DROP
                && now.saturating_sub(entry.since) >= MISSING_SECS_BEFORE_DROP
            {
                dropped.insert(path);
            } else {
                missing.insert(path.clone(), entry);
            }
        }
        let session = SessionState::keep(self.session.paths.clone(), self.session.active, |path| {
            !dropped.contains(path)
        });
        Self { session, missing }
    }
}

/// Reads the `session` member under the state lock, lets `change` answer with the new
/// one, and writes it back.
fn update(
    dirs: &AppDirs,
    change: impl FnOnce(&StoredSession) -> StoredSession,
) -> Result<(), String> {
    state::update_state(&dirs.state_file(), |state| {
        let stored = StoredSession::from_value(state.file.value.get(state::SESSION_KEY));
        Ok((
            StateWrite {
                recent: state.recent.clone(),
                ui: state.ui.clone(),
                session: Some(change(&stored).to_value()),
            },
            (),
        ))
    })
}

/// The whole `session` member as the file holds it.
fn load_stored(dirs: &AppDirs) -> StoredSession {
    let state = state::read_state(&dirs.state_file());
    StoredSession::from_value(state.file.value.get(state::SESSION_KEY))
}

/// The scope's answer for each path a save was handed, worked out before the state
/// file is touched (G8), at most [`MAX_SCANNED_PATHS`] of them.
///
/// **Within [`files::STAT_BUDGET`]** ([`files::run_bounded`]). `Scope::is_allowed`
/// canonicalizes, and on a share that hangs that blocks for as long as the OS retries —
/// and the webview carries a path it could not reach at start into every save, so one
/// hung share used to freeze the save at every tab change. A path that has not answered
/// in time reads as refused: [`save`] then keeps it when the stored list holds it (the
/// offline rule) and leaves a new one out until a save that can reach it.
fn judge(
    paths: Vec<String>,
    allowed: impl Fn(&str) -> bool + Send + Sync + 'static,
) -> Vec<(String, bool)> {
    judge_within(paths, files::STAT_BUDGET, allowed)
}

/// [`judge`] with the time budget injected, for the tests.
fn judge_within(
    paths: Vec<String>,
    budget: Duration,
    allowed: impl Fn(&str) -> bool + Send + Sync + 'static,
) -> Vec<(String, bool)> {
    let paths: Vec<String> = paths.into_iter().take(MAX_SCANNED_PATHS).collect();
    // An empty path is never asked about.
    let asked: Vec<String> = paths
        .iter()
        .filter(|path| !path.is_empty())
        .cloned()
        .collect();
    let answers = files::run_bounded(asked.clone(), budget, move |path| allowed(path));
    let verdicts: HashMap<String, bool> = asked
        .into_iter()
        .zip(answers)
        .map(|(path, answer)| (path, answer.unwrap_or(false)))
        .collect();
    paths
        .into_iter()
        .map(|path| {
            let ok = verdicts.get(&path).copied().unwrap_or(false);
            (path, ok)
        })
        .collect()
}

/// The body of [`session_save`], once the scope has answered for every path.
///
/// A path the scope refused is kept when the stored list already holds it: that is a
/// file that was offline at start and so never granted, and the webview carries it on
/// for exactly that reason. `missing` keeps its entries only for the paths that survive
/// **refused**: a path the scope allows now was reachable in this run, whatever the start
/// counted — a startup grant that lands after its budget opens the file all the same, and
/// its count must not go on growing until the rule drops a file that is open.
///
/// The write goes through [`crate::state::update_state`], so it cannot race the
/// webview's `ui` save or a recent-list change — all three edit one document, and a
/// tab change triggers two of them a second apart.
pub fn save(
    dirs: &AppDirs,
    judged: Vec<(String, bool)>,
    active: Option<u32>,
) -> Result<(), String> {
    let allowed_now: HashSet<String> = judged
        .iter()
        .filter(|(_, ok)| *ok)
        .map(|(path, _)| path.clone())
        .collect();
    update(dirs, |stored| {
        let listed: HashSet<&str> = stored.session.paths.iter().map(String::as_str).collect();
        let (paths, verdicts): (Vec<String>, Vec<bool>) = judged.into_iter().unzip();
        let session = SessionState::keep_by(paths, active, |at, path| {
            verdicts.get(at).copied().unwrap_or(false) || listed.contains(path)
        });
        let missing = stored
            .missing
            .iter()
            .filter(|(path, _)| session.paths.contains(path) && !allowed_now.contains(*path))
            .map(|(path, entry)| (path.clone(), *entry))
            .collect();
        StoredSession { session, missing }
    })
}

/// The body of [`session_load`].
pub fn load(dirs: &AppDirs) -> SessionState {
    let state = state::read_state(&dirs.state_file());
    SessionState::from_value(state.file.value.get(state::SESSION_KEY))
}

/// Replaces the stored session list. Paths the fs scope does not allow are dropped
/// (not an error: a tab opened from a dialog in this session is allowed, one that
/// was never granted has no business being reopened without one) — unless the stored
/// list already held them, which is a file that was offline at start — and the list
/// is truncated to [`MAX_SESSION_PATHS`].
///
/// An empty list is written like any other: closing every tab and quitting means the
/// next start opens nothing, not that the session before it comes back.
///
/// `async`, and the work is on the blocking pool: a plain `fn` command runs on the main
/// thread (`tauri-macros` 2.6 `ExecutionContext::Blocking`), and the scope check touches
/// every path, a hung share's among them (see [`judge`]).
#[tauri::command]
pub async fn session_save(
    app: AppHandle,
    paths: Vec<String>,
    active: Option<u32>,
) -> Result<(), String> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        let judged = judge(paths, move |path| scope.is_allowed(path));
        save(&paths::app_dirs(&app)?, judged, active)
    })
    .await
    .map_err(|err| format!("the session save did not finish: {err}"))?
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

/// The body of [`grant_on_startup`]: grants every stored path that is a file, counts
/// the start against every one that is not, and writes the count back.
///
/// `grant_files` finds and grants the files and answers which paths it granted
/// ([`state::grant_files`] in the app): every other path counts as missing. It runs
/// outside the state lock and within the startup budget, so a share
/// that hangs costs at most that and reads as offline. A directory counts as missing —
/// the webview does not open one either — and is not granted.
pub fn start(
    dirs: &AppDirs,
    grant_files: impl FnOnce(&[String]) -> HashSet<String>,
    now: u64,
) -> Result<(), String> {
    let stored = load_stored(dirs);
    let session = &stored.session;
    let present = grant_files(&session.paths);
    // Nothing missing now and nothing counted before is most starts, and those write
    // nothing: the startup grant never touched `state.json` before this rule either.
    if stored.note_start(|path| present.contains(path), now) == stored {
        return Ok(());
    }
    // A path the first read did not see has not been looked at, and is not counted.
    let seen: HashSet<&str> = session.paths.iter().map(String::as_str).collect();
    update(dirs, |stored| {
        stored.note_start(|path| present.contains(path) || !seen.contains(path), now)
    })
}

/// Grants the stored session paths that still exist to the fs scope, as written and
/// canonicalized, so the webview can reopen them without a dialog. Called from
/// `setup_app`, before the window appears. Never fails and never panics: a home
/// directory that cannot be read means "no session", not "no editor".
///
/// Nothing is granted for a path that is gone: the webview reports it as missing
/// (AD-22), keeps it in the list, and it is granted at the first start that finds it
/// again — or dropped by the rule in the module comment.
pub fn grant_on_startup(app: &AppHandle) {
    let Ok(dirs) = paths::app_dirs(app) else {
        return;
    };
    let scope = app.fs_scope();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let grant = |paths: &[String]| state::grant_files(&scope, paths, MAX_SESSION_PATHS);
    if let Err(err) = start(&dirs, grant, now) {
        // The grants are made; only the count of missing starts could not be stored,
        // which at worst lets a dead entry live a little longer.
        eprintln!("gEdit: the session's missing files could not be counted: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_scan;
    use std::fs;
    use std::path::{Path, PathBuf};

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
        let source = source_scan::lf(include_str!("session.rs"));
        for command in [
            concat!(
                "pub async fn session_",
                "save(\n    app: AppHandle,\n    paths: Vec<String>,\n    active: Option<u32>,\n) -> Result<(), String>"
            ),
            concat!("pub fn session_", "load(app: AppHandle) -> SessionState"),
            concat!("pub fn grant_on_", "startup(app: &AppHandle)"),
        ] {
            assert!(source.contains(command), "missing or changed: {command}");
        }
        let signature = concat!(
            "pub async fn session_",
            "save(\n    app: AppHandle,\n    paths: Vec<String>,\n    active: Option<u32>,\n) -> Result<(), String> {"
        );
        let at = source.find(signature).expect("the signature changed");
        let body = &source[at + signature.len()..];
        // The scope check touches the share, so it runs off the main
        // thread, and the answer is waited for within the stat budget (`judge`).
        let end = body.find("\n}\n").expect("the body does not end");
        assert!(
            body[..end].contains(concat!("spawn_", "blocking(")),
            "session_save does its work on the thread that called it"
        );
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

    /// One day, in the seconds `start` and `note_start` count in.
    const DAY: u64 = 24 * 60 * 60;

    /// A save of `session` with every path allowed by the scope.
    fn store(dirs: &AppDirs, session: &SessionState) {
        let judged = session
            .paths
            .iter()
            .map(|path| (path.clone(), true))
            .collect();
        save(dirs, judged, session.active).unwrap();
    }

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
        store(&dirs, &session);
        assert_eq!(load(&dirs), session);

        // Closing every tab is a session too, not "keep the last one".
        store(&dirs, &SessionState::default());
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

        store(
            &dirs,
            &SessionState {
                paths: list(&["/nc/a.nc"]),
                active: Some(0),
            },
        );

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

    /// The stored paths that are files, found without granting anything.
    fn files_in(paths: &[String]) -> HashSet<String> {
        paths
            .iter()
            .filter(|path| Path::new(path.as_str()).is_file())
            .cloned()
            .collect()
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

        store(
            &dirs,
            &SessionState {
                paths: list(&[here.to_str().unwrap(), gone.to_str().unwrap()]),
                active: Some(0),
            },
        );

        let app = mock_app();
        let scope = app.fs_scope();
        assert!(!scope.is_allowed(&here));

        let grant = |paths: &[String]| state::grant_files(&scope, paths, MAX_SESSION_PATHS);
        start(&dirs, grant, DAY).unwrap();
        assert!(scope.is_allowed(&here));
        // The canonical spelling of the same file, which is what `is_allowed`
        // compares against.
        assert!(scope.is_allowed(fs::canonicalize(&here).unwrap()));
        // A file that is gone is not granted ahead of time, and a file that was
        // never in the session stays out.
        assert!(!scope.is_allowed(&gone));
        assert!(!scope.is_allowed(&untouched));
        // Keeping it in the list is not granting it: the start that missed it only
        // counted it.
        assert_eq!(load(&dirs).paths.len(), 2);
        assert_eq!(load_stored(&dirs).missing.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    // --- a file that was offline at start -------------------

    fn judged(paths: &[(&str, bool)]) -> Vec<(String, bool)> {
        paths
            .iter()
            .map(|(path, ok)| ((*path).to_owned(), *ok))
            .collect()
    }

    /// The defect: a share that was not mounted at start was never granted, so the
    /// first save after the restore dropped every file on it.
    #[test]
    fn a_stored_path_the_scope_refuses_survives_a_save() {
        let (root, dirs) = scratch_dirs("offline-kept");
        store(
            &dirs,
            &SessionState {
                paths: list(&["/nc/a.nc", "/Volumes/cnc/b.nc"]),
                active: Some(1),
            },
        );
        // The webview sends the open tab first and carries the unreachable one after
        // it; the scope allows only the first.
        save(
            &dirs,
            judged(&[
                ("/nc/new.nc", true),
                ("/nc/a.nc", true),
                ("/Volumes/cnc/b.nc", false),
            ]),
            Some(0),
        )
        .unwrap();
        assert_eq!(
            load(&dirs),
            SessionState {
                paths: list(&["/nc/new.nc", "/nc/a.nc", "/Volumes/cnc/b.nc"]),
                active: Some(0),
            }
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Standing rule 8 still holds: a path that was never in the list and that the
    /// scope refuses cannot be brought in by naming it.
    #[test]
    fn a_refused_path_that_was_never_stored_is_still_dropped() {
        let (root, dirs) = scratch_dirs("offline-refused");
        store(
            &dirs,
            &SessionState {
                paths: list(&["/nc/a.nc"]),
                active: None,
            },
        );
        save(
            &dirs,
            judged(&[("/nc/a.nc", false), ("/etc/passwd", false)]),
            Some(1),
        )
        .unwrap();
        assert_eq!(
            load(&dirs),
            SessionState {
                paths: list(&["/nc/a.nc"]),
                active: None,
            }
        );
        // And once a path has left the list, it cannot come back refused either.
        save(&dirs, judged(&[("/nc/b.nc", true)]), None).unwrap();
        save(
            &dirs,
            judged(&[("/nc/b.nc", true), ("/nc/a.nc", false)]),
            None,
        )
        .unwrap();
        assert_eq!(load(&dirs).paths, list(&["/nc/b.nc"]));
        let _ = fs::remove_dir_all(&root);
    }

    fn stored(paths: &[&str], active: Option<u32>, missing: &[(&str, u64, u32)]) -> StoredSession {
        StoredSession {
            session: SessionState {
                paths: list(paths),
                active,
            },
            missing: missing
                .iter()
                .map(|(path, since, starts)| {
                    (
                        (*path).to_owned(),
                        Missing {
                            since: *since,
                            starts: *starts,
                        },
                    )
                })
                .collect(),
        }
    }

    #[test]
    fn a_start_counts_the_missing_paths_and_forgets_the_found_ones() {
        let before = stored(
            &["/nc/a.nc", "/net/b.nc", "/net/c.nc"],
            Some(2),
            &[("/net/c.nc", DAY, 2)],
        );
        // `b` is missing for the first time, `c` once more, and `a` is there.
        let after = before.note_start(|path| path == "/nc/a.nc", 3 * DAY);
        assert_eq!(
            after,
            stored(
                &["/nc/a.nc", "/net/b.nc", "/net/c.nc"],
                Some(2),
                &[("/net/b.nc", 3 * DAY, 1), ("/net/c.nc", DAY, 3)]
            )
        );
        // The share is back: one start that finds them resets both.
        assert_eq!(
            after.note_start(|_| true, 4 * DAY),
            stored(&["/nc/a.nc", "/net/b.nc", "/net/c.nc"], Some(2), &[])
        );
    }

    /// The bound, and both halves of it: a path goes only when it has been missing at
    /// enough starts **and** for long enough.
    #[test]
    fn a_path_missing_at_enough_starts_for_long_enough_is_dropped() {
        let limit = MISSING_STARTS_BEFORE_DROP;
        let long = MISSING_SECS_BEFORE_DROP;
        let gone = |since: u64, starts: u32| {
            stored(
                &["/nc/a.nc", "/net/b.nc", "/nc/c.nc"],
                Some(2),
                &[("/net/b.nc", since, starts)],
            )
        };
        let here = |path: &str| path != "/net/b.nc";

        // Many restarts in one morning: the count is reached, the time is not.
        let kept = gone(DAY, limit + 10).note_start(here, DAY + long - 1);
        assert_eq!(kept.session.paths.len(), 3);
        // Two weeks away from the office network with two starts: time, not count.
        let kept = gone(DAY, 1).note_start(here, DAY + 10 * long);
        assert_eq!(kept.session.paths.len(), 3);
        assert_eq!(kept.missing["/net/b.nc"].starts, 2);
        // A clock that went backwards never makes an entry old.
        let kept = gone(10 * long, limit + 10).note_start(here, DAY);
        assert_eq!(kept.session.paths.len(), 3);

        // Both: dropped, with `active` following its own path.
        let dropped = gone(DAY, limit - 1).note_start(here, DAY + long);
        assert_eq!(dropped, stored(&["/nc/a.nc", "/nc/c.nc"], Some(1), &[]));
    }

    #[test]
    fn the_missing_counts_live_in_the_session_member_and_stay_out_of_the_wire() {
        let value = stored(&["/nc/a.nc", "/net/b.nc"], Some(0), &[("/net/b.nc", 7, 2)]).to_value();
        assert_eq!(
            value,
            serde_json::json!({
                "paths": ["/nc/a.nc", "/net/b.nc"],
                "active": 0,
                "missing": { "/net/b.nc": { "since": 7, "starts": 2 } }
            })
        );
        assert_eq!(
            StoredSession::from_value(Some(&value)),
            stored(&["/nc/a.nc", "/net/b.nc"], Some(0), &[("/net/b.nc", 7, 2)])
        );
        // What `session_load` answers with is the list alone.
        assert_eq!(
            serde_json::to_value(SessionState::from_value(Some(&value))).unwrap(),
            serde_json::json!({ "paths": ["/nc/a.nc", "/net/b.nc"], "active": 0 })
        );
        // Nothing missing, no member.
        assert!(stored(&["/nc/a.nc"], None, &[])
            .to_value()
            .get("missing")
            .is_none());
        // Hand-edited nonsense, and entries for paths the list does not hold, are
        // dropped — which only makes a path wait longer before it goes.
        assert_eq!(
            StoredSession::from_value(Some(&serde_json::json!({
                "paths": ["/net/b.nc", "/net/c.nc"],
                "missing": {
                    "/net/b.nc": { "since": "yesterday", "starts": 2 },
                    "/net/c.nc": { "since": 3, "starts": 1 },
                    "/elsewhere.nc": { "since": 3, "starts": 9 }
                }
            }))),
            stored(&["/net/b.nc", "/net/c.nc"], None, &[("/net/c.nc", 3, 1)])
        );
    }

    /// A save keeps the count of a path it keeps, and forgets the count of one it
    /// does not — so a file that leaves the list and comes back starts from zero.
    #[test]
    fn a_save_keeps_the_counts_of_the_paths_it_keeps() {
        let (root, dirs) = scratch_dirs("offline-counts");
        let file = dirs.state_file();
        fs::write(
            &file,
            serde_json::to_vec(&serde_json::json!({
                "$version": 1,
                "session": stored(
                    &["/net/b.nc", "/net/c.nc"],
                    None,
                    &[("/net/b.nc", 5, 1), ("/net/c.nc", 6, 2)]
                )
                .to_value()
            }))
            .unwrap(),
        )
        .unwrap();
        save(
            &dirs,
            judged(&[("/nc/a.nc", true), ("/net/b.nc", false)]),
            Some(0),
        )
        .unwrap();
        assert_eq!(
            load_stored(&dirs),
            stored(&["/nc/a.nc", "/net/b.nc"], Some(0), &[("/net/b.nc", 5, 1)])
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// The whole life of an entry through `state.json`: counted at every start that
    /// misses it, granted by the one that finds it, and dropped only by the rule.
    #[test]
    fn the_startup_counts_and_drops_through_the_file() {
        let (root, dirs) = scratch_dirs("offline-starts");
        let here = root.join("a.nc");
        fs::write(&here, b"G0\n").unwrap();
        let folder = root.join("folder.nc");
        fs::create_dir_all(&folder).unwrap();
        let offline = "/Volumes/gedit-test-not-mounted/b.nc";
        store(
            &dirs,
            &SessionState {
                paths: list(&[here.to_str().unwrap(), offline, folder.to_str().unwrap()]),
                active: Some(1),
            },
        );

        let app = mock_app();
        let scope = app.fs_scope();
        let grant = |paths: &[String]| state::grant_files(&scope, paths, MAX_SESSION_PATHS);
        start(&dirs, grant, DAY).unwrap();
        // Only the file is granted; a folder counts as missing, as it does in the
        // webview, and is not granted either.
        assert!(scope.is_allowed(&here));
        assert!(!scope.is_allowed(&folder));
        let after = load_stored(&dirs);
        assert_eq!(after.session.paths.len(), 3);
        assert_eq!(
            after.missing[offline],
            Missing {
                since: DAY,
                starts: 1
            }
        );

        // Starts spread over two weeks: the offline path and the folder go at the one
        // that passes both limits, and `active` pointed at a dropped path.
        for n in 2..=MISSING_STARTS_BEFORE_DROP {
            let now = DAY + u64::from(n - 1) * (MISSING_SECS_BEFORE_DROP / 4);
            start(&dirs, files_in, now).unwrap();
        }
        assert_eq!(
            load_stored(&dirs),
            stored(&[here.to_str().unwrap()], None, &[])
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Items 8 and 9 together: a session file on a share that hangs at start costs
    /// the startup budget, not the window, is not granted, and is counted as offline
    /// and kept — while the files around it are granted as usual.
    #[test]
    fn a_hung_session_path_does_not_hold_up_the_start() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use std::time::{Duration, Instant};

        let (root, dirs) = scratch_dirs("offline-hung");
        let here = root.join("a.nc");
        fs::write(&here, b"G0\n").unwrap();
        let hung = root.join("hung.nc");
        fs::write(&hung, b"G0\n").unwrap();
        store(
            &dirs,
            &SessionState {
                paths: list(&[here.to_str().unwrap(), hung.to_str().unwrap()]),
                active: Some(1),
            },
        );

        let release = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&release);
        let app = mock_app();
        let scope = app.fs_scope();
        let started = Instant::now();
        let grant = |paths: &[String]| {
            let budget = Duration::from_millis(300);
            state::grant_files_within(&scope, paths, MAX_SESSION_PATHS, budget, move |path| {
                if path.ends_with("hung.nc") {
                    let until = Instant::now() + Duration::from_secs(10);
                    while !gate.load(Ordering::SeqCst) && Instant::now() < until {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                }
                Path::new(path)
                    .is_file()
                    .then(|| std::fs::canonicalize(path).ok())
            })
        };
        start(&dirs, grant, DAY).unwrap();
        let took = started.elapsed();
        release.store(true, Ordering::SeqCst);

        assert!(took < Duration::from_secs(3), "the start took {took:?}");
        assert!(scope.is_allowed(&here));
        assert!(
            !scope.is_allowed(&hung),
            "a path that did not answer was granted"
        );
        let after = load_stored(&dirs);
        assert_eq!(after.session.paths.len(), 2);
        assert_eq!(after.session.active, Some(1));
        assert_eq!(
            after.missing[hung.to_str().unwrap()],
            Missing {
                since: DAY,
                starts: 1
            }
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Most starts miss nothing, and those do not write `state.json` at all.
    #[test]
    fn a_start_that_misses_nothing_writes_nothing() {
        let (root, dirs) = scratch_dirs("offline-quiet");
        start(&dirs, files_in, DAY).unwrap();
        assert!(!dirs.state_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// The scope is asked about each path once, before the state file is touched,
    /// and never about more than `MAX_SCANNED_PATHS` of them.
    #[test]
    fn a_save_asks_the_scope_about_a_bounded_number_of_paths() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let asked = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&asked);
        let many: Vec<String> = (0..10_000).map(|n| format!("/no/f{n}.nc")).collect();
        let answers = judge(many, move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            false
        });
        assert_eq!(answers.len(), MAX_SCANNED_PATHS);
        assert_eq!(asked.load(Ordering::SeqCst), MAX_SCANNED_PATHS);
        // An empty path is never asked about.
        asked.store(0, Ordering::SeqCst);
        let counted = Arc::clone(&asked);
        assert_eq!(
            judge(list(&["", "/nc/a.nc"]), move |_| {
                counted.fetch_add(1, Ordering::SeqCst);
                true
            }),
            judged(&[("", false), ("/nc/a.nc", true)])
        );
        assert_eq!(asked.load(Ordering::SeqCst), 1);
    }

    /// Review: the scope check of a save touches every path, and the webview
    /// sends the path it could not reach at start with every save — so a share that hung
    /// froze the save (on the main thread) at every tab change. Now the save answers within
    /// the budget, the hung path reads as refused and is kept because it is listed, and
    /// the paths around it are judged as usual.
    #[test]
    fn a_hung_path_does_not_hold_up_a_save() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use std::time::Instant;

        let (root, dirs) = scratch_dirs("save-hung");
        store(
            &dirs,
            &SessionState {
                paths: list(&["/nc/a.nc", "/Volumes/dnc/hung.nc"]),
                active: Some(0),
            },
        );
        let release = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&release);
        let started = Instant::now();
        let answers = judge_within(
            list(&["/nc/a.nc", "/nc/new.nc", "/Volumes/dnc/hung.nc"]),
            Duration::from_millis(300),
            move |path| {
                if path.ends_with("hung.nc") {
                    let until = Instant::now() + Duration::from_secs(10);
                    while !gate.load(Ordering::SeqCst) && Instant::now() < until {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                }
                true
            },
        );
        let took = started.elapsed();
        release.store(true, Ordering::SeqCst);

        assert!(took < Duration::from_secs(3), "the save waited {took:?}");
        assert_eq!(
            answers,
            judged(&[
                ("/nc/a.nc", true),
                ("/nc/new.nc", true),
                ("/Volumes/dnc/hung.nc", false)
            ])
        );
        save(&dirs, answers, Some(0)).unwrap();
        assert_eq!(
            load(&dirs).paths,
            list(&["/nc/a.nc", "/nc/new.nc", "/Volumes/dnc/hung.nc"])
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// Review: a startup grant that lands after its budget opens the file
    /// all the same, but the start counts it as missing. The save carried that count on for
    /// every path it kept, so after five such starts over two weeks the rule dropped a file
    /// the user had open all along. A path the scope allows at a save was reachable in this
    /// run: its count goes.
    #[test]
    fn a_path_the_scope_allows_at_a_save_is_not_counted_missing() {
        let (root, dirs) = scratch_dirs("late-grant");
        let here = root.join("a.nc");
        fs::write(&here, b"G0\n").unwrap();
        let path = here.to_str().unwrap();
        store(
            &dirs,
            &SessionState {
                paths: list(&[path]),
                active: Some(0),
            },
        );
        for n in 0..=MISSING_STARTS_BEFORE_DROP {
            let now = DAY + u64::from(n) * (MISSING_SECS_BEFORE_DROP / 4);
            // Every grant lands late: the file exists, but nothing answered in time.
            start(&dirs, |_| HashSet::new(), now).unwrap();
            assert_eq!(load_stored(&dirs).missing[path].starts, 1, "start {n}");
            // The file reopened, and the first tab change saves it as allowed.
            save(&dirs, judged(&[(path, true)]), Some(0)).unwrap();
            assert!(load_stored(&dirs).missing.is_empty(), "start {n}");
        }
        assert_eq!(load(&dirs).paths, list(&[path]));

        // A path the scope refuses at the save keeps its count, as before.
        start(&dirs, |_| HashSet::new(), 9 * MISSING_SECS_BEFORE_DROP).unwrap();
        save(&dirs, judged(&[(path, false)]), Some(0)).unwrap();
        assert_eq!(load_stored(&dirs).missing[path].starts, 1);
        let _ = fs::remove_dir_all(&root);
    }
}

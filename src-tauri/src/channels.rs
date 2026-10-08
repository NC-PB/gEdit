//! `channel_siblings`: does a channel's sibling file exist next to an open document?
//! (plan §7.10, §4 "Channels (M12)", standing rule 14, AD-32).
//!
//! The rules WP12.4 implements, all of them binding:
//!
//! - `path` is the **open document's own path** and must pass `fs_scope().is_allowed`, or
//!   the call is `Err`. The folder is derived from it (its parent), never sent by the webview.
//! - At most [`MAX_NAMES`] names per call, or the call is `Err`.
//! - Each name is a **plain file name**: 1–255 characters, no `/` or `\`, no `:`, no `*` or
//!   `?`, no control character, not `.` and not `..`. A name that fails is answered on its
//!   own (`exists: false`, `error: Some(reason)`); the call is not refused for it. On
//!   Windows `a:b.nc` is an alternate data stream and `C:x.nc` a drive-relative path, and a
//!   wildcard is a name no file has but some APIs expand.
//! - Metadata only: existence, byte size, modification time. No content is read, no
//!   directory is listed, nothing is granted, and a symlink is reported as it is
//!   (`symlink_metadata`), never followed out of the folder.
//!
//! What the implementation adds, and why it is safe to:
//!
//! - **Windows name forms** (only where Windows reads them, [`validate_name`]'s `windows`
//!   flag): a trailing dot or space is dropped by path normalization, so `part.nc.` would
//!   answer for `part.nc`; the DOS device names (`CON`, `NUL.nc`, `COM1`, ...) are not files;
//!   `<`, `>`, `"` and `|` are reserved (the first three are NT wildcards). On the other
//!   platforms these are ordinary names and are accepted, so the §4 character set is exactly
//!   what is checked there.
//! - A directory is answered `exists: false` (it is not a channel file and its size is not
//!   the answer); a symlink is answered `exists: true` with the link's own size and time,
//!   whatever it points at, dangling or not. The target is never opened or resolved.
//! - A name whose stat did not answer within [`files::STAT_BUDGET`] (a hung share) or failed
//!   for a reason that is not "absent" is `exists: false` with `error: "unavailable"`, so the
//!   caller can tell "unknown" from "not there".

use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::files;
use crate::paths;

/// Names per call (plan §7.17 caps).
pub const MAX_NAMES: usize = 32;

/// Characters per name.
pub const MAX_NAME_CHARS: usize = 255;

/// One sibling's answer; camelCase on the wire (`platform/commands.ts` `SiblingInfo`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiblingInfo {
    pub name: String,
    pub exists: bool,
    pub bytes: u64,
    /// Milliseconds since the Unix epoch, when the file system says.
    pub modified: Option<i64>,
    /// Why this one name was refused (§7.16 #152); `None` for an accepted name.
    pub error: Option<String>,
}

/// The reason a name is refused, or `None` when it is a plain file name (§4).
///
/// `windows` selects the extra rules for how Windows reads a name; the command passes
/// `cfg!(windows)`, the tests pass both.
pub fn validate_name(name: &str, windows: bool) -> Option<&'static str> {
    let chars = name.chars().count();
    if chars == 0 {
        return Some("empty");
    }
    if chars > MAX_NAME_CHARS {
        return Some("too long");
    }
    if name == "." || name == ".." {
        return Some("not a file name");
    }
    for c in name.chars() {
        match c {
            '/' | '\\' => return Some("path separator"),
            ':' => return Some("colon"),
            '*' | '?' => return Some("wildcard"),
            c if c.is_control() => return Some("control character"),
            _ => {}
        }
    }
    if windows {
        if name.contains(['<', '>', '"', '|']) {
            return Some("reserved character");
        }
        if name.ends_with('.') || name.ends_with(' ') {
            return Some("trailing dot or space");
        }
        if paths::is_device_name(name) {
            return Some("device name");
        }
    }
    None
}

/// Why a stat gave no answer ([`SiblingInfo::error`]).
const UNAVAILABLE: &str = "unavailable";

/// The answer for one validated name: metadata of `folder/name`, never following a link.
fn stat_sibling(folder: &Path, name: &str) -> SiblingInfo {
    let mut info = SiblingInfo {
        name: name.to_owned(),
        ..SiblingInfo::default()
    };
    match std::fs::symlink_metadata(folder.join(name)) {
        Ok(meta) if meta.is_dir() => {}
        Ok(meta) => {
            info.exists = true;
            info.bytes = meta.len();
            info.modified = meta.modified().ok().map(millis);
        }
        Err(err) if is_absent(err.kind()) => {}
        Err(_) => info.error = Some(UNAVAILABLE.into()),
    }
    info
}

/// The errors of a stat that say the name is not there (as named). A permission error is
/// not one of them: the folder was not read, so the answer is "unavailable" (M12-5).
fn is_absent(kind: io::ErrorKind) -> bool {
    matches!(
        kind,
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory | io::ErrorKind::InvalidFilename
    )
}

/// Milliseconds since the Unix epoch, negative before it.
fn millis(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i64::try_from(after.as_millis()).unwrap_or(i64::MAX),
        Err(before) => i64::try_from(before.duration().as_millis()).map_or(i64::MIN, |n| -n),
    }
}

/// The command's body with the scope predicate, the platform flag and the time budget
/// injected, so every rule can be tested without an app handle.
///
/// `Err` for a call that is refused as a whole: more than [`MAX_NAMES`] names, a `path`
/// that is not absolute or has no parent, or one the scope does not allow. Otherwise one
/// entry per name, in order.
pub fn lookup(
    path: &str,
    names: Vec<String>,
    windows: bool,
    budget: Duration,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<Vec<SiblingInfo>, String> {
    if names.len() > MAX_NAMES {
        return Err(format!("at most {MAX_NAMES} names per call"));
    }
    let document = Path::new(path);
    if path.contains('\0') || !document.is_absolute() {
        return Err("not an absolute path".into());
    }
    // A path that climbs (`..`) is never a document the user opened: it would name a folder
    // the scope was not asked about, so it is refused before the scope is asked.
    if document
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("path is not a plain absolute path".into());
    }
    if !is_allowed(document) {
        return Err("path is not allowed".into());
    }
    let folder: PathBuf = match document.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => return Err("path has no folder".into()),
    };

    let refusals: Vec<Option<&'static str>> = names
        .iter()
        .map(|name| validate_name(name, windows))
        .collect();
    // One stat per distinct accepted name, on bounded threads (a hung share must not hang
    // the call). The key is the whole path so the shared "hung" bookkeeping keys on it.
    let keys: Vec<String> = names
        .iter()
        .zip(&refusals)
        .filter(|(_, refusal)| refusal.is_none())
        .map(|(name, _)| folder.join(name).to_string_lossy().into_owned())
        .collect();
    let prefix = folder.clone();
    let mut answers = files::run_bounded(keys, budget, move |key| {
        let name = Path::new(key)
            .strip_prefix(&prefix)
            .ok()
            .and_then(|rest| rest.to_str())
            .unwrap_or_default();
        stat_sibling(&prefix, name)
    })
    .into_iter();

    Ok(names
        .into_iter()
        .zip(refusals)
        .map(|(name, refusal)| match refusal {
            Some(reason) => SiblingInfo {
                name,
                error: Some(reason.into()),
                ..SiblingInfo::default()
            },
            None => match answers.next().flatten() {
                Some(info) => info,
                None => SiblingInfo {
                    name,
                    error: Some(UNAVAILABLE.into()),
                    ..SiblingInfo::default()
                },
            },
        })
        .collect())
}

/// Does each named sibling of the open document `path` exist? Metadata only; see the
/// module documentation for every rule.
///
/// `async` so that Tauri runs it off the main thread; the scope check (it canonicalizes,
/// which touches the share) and the stats run on the blocking pool.
#[tauri::command]
pub async fn channel_siblings(
    app: AppHandle,
    path: String,
    names: Vec<String>,
) -> Result<Vec<SiblingInfo>, String> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        lookup(
            &path,
            names,
            cfg!(windows),
            files::STAT_BUDGET,
            |document| scope.is_allowed(document),
        )
    })
    .await
    .map_err(|_| "the lookup failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const BUDGET: Duration = Duration::from_secs(5);

    fn scratch(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("gedit-channels-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn strings(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| (*n).to_owned()).collect()
    }

    fn ask(root: &Path, names: &[&str], windows: bool) -> Result<Vec<SiblingInfo>, String> {
        let document = root.join("part_CH1.nc");
        lookup(
            document.to_str().unwrap(),
            strings(names),
            windows,
            BUDGET,
            |_| true,
        )
    }

    fn refused(name: &str, windows: bool) -> bool {
        validate_name(name, windows).is_some()
    }

    #[test]
    fn the_answer_is_camel_case_on_the_wire() {
        let info = SiblingInfo {
            name: "part_CH2.nc".into(),
            exists: true,
            bytes: 12,
            modified: Some(1),
            error: None,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "name": "part_CH2.nc",
                "exists": true,
                "bytes": 12,
                "modified": 1,
                "error": null
            })
        );
    }

    #[test]
    fn the_limits_are_the_plan_s() {
        assert_eq!(MAX_NAMES, 32);
        assert_eq!(MAX_NAME_CHARS, 255);
    }

    // --- the call as a whole ---------------------------------------------------

    #[test]
    fn a_path_the_scope_does_not_allow_refuses_the_call() {
        let root = scratch("denied");
        let document = root.join("part_CH1.nc");
        fs::write(root.join("part_CH2.nc"), b"G0\n").unwrap();
        let answer = lookup(
            document.to_str().unwrap(),
            strings(&["part_CH2.nc"]),
            false,
            BUDGET,
            |_| false,
        );
        assert!(answer.is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_scope_is_asked_about_the_documents_own_path() {
        let root = scratch("asked");
        let document = root.join("part_CH1.nc");
        let seen = std::sync::Mutex::new(Vec::new());
        lookup(document.to_str().unwrap(), vec![], false, BUDGET, |path| {
            seen.lock().unwrap().push(path.to_path_buf());
            true
        })
        .unwrap();
        // Exactly the document, never the folder or a sibling.
        assert_eq!(*seen.lock().unwrap(), vec![document]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_relative_or_folderless_path_is_refused_before_the_scope_is_asked() {
        for path in ["part_CH1.nc", "", "./part_CH1.nc", "a\0b/c.nc"] {
            let answer = lookup(path, strings(&["x.nc"]), false, BUDGET, |_| {
                panic!("the scope must not be asked")
            });
            assert!(answer.is_err(), "{path:?}");
        }
        let root = if cfg!(windows) { r"C:\" } else { "/" };
        assert!(lookup(root, vec![], false, BUDGET, |_| true).is_err());
    }

    #[test]
    fn a_path_with_dot_dot_components_is_refused_before_the_scope_is_asked() {
        let base = if cfg!(windows) { r"C:\a\b" } else { "/a/b" };
        let sep = std::path::MAIN_SEPARATOR;
        for path in [
            format!("{base}{sep}..{sep}c.nc"),
            format!("{base}{sep}..{sep}..{sep}c.nc"),
        ] {
            let answer = lookup(&path, strings(&["x.nc"]), false, BUDGET, |_| {
                panic!("the scope must not be asked")
            });
            assert!(answer.is_err(), "{path:?}");
        }
    }

    #[test]
    fn more_than_32_names_refuse_the_whole_call() {
        let root = scratch("many");
        let names: Vec<String> = (0..33).map(|n| format!("p{n}.nc")).collect();
        let document = root.join("part_CH1.nc");
        let call =
            |names: Vec<String>| lookup(document.to_str().unwrap(), names, false, BUDGET, |_| true);
        assert!(call(names.clone()).is_err());
        assert_eq!(call(names[..32].to_vec()).unwrap().len(), 32);
        // Even all-invalid names do not slip under the cap.
        assert!(call(vec!["..".to_owned(); 33]).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_existing_and_a_missing_sibling() {
        let root = scratch("exists");
        fs::write(root.join("part_CH2.nc"), b"G0 X1\n").unwrap();
        let answer = ask(&root, &["part_CH2.nc", "part_CH3.nc", "part_CH2.nc"], false).unwrap();
        assert_eq!(answer.len(), 3);
        assert_eq!(answer[0].name, "part_CH2.nc");
        assert!(answer[0].exists);
        assert_eq!(answer[0].bytes, 6);
        assert_eq!(answer[0].error, None);
        // Within a day of now (clocks, not exactness).
        let now = millis(SystemTime::now());
        assert!((now - answer[0].modified.unwrap()).abs() < 86_400_000);
        assert_eq!(
            answer[1],
            SiblingInfo {
                name: "part_CH3.nc".into(),
                ..SiblingInfo::default()
            }
        );
        // A repeated name is answered again, in place.
        assert_eq!(answer[2], answer[0]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_answer_has_one_entry_per_name_in_order_and_a_bad_name_does_not_refuse_the_call() {
        let root = scratch("order");
        fs::write(root.join("b.nc"), b"x").unwrap();
        let answer = ask(&root, &["../b.nc", "b.nc", "", "c.nc"], false).unwrap();
        let shape: Vec<(&str, bool, bool)> = answer
            .iter()
            .map(|a| (a.name.as_str(), a.exists, a.error.is_some()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("../b.nc", false, true),
                ("b.nc", true, false),
                ("", false, true),
                ("c.nc", false, false)
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_folder_is_the_parent_of_the_document_and_a_name_never_climbs_out() {
        let root = scratch("folder");
        let inner = root.join("inner");
        fs::create_dir_all(&inner).unwrap();
        fs::write(root.join("outside.nc"), b"x").unwrap();
        fs::write(inner.join("inside.nc"), b"x").unwrap();
        let document = inner.join("part_CH1.nc");
        let answer = lookup(
            document.to_str().unwrap(),
            strings(&["inside.nc", "outside.nc", "../outside.nc", "..\\outside.nc"]),
            false,
            BUDGET,
            |_| true,
        )
        .unwrap();
        assert!(answer[0].exists);
        assert!(!answer[1].exists && answer[1].error.is_none());
        assert!(!answer[2].exists && answer[2].error.is_some());
        assert!(!answer[3].exists && answer[3].error.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_directory_is_not_a_channel_file() {
        let root = scratch("dir");
        fs::create_dir_all(root.join("sub.nc")).unwrap();
        let answer = ask(&root, &["sub.nc"], false).unwrap();
        assert!(!answer[0].exists);
        assert_eq!(answer[0].error, None);
        let _ = fs::remove_dir_all(&root);
    }

    // --- the name, one case each ----------------------------------------------

    #[test]
    fn the_whole_character_set_of_the_plan_is_refused_on_every_platform() {
        for windows in [false, true] {
            for bad in [
                "a/b.nc",
                "/abs.nc",
                "a\\b.nc",
                "..",
                ".",
                "a\0b.nc",
                "a:b.nc",
                "C:x.nc",
                "a*.nc",
                "a?.nc",
                "a\u{1}b.nc",
                "a\nb.nc",
                "a\u{7f}b.nc",
                "",
            ] {
                assert!(refused(bad, windows), "{bad:?} windows={windows}");
            }
            assert!(refused(&"a".repeat(256), windows));
            // 255 characters is the longest accepted name, and it counts characters.
            assert!(!refused(&"a".repeat(255), windows));
            assert!(!refused(&"ä".repeat(255), windows));
            assert!(refused(&"ä".repeat(256), windows));
            for good in [
                "part_CH2.nc",
                "O0002",
                "part.CH2",
                "a..b",
                "a b.nc",
                ".hidden",
                "ÄÖ.nc",
            ] {
                assert!(!refused(good, windows), "{good:?} windows={windows}");
            }
        }
    }

    #[test]
    fn each_refusal_names_its_reason_on_the_entry() {
        let root = scratch("reasons");
        let answer = ask(&root, &["a:b.nc", "a*.nc", ".."], false).unwrap();
        let reasons: Vec<_> = answer.iter().map(|a| a.error.as_deref()).collect();
        assert_eq!(
            reasons,
            vec![Some("colon"), Some("wildcard"), Some("not a file name")]
        );
        assert!(answer
            .iter()
            .all(|a| !a.exists && a.bytes == 0 && a.modified.is_none()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_windows_name_forms_are_refused_where_windows_reads_them() {
        for bad in [
            "part.nc.", "part.nc ", "CON", "con.nc", "NUL.nc", "COM1", "lpt9.txt", "COM0",
            "a<b.nc", "a>b.nc", "a\"b.nc", "a|b.nc",
        ] {
            assert!(refused(bad, true), "{bad:?}");
            // Ordinary names elsewhere: the §4 set is exactly what is checked.
            assert!(!refused(bad, false), "{bad:?}");
        }
        for good in ["CONSOLE.nc", "COM10.nc", "part.nc", " lead.nc"] {
            assert!(!refused(good, true), "{good:?}");
        }
    }

    #[test]
    fn the_command_uses_this_platforms_rules() {
        // `cfg!(windows)` is what the command passes; pin it so the flag cannot drift.
        assert_eq!(cfg!(windows), cfg!(target_os = "windows"));
    }

    #[test]
    fn a_wildcard_name_is_never_expanded() {
        let root = scratch("glob");
        fs::write(root.join("part_CH2.nc"), b"x").unwrap();
        let answer = ask(&root, &["part_CH*.nc", "part_CH?.nc"], false).unwrap();
        assert!(answer.iter().all(|a| !a.exists && a.error.is_some()));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_colon_name_that_exists_is_still_refused() {
        let root = scratch("colon");
        fs::write(root.join("a:b.nc"), b"x").unwrap();
        let answer = ask(&root, &["a:b.nc"], false).unwrap();
        assert!(!answer[0].exists && answer[0].error.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    // --- links ----------------------------------------------------------------

    /// A link out of the folder is reported as the link it is: its own size (the
    /// length of its target's spelling), exists true, and nothing is read through it.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_sibling_is_reported_as_it_is_and_never_followed() {
        use std::os::unix::fs::symlink;
        let root = scratch("link");
        let inner = root.join("inner");
        fs::create_dir_all(&inner).unwrap();
        let secret = root.join("secret.nc");
        fs::write(&secret, vec![b'x'; 5000]).unwrap();
        symlink(&secret, inner.join("link.nc")).unwrap();
        symlink(root.join("nowhere.nc"), inner.join("dangling.nc")).unwrap();
        symlink(&root, inner.join("folder.nc")).unwrap();
        let document = inner.join("part_CH1.nc");
        let answer = lookup(
            document.to_str().unwrap(),
            strings(&["link.nc", "dangling.nc", "folder.nc"]),
            false,
            BUDGET,
            |_| true,
        )
        .unwrap();
        let link_len = secret.as_os_str().len() as u64;
        assert!(answer[0].exists);
        // Not the target's 5000 bytes.
        assert_eq!(answer[0].bytes, link_len);
        assert_ne!(answer[0].bytes, 5000);
        // A dangling link is a link that exists; a link to a folder is a link, not a folder.
        assert!(answer[1].exists && answer[1].error.is_none());
        assert!(answer[2].exists && answer[2].error.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    // --- grants and hung shares ------------------------------------------------

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("could not build the mock app")
    }

    /// Against the real scope: only the granted document opens the call, and the
    /// answers grant nothing — not a sibling, not the folder.
    #[test]
    fn the_command_body_grants_nothing() {
        let root = scratch("grant");
        let document = root.join("part_CH1.nc");
        let sibling = root.join("part_CH2.nc");
        fs::write(&document, b"G0\n").unwrap();
        fs::write(&sibling, b"G0\n").unwrap();
        let app = mock_app();
        let scope = app.fs_scope();
        let call = || {
            lookup(
                document.to_str().unwrap(),
                strings(&["part_CH2.nc"]),
                cfg!(windows),
                BUDGET,
                |path| scope.is_allowed(path),
            )
        };
        // Nothing granted: refused, and refusing grants nothing.
        assert!(call().is_err());
        scope.allow_file(&document).unwrap();
        let answer = call().unwrap();
        assert!(answer[0].exists);
        assert!(scope.is_allowed(&document));
        assert!(!scope.is_allowed(&sibling));
        assert!(!scope.is_allowed(&root));
        assert!(!scope.is_allowed(root.join("part_CH3.nc")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stat_that_cannot_answer_is_unavailable_not_absent() {
        let root = scratch("hung");
        let document = root.join("part_CH1.nc");
        let name = "never-answers.nc";
        let key = root.join(name).to_string_lossy().into_owned();
        // The key is marked hung by a worker that outlives its budget.
        let slow = files::run_bounded(vec![key], Duration::from_millis(20), |_| {
            std::thread::sleep(Duration::from_millis(400));
        });
        assert_eq!(slow, vec![None]);
        let answer = lookup(
            document.to_str().unwrap(),
            strings(&[name]),
            false,
            BUDGET,
            |_| true,
        )
        .unwrap();
        assert!(!answer[0].exists);
        assert_eq!(answer[0].error.as_deref(), Some("unavailable"));
        std::thread::sleep(Duration::from_millis(450));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_permission_error_is_not_an_absent_file() {
        assert!(is_absent(io::ErrorKind::NotFound));
        assert!(!is_absent(io::ErrorKind::PermissionDenied));
    }

    #[test]
    fn times_before_the_epoch_are_negative() {
        assert_eq!(millis(UNIX_EPOCH - Duration::from_millis(1500)), -1500);
        assert_eq!(millis(UNIX_EPOCH + Duration::from_millis(1500)), 1500);
    }
}

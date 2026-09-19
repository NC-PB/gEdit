//! Runtime harness plugin. TEST BUILDS ONLY: `tests/runtime/sync.sh` copies this file
//! into a patched copy of the app as `src-tauri/src/harness.rs`; it never ships.
//!
//! - `plugin()` injects the page bundle that `run.sh` writes for one scenario
//!   (`HARNESS_BUNDLE`) at document start, and owns the harness `setup` and `on_event`.
//! - The `h_*` commands are the page's way to reach the backend and macOS: native
//!   input, the real NSAlert, fake file dialogs, disk access and window control.
//! - Everything the runner needs is printed to stdout as one `RH <json>` line per record.
//!
//! The page talks to these commands through `__TAURI_INTERNALS__.invoke`. App commands
//! need no ACL entry as long as the app has no permission manifest (plan F5).

use std::collections::{HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, EventTarget, Manager, RunEvent, Runtime, WindowEvent};
use tauri_plugin_fs::FsExt;

const MAIN: &str = "main";

/// Queued answers for the fake file dialogs, per kind (`open`, `save`, `folder`).
#[derive(Default)]
pub struct FakeDialogs(Mutex<HashMap<String, VecDeque<Value>>>);

/// Prints one record for the runner. Stdout is flushed per line, so a crash loses nothing.
fn rh(record: &Value) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "RH {record}");
    let _ = out.flush();
}

fn diag(msg: impl Into<String>) {
    rh(&json!({ "kind": "diag", "msg": msg.into() }));
}

fn env_path(name: &str) -> Result<PathBuf, String> {
    std::env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| format!("{name} is not set"))
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let bundle = match env_path("HARNESS_BUNDLE") {
        Ok(path) => std::fs::read_to_string(&path).unwrap_or_else(|e| {
            diag(format!(
                "cannot read HARNESS_BUNDLE {}: {e}",
                path.display()
            ));
            String::new()
        }),
        Err(e) => {
            diag(e);
            String::new()
        }
    };
    let mut builder = tauri::plugin::Builder::<R, ()>::new("harness")
        .setup(|app, _api| {
            app.manage(FakeDialogs::default());
            start_watchdog();
            Ok(())
        })
        .on_webview_ready(|webview| {
            if webview.label() == MAIN {
                prepare_main_window(&webview);
            }
        })
        .on_event(|_app, event| log_run_event(event));
    if !bundle.is_empty() {
        builder = builder.js_init_script(bundle);
    }
    builder.build()
}

/// Ends a run that hangs, even if the page never reports back.
fn start_watchdog() {
    let secs: u64 = std::env::var("HARNESS_TIMEOUT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(120);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(secs));
        rh(&json!({ "kind": "timeout", "secs": secs }));
        std::process::exit(2);
    });
}

/// The config keeps the window hidden (sync.sh sets `visible: false`), so it can be
/// sized before it appears. WebKit stops rendering an occluded page (rAF and timers
/// are throttled, Monaco never draws), so occlusion detection is turned off.
fn prepare_main_window<R: Runtime>(webview: &tauri::Webview<R>) {
    if std::env::var("HARNESS_VISIBLE").as_deref() == Ok("0") {
        return;
    }
    let window = webview.window();
    let _ = window.set_size(tauri::LogicalSize::new(1100.0, 700.0));
    let _ = window.center();
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|pv| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyObject, Sel};
        let wk = pv.inner() as *mut AnyObject;
        let sel = Sel::register(c"_setWindowOcclusionDetectionEnabled:");
        let ok: bool = msg_send![wk, respondsToSelector: sel];
        if ok {
            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: false];
        }
        diag(format!("occlusion detection disabled: {ok}"));
    });
    let _ = window.show();
    // Best effort: macOS may refuse to activate an app launched in the background.
    // Native key events work either way; native clicks need an active window.
    #[cfg(target_os = "macos")]
    let _ = window.run_on_main_thread(|| unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject};
        let app: *mut AnyObject =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
    });
}

fn log_run_event(event: &RunEvent) {
    match event {
        RunEvent::ExitRequested { code, .. } => {
            rh(&json!({ "kind": "event", "event": "ExitRequested", "code": code }))
        }
        RunEvent::Exit => rh(&json!({ "kind": "event", "event": "Exit" })),
        RunEvent::WindowEvent { label, event, .. } => match event {
            WindowEvent::CloseRequested { .. } => {
                rh(&json!({ "kind": "event", "event": "CloseRequested", "label": label }))
            }
            WindowEvent::Destroyed => {
                rh(&json!({ "kind": "event", "event": "WindowDestroyed", "label": label }))
            }
            _ => {}
        },
        RunEvent::MenuEvent(e) => {
            rh(&json!({ "kind": "event", "event": "MenuEvent", "id": e.id().0 }))
        }
        _ => {}
    }
}

/// Runs `f` on the main thread and waits for its result (AppKit calls must run there).
fn on_main<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|_| "the main thread did not answer within 3 s".to_string())
}

// ---------------------------------------------------------------- reporting and control

/// A record from the page (already JSON); printed as is.
#[tauri::command]
pub fn h_report(msg: String) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "RH {msg}");
    let _ = out.flush();
}

#[tauri::command]
pub fn h_log(msg: String) {
    rh(&json!({ "kind": "log", "msg": msg }));
}

/// Ends the run: flushes stdout and exits without the close guard.
#[tauri::command]
pub fn h_done(code: i32) {
    rh(&json!({ "kind": "exit-requested-by-page", "code": code }));
    std::process::exit(code);
}

/// Sync command: runs on the main thread, so its latency shows whether that thread is blocked.
#[tauri::command]
pub fn h_ping_sync() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Blocks the main thread on purpose (calibrates the responsiveness probe).
#[tauri::command]
pub fn h_block_main_sync(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

#[tauri::command]
pub fn h_is_main_thread_sync() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyClass;
        let cls = AnyClass::get(c"NSThread").unwrap();
        let b: bool = msg_send![cls, isMainThread];
        b
    }
    #[cfg(not(target_os = "macos"))]
    false
}

#[tauri::command(async)]
pub fn h_title(app: AppHandle) -> Result<String, String> {
    let w = app.get_webview_window(MAIN).ok_or("no main window")?;
    w.title().map_err(|e| e.to_string())
}

/// Sets (Some) or removes (None) an environment variable of the running app.
#[tauri::command]
pub fn h_setenv(name: String, value: Option<String>) {
    match &value {
        Some(v) => std::env::set_var(&name, v),
        None => std::env::remove_var(&name),
    }
    rh(&json!({ "kind": "log", "msg": format!("setenv {name}={value:?}") }));
}

#[tauri::command]
pub fn h_menu_dump(app: AppHandle) -> String {
    use tauri::menu::MenuItemKind;
    fn walk<R: Runtime>(items: Vec<MenuItemKind<R>>, depth: usize, out: &mut String) {
        for it in items {
            let pad = "  ".repeat(depth);
            match it {
                MenuItemKind::Submenu(s) => {
                    out.push_str(&format!(
                        "{pad}Submenu id={:?} text={:?}\n",
                        s.id().0,
                        s.text().unwrap_or_default()
                    ));
                    walk(s.items().unwrap_or_default(), depth + 1, out);
                }
                MenuItemKind::MenuItem(m) => out.push_str(&format!(
                    "{pad}MenuItem id={:?} text={:?} enabled={:?}\n",
                    m.id().0,
                    m.text().unwrap_or_default(),
                    m.is_enabled().ok()
                )),
                MenuItemKind::Predefined(p) => out.push_str(&format!(
                    "{pad}Predefined text={:?}\n",
                    p.text().unwrap_or_default()
                )),
                MenuItemKind::Check(c) => out.push_str(&format!("{pad}Check id={:?}\n", c.id().0)),
                MenuItemKind::Icon(i) => out.push_str(&format!("{pad}Icon id={:?}\n", i.id().0)),
            }
        }
    }
    let mut s = String::new();
    match app.menu() {
        Some(m) => walk(m.items().unwrap_or_default(), 0, &mut s),
        None => s.push_str("<no app menu>"),
    }
    s
}

// ---------------------------------------------------------------- fs scope and file dialogs

/// Grants a path in both scopes, exactly as the dialog plugin does for a picked file.
fn grant_file<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    app.fs_scope().allow_file(path).map_err(|e| e.to_string())?;
    app.state::<tauri::scope::Scopes>()
        .allow_file(path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn h_allow(app: AppHandle, path: String) -> Result<(), String> {
    app.fs_scope().allow_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn h_queue_dialog(state: tauri::State<'_, FakeDialogs>, kind: String, value: Value) {
    rh(&json!({ "kind": "log", "msg": format!("queue {kind} dialog -> {value}") }));
    state
        .0
        .lock()
        .unwrap()
        .entry(kind)
        .or_default()
        .push_back(value);
}

/// Drops all queued answers; returns the ones nobody consumed.
#[tauri::command]
pub fn h_clear_dialogs(state: tauri::State<'_, FakeDialogs>) -> Vec<String> {
    let mut q = state.0.lock().unwrap();
    let left = q
        .iter()
        .flat_map(|(k, v)| v.iter().map(move |x| format!("{k}: {x}")))
        .collect();
    q.clear();
    left
}

/// Stands in for `plugin:dialog|open` and `plugin:dialog|save` (the page reroutes those
/// IPC calls here). A picked path is granted like the dialog plugin grants it. With
/// nothing queued it answers "cancelled" and reports the unexpected dialog.
#[tauri::command]
pub fn h_fake_dialog(
    app: AppHandle,
    state: tauri::State<'_, FakeDialogs>,
    kind: String,
    args: Value,
) -> Result<Value, String> {
    let next = state
        .0
        .lock()
        .unwrap()
        .get_mut(&kind)
        .and_then(|q| q.pop_front());
    rh(&json!({ "kind": "dialog", "dialog": kind, "args": args, "answer": next }));
    let Some(answer) = next else {
        rh(&json!({ "kind": "unexpected-dialog", "dialog": kind, "args": args }));
        return Ok(Value::Null);
    };
    let paths: Vec<&str> = match &answer {
        Value::String(p) => vec![p.as_str()],
        Value::Array(items) => items.iter().filter_map(Value::as_str).collect(),
        _ => vec![],
    };
    for p in paths {
        if kind == "folder" {
            let recursive = args
                .pointer("/options/recursive")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            app.fs_scope()
                .allow_directory(p, recursive)
                .map_err(|e| e.to_string())?;
            app.state::<tauri::scope::Scopes>()
                .allow_directory(p, true)
                .map_err(|e| e.to_string())?;
        } else {
            grant_file(&app, Path::new(p))?;
        }
    }
    Ok(answer)
}

/// Grants each path exactly as tauri-plugin-fs does for a real drop (files, and folders
/// recursively), then emits `tauri://drag-drop` to the main webview like a Finder drop.
#[tauri::command]
pub fn h_drop(
    app: AppHandle,
    paths: Vec<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    for p in &paths {
        let path = Path::new(p);
        if path.is_file() {
            grant_file(&app, path)?;
        } else {
            app.fs_scope()
                .allow_directory(path, true)
                .map_err(|e| e.to_string())?;
            app.state::<tauri::scope::Scopes>()
                .allow_directory(path, true)
                .map_err(|e| e.to_string())?;
        }
    }
    let payload =
        json!({ "paths": paths, "position": { "x": x.unwrap_or(0.0), "y": y.unwrap_or(0.0) } });
    rh(&json!({ "kind": "log", "msg": format!("drop {payload}") }));
    app.emit_to(EventTarget::labeled(MAIN), "tauri://drag-drop", payload)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- disk and processes

#[tauri::command(async)]
pub fn h_read_disk(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Writes `text`, or the bytes of `base64`, creating parent folders.
#[tauri::command(async)]
pub fn h_write_disk(
    path: String,
    text: Option<String>,
    base64: Option<String>,
) -> Result<usize, String> {
    let bytes = match (text, base64) {
        (Some(t), None) => t.into_bytes(),
        (None, Some(b)) => decode_base64(&b)?,
        _ => return Err("pass either text or base64".into()),
    };
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len())
}

/// Sets the modification time to `secs` seconds since the Unix epoch.
#[tauri::command(async)]
pub fn h_touch_mtime(path: String, secs: f64) -> Result<(), String> {
    if !secs.is_finite() || secs < 0.0 {
        return Err(format!("invalid time {secs}"));
    }
    let when = UNIX_EPOCH + Duration::from_secs_f64(secs);
    let file = std::fs::File::options()
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.set_modified(when).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn h_stat(path: String) -> Result<Value, String> {
    let m = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let mtime_ms = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0);
    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::PermissionsExt;
        m.permissions().mode()
    };
    #[cfg(not(unix))]
    let mode = 0u32;
    Ok(
        json!({ "len": m.len(), "mtimeMs": mtime_ms, "mode": mode, "isFile": m.is_file(), "isDir": m.is_dir() }),
    )
}

#[tauri::command(async)]
pub fn h_copy(src: String, dst: String) -> Result<u64, String> {
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())
}

/// The file's bytes as space-separated hex, at most `max` bytes when given.
#[tauri::command(async)]
pub fn h_hex(path: String, max: Option<usize>) -> Result<String, String> {
    let b = std::fs::read(&path).map_err(|e| e.to_string())?;
    let n = max.unwrap_or(b.len()).min(b.len());
    Ok(b[..n]
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect::<Vec<_>>()
        .join(" "))
}

/// Child processes of the app as "pid ppid command" lines, via /bin/ps.
#[tauri::command(async)]
pub fn h_children() -> Result<Vec<String>, String> {
    let me = std::process::id().to_string();
    let o = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,command="])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter(|l| l.split_whitespace().nth(1) == Some(me.as_str()))
        .map(|l| l.trim().to_string())
        .collect())
}

/// Pids whose full command line matches `pattern` (pgrep -f).
#[tauri::command(async)]
pub fn h_pgrep(pattern: String) -> Result<Vec<u32>, String> {
    let o = std::process::Command::new("/usr/bin/pgrep")
        .args(["-f", &pattern])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect())
}

/// Copies `tests/fixtures/<rel>` (or `tests/runtime/fixtures/<rel>` with `from: "runtime"`)
/// fresh into the run folder and returns the copy's absolute path.
#[tauri::command(async)]
pub fn h_fixture(rel: String, from: Option<String>) -> Result<String, String> {
    let rel_path = Path::new(&rel);
    if rel.is_empty()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("invalid fixture path {rel:?}"));
    }
    let repo = env_path("HARNESS_REPO")?;
    let run = env_path("HARNESS_RUN_DIR")?;
    let (src_root, dst_root) = match from.as_deref() {
        None | Some("fixtures") => (repo.join("tests/fixtures"), run.join("fixtures")),
        Some("runtime") => (
            repo.join("tests/runtime/fixtures"),
            run.join("runtime-fixtures"),
        ),
        Some(other) => return Err(format!("unknown fixture root {other:?}")),
    };
    let src = src_root.join(rel_path);
    let dst = dst_root.join(rel_path);
    if dst.is_dir() {
        std::fs::remove_dir_all(&dst).map_err(|e| e.to_string())?;
    } else if dst.exists() {
        std::fs::remove_file(&dst).map_err(|e| e.to_string())?;
    }
    copy_tree(&src, &dst).map_err(|e| format!("copy {}: {e}", src.display()))?;
    Ok(dst.to_string_lossy().into_owned())
}

fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst).map(|_| ())
    }
}

fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let clean: Vec<u8> = s
        .bytes()
        .filter(|c| !c.is_ascii_whitespace() && *c != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= val(c).ok_or("invalid base64")? << (18 - 6 * i);
        }
        let bytes = acc.to_be_bytes();
        match chunk.len() {
            4 => out.extend_from_slice(&bytes[1..4]),
            3 => out.extend_from_slice(&bytes[1..3]),
            2 => out.push(bytes[1]),
            _ => return Err("invalid base64 length".into()),
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- window, quit and native input

/// Calls `window.close()` from Rust (the path of the red button and of the app's Cmd+Q item).
#[tauri::command]
pub fn h_close_from_rust(app: AppHandle, delay_ms: Option<u64>) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms.unwrap_or(0)));
        match app.get_webview_window(MAIN) {
            Some(w) => diag(format!("rust window.close() -> {:?}", w.close())),
            None => diag("rust window.close(): no main window"),
        }
    });
}

/// Quits or closes the way macOS does:
/// - `keyequiv`: a Cmd+Q key event handed to the main menu (muda -> on_menu_event).
/// - `terminate`: `[NSApp terminate:]`, what Dock > Quit and logout end up calling.
/// - `performclose`: `-[NSWindow performClose:]`, the red close button.
#[tauri::command]
pub fn h_quit(app: AppHandle, mode: String, delay_ms: Option<u64>) {
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms.unwrap_or(0)));
        let a2 = a.clone();
        let _ = a.run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::{AnyClass, AnyObject, Sel};
                match mode.as_str() {
                    "terminate" => {
                        let nsapp: *mut AnyObject =
                            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
                        // From the run loop, like the quit Apple Event, not inside tao's callback.
                        let sel = Sel::register(c"terminate:");
                        let _: () = msg_send![nsapp, performSelector: sel, withObject: std::ptr::null_mut::<AnyObject>(), afterDelay: 0.0f64];
                        diag("[NSApp terminate:] scheduled");
                    }
                    "performclose" => {
                        if let Some(Ok(nsw)) = a2.get_webview_window(MAIN).map(|w| w.ns_window()) {
                            let _: () = msg_send![nsw as *mut AnyObject, performClose: std::ptr::null_mut::<AnyObject>()];
                            diag("-[NSWindow performClose:] sent");
                        }
                    }
                    _ => diag(format!("Cmd+Q performKeyEquivalent handled={}", send_cmd_q())),
                }
            }
            let _ = (&a2, &mode);
        });
    });
}

/// Window and app state as AppKit sees it, plus the number of visible alerts.
#[tauri::command(async)]
pub fn h_window_state(app: AppHandle) -> Result<Value, String> {
    let exists = app.get_webview_window(MAIN).is_some();
    #[cfg(target_os = "macos")]
    {
        let a = app.clone();
        on_main(&app, move || unsafe {
            use objc2::msg_send;
            use objc2::runtime::{AnyClass, AnyObject};
            let nsapp: *mut AnyObject =
                msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
            let active: bool = msg_send![nsapp, isActive];
            let (mut key, mut visible, mut sheet) = (false, false, false);
            if let Some(Ok(nsw)) = a.get_webview_window(MAIN).map(|w| w.ns_window()) {
                let nsw = nsw as *mut AnyObject;
                key = msg_send![nsw, isKeyWindow];
                visible = msg_send![nsw, isVisible];
                let s: *mut AnyObject = msg_send![nsw, attachedSheet];
                sheet = !s.is_null();
            }
            json!({ "exists": exists, "active": active, "key": key, "visible": visible,
                    "sheet": sheet, "alerts": alert_panels().len() })
        })
    }
    #[cfg(not(target_os = "macos"))]
    Ok(json!({ "exists": exists }))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEv {
    kind: String, // "click" | "key"
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default)]
    click_count: Option<isize>,
    #[serde(default)]
    chars: String,
    #[serde(default)]
    key_code: u16,
    #[serde(default)]
    cmd: bool,
    #[serde(default)]
    shift: bool,
    #[serde(default)]
    alt: bool,
    #[serde(default)]
    ctrl: bool,
    #[serde(default)]
    function: bool,
}

/// Synthesizes real (trusted) NSEvents, one after another, and returns once all are
/// delivered. Clicks go to the main NSWindow (`x`/`y` in window points from the bottom
/// left); keys go through `NSApp.sendEvent`: key window -> WKWebView -> page, then key
/// equivalents and the main menu, like hardware input.
#[tauri::command(async)]
pub fn h_native_input(app: AppHandle, events: Vec<NativeEv>) -> Vec<String> {
    let mut results = Vec::new();
    for ev in events {
        let a = app.clone();
        #[cfg(target_os = "macos")]
        let r = on_main(&app, move || native_event(&a, &ev)).unwrap_or_else(|e| e);
        #[cfg(not(target_os = "macos"))]
        let r = {
            let _ = (
                &a,
                &ev.kind,
                ev.x,
                ev.y,
                ev.click_count,
                &ev.chars,
                ev.key_code,
            );
            let _ = (ev.cmd, ev.shift, ev.alt, ev.ctrl, ev.function);
            "native input is macOS only".to_string()
        };
        results.push(r);
        std::thread::sleep(Duration::from_millis(30));
    }
    results
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct Pt {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for Pt {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGPoint",
        &[
            objc2::encode::Encoding::Double,
            objc2::encode::Encoding::Double,
        ],
    );
}

#[cfg(target_os = "macos")]
fn native_event<R: Runtime>(app: &AppHandle<R>, ev: &NativeEv) -> String {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    let Some(w) = app.get_webview_window(MAIN) else {
        return "no main window".into();
    };
    let Ok(nswin) = w.ns_window() else {
        return "no ns_window".into();
    };
    unsafe {
        let nswin = nswin as *mut AnyObject;
        let wnum: isize = msg_send![nswin, windowNumber];
        let pi: *mut AnyObject = msg_send![AnyClass::get(c"NSProcessInfo").unwrap(), processInfo];
        let ts: f64 = msg_send![pi, systemUptime];
        let nsapp: *mut AnyObject =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let mut flags = 0usize;
        if ev.shift {
            flags |= 1 << 17;
        }
        if ev.ctrl {
            flags |= 1 << 18;
        }
        if ev.alt {
            flags |= 1 << 19;
        }
        if ev.cmd {
            flags |= 1 << 20;
        }
        if ev.function {
            flags |= 1 << 23;
        }
        if ev.kind == "click" {
            let loc = Pt { x: ev.x, y: ev.y };
            // 1 = left mouse down, 2 = left mouse up
            for (i, ty) in [1usize, 2usize].into_iter().enumerate() {
                let e: *mut AnyObject = msg_send![
                    AnyClass::get(c"NSEvent").unwrap(),
                    mouseEventWithType: ty,
                    location: loc,
                    modifierFlags: flags,
                    timestamp: ts + (i as f64) * 0.05,
                    windowNumber: wnum,
                    context: std::ptr::null_mut::<AnyObject>(),
                    eventNumber: 0isize,
                    clickCount: ev.click_count.unwrap_or(1),
                    pressure: if ty == 1 { 1.0f32 } else { 0.0f32 }
                ];
                let _: () = msg_send![nswin, sendEvent: e];
            }
            let key: bool = msg_send![nswin, isKeyWindow];
            format!("click ({}, {}) key={key}", ev.x, ev.y)
        } else {
            let Ok(cs) = std::ffi::CString::new(ev.chars.clone()) else {
                return "bad chars".into();
            };
            let s: *mut AnyObject =
                msg_send![AnyClass::get(c"NSString").unwrap(), stringWithUTF8String: cs.as_ptr()];
            // 10 = key down, 11 = key up
            for (i, ty) in [10usize, 11usize].into_iter().enumerate() {
                let e: *mut AnyObject = msg_send![
                    AnyClass::get(c"NSEvent").unwrap(),
                    keyEventWithType: ty,
                    location: Pt { x: 0.0, y: 0.0 },
                    modifierFlags: flags,
                    timestamp: ts + (i as f64) * 0.02,
                    windowNumber: wnum,
                    context: std::ptr::null_mut::<AnyObject>(),
                    characters: s,
                    charactersIgnoringModifiers: s,
                    isARepeat: false,
                    keyCode: ev.key_code
                ];
                let _: () = msg_send![nsapp, sendEvent: e];
            }
            format!("key {:?} code={} flags={flags:#x}", ev.chars, ev.key_code)
        }
    }
}

#[cfg(target_os = "macos")]
fn send_cmd_q() -> bool {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    unsafe {
        let q: *mut AnyObject =
            msg_send![AnyClass::get(c"NSString").unwrap(), stringWithUTF8String: c"q".as_ptr()];
        let ev: *mut AnyObject = msg_send![
            AnyClass::get(c"NSEvent").unwrap(),
            keyEventWithType: 10usize,
            location: Pt { x: 0.0, y: 0.0 },
            modifierFlags: (1usize << 20),
            timestamp: 0.0f64,
            windowNumber: 0isize,
            context: std::ptr::null_mut::<AnyObject>(),
            characters: q,
            charactersIgnoringModifiers: q,
            isARepeat: false,
            keyCode: 12u16
        ];
        let nsapp: *mut AnyObject =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let menu: *mut AnyObject = msg_send![nsapp, mainMenu];
        msg_send![menu, performKeyEquivalent: ev]
    }
}

// ---------------------------------------------------------------- the real NSAlert

/// Texts and buttons of the visible alert panels, front-most first.
#[tauri::command(async)]
pub fn h_alert_info(app: AppHandle) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        on_main(&app, || {
            let panels = alert_panels();
            match panels.first() {
                None => Value::Null,
                Some(p) => {
                    json!({ "texts": p.texts, "buttons": p.buttons, "count": panels.len(), "class": p.class })
                }
            }
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(Value::Null)
    }
}

/// Clicks the button titled `label` (alternatives separated by `|`) on a visible alert,
/// waiting up to `timeout_ms` for one to appear, like a user would.
#[tauri::command(async)]
pub fn h_alert_click(
    app: AppHandle,
    label: String,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(5000));
    loop {
        #[cfg(target_os = "macos")]
        {
            let l = label.clone();
            if let Some(clicked) = on_main(&app, move || click_alert_button(&l))? {
                rh(&json!({ "kind": "alert-click", "label": label, "alert": clicked }));
                return Ok(clicked);
            }
        }
        if Instant::now() >= deadline {
            #[cfg(target_os = "macos")]
            let seen = on_main(&app, || {
                json!({
                    "alerts": alert_panels().into_iter().map(|p| json!({ "class": p.class, "buttons": p.buttons })).collect::<Vec<_>>(),
                    "windows": window_classes(),
                })
            })?;
            #[cfg(not(target_os = "macos"))]
            let seen = Value::Null;
            return Err(format!("no alert button {label:?} ({seen})"));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(target_os = "macos")]
struct AlertPanel {
    class: String,
    texts: Vec<String>,
    buttons: Vec<String>,
    button_ptrs: Vec<usize>,
}

/// Class names of every window AppKit knows, for diagnosing a missing alert.
#[cfg(target_os = "macos")]
fn window_classes() -> Vec<String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    unsafe {
        let nsapp: *mut AnyObject =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let windows: *mut AnyObject = msg_send![nsapp, windows];
        let count: usize = msg_send![windows, count];
        (0..count)
            .map(|i| {
                let w: *mut AnyObject = msg_send![windows, objectAtIndex: i];
                let visible: bool = msg_send![w, isVisible];
                format!(
                    "{}{}",
                    (*w).class().name().to_string_lossy(),
                    if visible { "" } else { " (hidden)" }
                )
            })
            .collect()
    }
}

#[cfg(target_os = "macos")]
fn alert_panels() -> Vec<AlertPanel> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::ffi::{c_char, CStr};
    unsafe fn ns_str(o: *mut AnyObject) -> String {
        if o.is_null() {
            return String::new();
        }
        let p: *const c_char = msg_send![o, UTF8String];
        if p.is_null() {
            String::new()
        } else {
            CStr::from_ptr(p).to_string_lossy().into_owned()
        }
    }
    unsafe fn walk(view: *mut AnyObject, panel: &mut AlertPanel) {
        let tf = AnyClass::get(c"NSTextField").unwrap();
        let btn = AnyClass::get(c"NSButton").unwrap();
        let is_tf: bool = msg_send![view, isKindOfClass: tf];
        if is_tf {
            let v: *mut AnyObject = msg_send![view, stringValue];
            let v = ns_str(v);
            if !v.is_empty() {
                panel.texts.push(v);
            }
        }
        let is_btn: bool = msg_send![view, isKindOfClass: btn];
        if is_btn {
            let t: *mut AnyObject = msg_send![view, title];
            let t = ns_str(t);
            if !t.is_empty() {
                panel.buttons.push(t);
                panel.button_ptrs.push(view as usize);
            }
        }
        let subs: *mut AnyObject = msg_send![view, subviews];
        let n: usize = msg_send![subs, count];
        for i in 0..n {
            let v: *mut AnyObject = msg_send![subs, objectAtIndex: i];
            walk(v, panel);
        }
    }
    let mut panels = Vec::new();
    unsafe {
        let nsapp: *mut AnyObject =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let windows: *mut AnyObject = msg_send![nsapp, windows];
        let count: usize = msg_send![windows, count];
        for i in 0..count {
            let w: *mut AnyObject = msg_send![windows, objectAtIndex: i];
            let name = (*w).class().name().to_string_lossy().into_owned();
            let visible: bool = msg_send![w, isVisible];
            if !name.contains("AlertPanel") || !visible {
                continue;
            }
            let mut panel = AlertPanel {
                class: name,
                texts: vec![],
                buttons: vec![],
                button_ptrs: vec![],
            };
            let cv: *mut AnyObject = msg_send![w, contentView];
            walk(cv, &mut panel);
            panels.push(panel);
        }
    }
    panels
}

#[cfg(target_os = "macos")]
fn click_alert_button(label: &str) -> Option<Value> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    for panel in alert_panels() {
        for (title, ptr) in panel.buttons.iter().zip(&panel.button_ptrs) {
            if label.split('|').any(|l| l == title) {
                unsafe {
                    let _: () = msg_send![*ptr as *mut AnyObject, performClick: std::ptr::null_mut::<AnyObject>()];
                }
                return Some(
                    json!({ "class": panel.class, "texts": panel.texts, "buttons": panel.buttons, "clicked": title }),
                );
            }
        }
    }
    None
}

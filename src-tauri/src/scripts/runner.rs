//! Running a script, and probing the interpreter (plan AD-13, §7.6). Owner: **WP4.5**.
//!
//! A script is a normal program with the user's rights; gEdit cannot sandbox it. What it
//! can do is make sure a script never outlives the window, never fills memory, and never
//! learns anything from the webview it was not given:
//!
//! - cwd is the script's own folder, so relative imports and data files work.
//! - Environment: `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`, `PYTHONDONTWRITEBYTECODE=1`,
//!   `PYTHONPATH=<bundled scripts folder>` (so a user script can `import gedit_nc`), and
//!   `GEDIT_CONTEXT=<the temp file from [`super::context`]>`. `PYTHONPATH` is **set**,
//!   not extended: an inherited one could shadow `gedit_nc` with anything.
//! - On Unix the child gets `process_group(0)` and is killed with `killpg`, so a script
//!   that spawned its own children does not leave grandchildren behind (F19). On Windows
//!   only the child itself is killed.
//! - [`POLL`] against the deadline and the cancel flag, then a [`DRAIN_GRACE`] before the
//!   pipes are given up on.
//! - stdout is capped at [`MAX_STDOUT_BYTES`] and stderr at [`MAX_STDERR_BYTES`]. The
//!   readers keep draining past the cap — a full pipe would block the child instead of
//!   ending the run — and set `stdoutTruncated`.
//! - The context folder is removed by an RAII guard, on every path out.
//! - Interpreter order: `GEDIT_PYTHON`, then `scripts.python` from the settings file
//!   (only when it names an existing file), then [`crate::python::interpreter`].
//!
//! **Killing by pid is only safe while the child has not been reaped**, or the pid may
//! have been recycled by then and `killpg` would hit a stranger. [`RunState`] keeps the
//! pid behind a mutex that the runner holds across its `try_wait`, and clears it in the
//! same breath as the reap — so a pid read out of a [`RunState`] is always still the
//! child's. That is also why `script_cancel` does not need the child handle.
//!
//! `python_check` runs `<interpreter> -c "<version probe>"` with a 5 s timeout, requires
//! 3.9 or newer, and reads exit code 9009 on Windows as "Python was not found" (that is
//! what the Windows Store alias returns).
//!
//! Everything that decides anything takes a [`RunPlan`], not a script id, so the tests
//! drive the deadline, the cancel, the caps and the process-group kill through `/bin/sh`
//! instead of needing a Python on the machine.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::context::ContextDir;
use super::discovery::{self, Resolved};
use super::settings::{ScriptSettings, MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS};

/// How often the runner looks at the child, the deadline and the cancel flag.
pub const POLL: Duration = Duration::from_millis(20);

/// How long the pipes are still read after the child is gone. A grandchild that
/// inherited stdout can hold it open for ever, so the wait has to end.
pub const DRAIN_GRACE: Duration = Duration::from_millis(300);

/// stdout above this is dropped and `stdoutTruncated` is set.
///
/// It is the whole result of a `replace` run, so it has to clear the largest program the
/// editor will open — `MAX_OPEN_BYTES` in `app/fileOps.ts` is 50 MiB — with room for a
/// script that grows one. 64 MiB is that, and no more.
///
/// It used to be 200 MiB, which the review costed out: the drain buffer keeps the bytes,
/// `collect` makes a second copy as a `String`, `serde_json` escapes that into a third
/// while serialising `RunResult`, and the webview materialises a fourth before the
/// frontend has looked at `success`. Near the cap that is well over a gigabyte of live
/// allocations for one run, on a machine that may have eight — an out-of-memory or a
/// multi-second freeze, paid for in full before anything could reject it (G8 M4). A
/// script that really does emit more says so through `stdoutTruncated`, which is what
/// that field is for.
pub const MAX_STDOUT_BYTES: usize = 64 * 1024 * 1024;

/// stderr is a message for a human, so a much smaller cap is plenty.
pub const MAX_STDERR_BYTES: usize = 1024 * 1024;

/// How long `python_check` waits for `-c` to answer.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// How long [`kill_all`] waits for the runners to let go of their children and their
/// temp folders before the app exits anyway.
pub const EXIT_GRACE: Duration = Duration::from_millis(1500);

/// The oldest Python the bundled scripts are written for (plan AD-13, gate G4).
pub const MIN_PYTHON: (u32, u32) = (3, 9);

/// What the Windows Store's `python` alias exits with when nothing is installed.
const WINDOWS_NOT_FOUND: i32 = 9009;

/// What `python_check` asks the interpreter. One line, no imports beyond `sys`, so it
/// answers on a broken install as long as the interpreter itself starts.
const VERSION_PROBE: &str = "import sys; print('%d.%d.%d' % sys.version_info[:3])";

/// What the webview asks for (§7.6 `RunRequest`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    /// The webview's id for this run; `script_cancel` uses it.
    pub run_id: String,
    /// `root:name.py` or `root:group/name.py` — never a path.
    pub script_id: String,
    /// The text for the script's stdin, LF-joined.
    pub stdin: String,
    /// `ScriptContextV2` (plan §7.5), written to the `GEDIT_CONTEXT` file as-is.
    pub context: serde_json::Value,
    /// Overrides the header's `timeout` and `scripts.timeoutSeconds`.
    pub timeout_secs: Option<u64>,
}

/// The outcome of one run (§7.6 `RunResult`). A run that failed to start is an `Err`
/// instead, so "the script ran and failed" and "nothing ran" stay distinguishable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    /// `None` when the child was killed by a signal.
    pub exit_code: Option<i32>,
    /// Exit code 0, and neither timed out nor cancelled.
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
    /// stdout hit the [`MAX_STDOUT_BYTES`] cap; what is above it was dropped.
    pub stdout_truncated: bool,
    pub duration_ms: u64,
    /// The interpreter that was used, for the output panel's header line.
    pub interpreter: String,
}

/// The Python probe (§7.6 `PythonStatus`). `message` is English detail text (AD-14):
/// the UI shows a translated summary above it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonStatus {
    pub ok: bool,
    pub interpreter: Option<String>,
    /// `3.12.4`, as the interpreter reports it.
    pub version: Option<String>,
    pub message: Option<String>,
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/// One in-flight run, shared between its runner, `script_cancel` and [`kill_all`].
#[derive(Debug, Default)]
pub struct RunState {
    cancel: AtomicBool,
    /// The child's process id while it is running and **not yet reaped**. The runner
    /// holds this mutex across `try_wait`/`wait` and clears the pid before it reaps, so
    /// whoever reads a pid out of here under the lock knows it is still the child's and
    /// not some later process that inherited the number.
    live: Mutex<Option<u32>>,
}

impl RunState {
    /// Whether the run has been asked to stop.
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// Asks the run to stop, and kills its process group right away when one is live.
    /// The runner notices the flag within [`POLL`] either way.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Some(pid) = *self.live() {
            kill_group(pid);
        }
    }

    /// The pid slot. A poisoned mutex is used anyway: the only thing it holds is a
    /// number, and refusing to kill a child because another thread panicked is worse
    /// than reading a value that is still perfectly good.
    fn live(&self) -> MutexGuard<'_, Option<u32>> {
        self.live.lock().unwrap_or_else(|err| err.into_inner())
    }
}

/// The runs that are in flight, by `runId`.
///
/// Managed state (`lib.rs` calls `.manage(RunRegistry::default())`), so `script_run` and
/// `script_cancel` see the same registry although they arrive on different threads.
#[derive(Debug, Default)]
pub struct RunRegistry {
    runs: Mutex<HashMap<String, Arc<RunState>>>,
}

impl RunRegistry {
    /// Registers `run_id` and hands back the state its runner polls. A repeated id
    /// replaces the old entry, which cancels the run that held it.
    pub fn start(&self, run_id: &str) -> Arc<RunState> {
        let state = Arc::new(RunState::default());
        if let Some(previous) = self.lock().insert(run_id.to_string(), Arc::clone(&state)) {
            previous.cancel();
        }
        state
    }

    /// Drops `run_id` from the registry once its runner is done — but only when the
    /// entry is still the one that runner registered.
    ///
    /// Ids are reused: the webview starts a run, the run is replaced by another with the
    /// same id, and [`start`](Self::start) cancels the first. The first runner then winds
    /// down and its guard fires. Removing by id alone would delete the **second** run's
    /// registration, after which `script_cancel` answers false, `len` is 0, and
    /// [`kill_all`] returns on `cancel_all() == 0` without killing a `while True:` script
    /// or its process group — which is the one thing F19 promises cannot happen (G8 M4).
    pub fn finish(&self, run_id: &str, state: &Arc<RunState>) {
        let mut runs = self.lock();
        if let std::collections::hash_map::Entry::Occupied(entry) = runs.entry(run_id.to_string()) {
            if Arc::ptr_eq(entry.get(), state) {
                entry.remove();
            }
        }
    }

    /// Asks the run to stop. False when the id is unknown, which is what a Cancel click
    /// after the script already exited looks like.
    pub fn cancel(&self, run_id: &str) -> bool {
        let state = self.lock().get(run_id).map(Arc::clone);
        match state {
            Some(state) => {
                state.cancel();
                true
            }
            None => false,
        }
    }

    /// Asks every live run to stop, and kills their process groups. Used by [`kill_all`].
    pub fn cancel_all(&self) -> usize {
        let states: Vec<Arc<RunState>> = self.lock().values().map(Arc::clone).collect();
        for state in &states {
            state.cancel();
        }
        states.len()
    }

    /// How many runs are still in flight.
    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<RunState>>> {
        self.runs.lock().unwrap_or_else(|err| err.into_inner())
    }
}

/// Keeps the registry honest: the entry goes away however the runner leaves.
///
/// It holds the `Arc` it registered, not only the id, so that a runner whose id has since
/// been taken over by a newer run removes nothing (see [`RunRegistry::finish`]).
struct Registered<'a> {
    registry: &'a RunRegistry,
    run_id: String,
    state: Arc<RunState>,
}

impl<'a> Registered<'a> {
    /// Registers `run_id` and hands back both the state to poll and the guard that
    /// removes it. The two cannot drift apart this way.
    fn start(registry: &'a RunRegistry, run_id: &str) -> (Arc<RunState>, Self) {
        let state = registry.start(run_id);
        let guard = Self {
            registry,
            run_id: run_id.to_string(),
            state: Arc::clone(&state),
        };
        (state, guard)
    }
}

impl Drop for Registered<'_> {
    fn drop(&mut self) {
        self.registry.finish(&self.run_id, &self.state);
    }
}

// ---------------------------------------------------------------------------
// Running one child
// ---------------------------------------------------------------------------

/// Everything [`execute`] needs. Built by [`plan_run`] for a script, and by hand in the
/// tests, which is the injectable-interpreter seam: `/bin/sh -c '…'` behaves like a
/// script without one having to be installed.
#[derive(Debug, Clone)]
pub struct RunPlan {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    /// The script's own folder; `None` inherits the app's, which is what the probe wants.
    pub cwd: Option<PathBuf>,
    /// Added to the inherited environment, never replacing it.
    pub env: Vec<(String, OsString)>,
    pub stdin: String,
    pub timeout: Duration,
    pub stdout_cap: usize,
    pub stderr_cap: usize,
}

impl RunPlan {
    /// A plan that just runs a program and reads its answer: no context, no caps worth
    /// the name, the app's own folder.
    pub fn probe(program: &Path, args: &[&str], timeout: Duration) -> Self {
        Self {
            program: program.to_path_buf(),
            args: args.iter().map(OsString::from).collect(),
            cwd: None,
            env: Vec::new(),
            stdin: String::new(),
            timeout,
            stdout_cap: 64 * 1024,
            stderr_cap: 64 * 1024,
        }
    }
}

/// What one child produced.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RunOutcome {
    /// `None` when the process was killed by a signal.
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdout_truncated: bool,
    pub duration_ms: u64,
}

impl RunOutcome {
    /// Exit code 0, and neither timed out nor cancelled.
    pub fn success(&self) -> bool {
        self.exit_code == Some(0) && !self.timed_out && !self.cancelled
    }
}

/// Spawns the plan, watches it, and answers with everything it produced.
///
/// `Err` means nothing ran — the program could not be started. A program that started
/// and failed is an `Ok` with a non-zero `exit_code`, because the panel has to show its
/// stderr and the caller has to know not to apply its stdout.
pub fn execute(plan: &RunPlan, state: &RunState) -> Result<RunOutcome, String> {
    let started = Instant::now();
    let mut command = Command::new(&plan.program);
    command
        .args(&plan.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &plan.cwd {
        command.current_dir(cwd);
    }
    for (key, value) in &plan.env {
        command.env(key, value);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so that killing the run kills whatever it spawned.
        // The child is the group leader, so the group id is its pid.
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start {} ({err})", plan.program.to_string_lossy()))?;
    *state.live() = Some(child.id());

    // stdin goes out on its own thread: a script that writes a lot before it has read
    // all of its input would otherwise deadlock against a full pipe. A script that never
    // reads stdin closes the pipe early, which is not an error.
    if let Some(mut stdin) = child.stdin.take() {
        let text = plan.stdin.clone();
        std::thread::spawn(move || {
            let _ = stdin.write_all(text.as_bytes());
        });
    }
    let stdout = child.stdout.take().map(|pipe| drain(pipe, plan.stdout_cap));
    let stderr = child.stderr.take().map(|pipe| drain(pipe, plan.stderr_cap));

    let watched = watch(&mut child, state, started + plan.timeout);
    // The flag is what the user asked for, whoever won the race with the child's own
    // exit: a run the user cancelled must not have its output applied.
    let cancelled = state.is_cancelled();

    // One grace for both pipes, not one each: the app is waiting on this answer.
    let drained_by = Instant::now() + DRAIN_GRACE;
    let (stdout, stdout_truncated) = collect(stdout, drained_by);
    let (stderr, _) = collect(stderr, drained_by);
    let watched = watched?;
    Ok(RunOutcome {
        exit_code: watched.exit_code,
        stdout,
        stderr,
        timed_out: watched.timed_out,
        cancelled,
        stdout_truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// What the watch loop saw.
struct Watched {
    exit_code: Option<i32>,
    timed_out: bool,
}

/// Polls the child until it exits, the deadline passes or the run is cancelled, killing
/// it in the latter two cases. The child is reaped before this returns, on every path
/// but an `Err` — and an `Err` means waiting is what failed, so there is nothing left to
/// try.
fn watch(child: &mut Child, state: &RunState, deadline: Instant) -> Result<Watched, String> {
    loop {
        // Held across `try_wait` so that a `cancel` racing with the reap either kills a
        // pid that is still the child's, or finds the slot already cleared.
        let mut live = state.live();
        match child.try_wait() {
            Ok(Some(status)) => {
                *live = None;
                return Ok(Watched {
                    exit_code: status.code(),
                    timed_out: false,
                });
            }
            Ok(None) => {}
            Err(err) => {
                *live = None;
                return Err(format!("Failed to wait for the script ({err})"));
            }
        }

        let timed_out = Instant::now() >= deadline;
        if timed_out || state.is_cancelled() {
            if let Some(pid) = *live {
                kill_group(pid);
            }
            // The group kill does not reach the leader on Windows, and costs nothing
            // on Unix where it has already had its signal.
            let _ = child.kill();
            *live = None;
            drop(live);
            let exit_code = child.wait().ok().and_then(|status| status.code());
            return Ok(Watched {
                exit_code,
                timed_out,
            });
        }
        drop(live);
        std::thread::sleep(POLL);
    }
}

/// SIGKILLs a process group. Only ever called with a pid that has not been reaped yet
/// (see [`RunState::live`]), so the number still belongs to our child.
#[cfg(unix)]
fn kill_group(pid: u32) {
    // SAFETY: `killpg` on a pid that is still a live (or zombie) child of this process.
    // The worst it can do is fail with ESRCH, which is ignored.
    unsafe {
        libc::killpg(pid as libc::pid_t, libc::SIGKILL);
    }
}

/// Windows has no process groups of this kind; the runner's own `child.kill()` is what
/// stops the script, and a grandchild it spawned is out of reach (plan AD-13).
#[cfg(not(unix))]
fn kill_group(_pid: u32) {}

/// Reads a pipe to the end on its own thread, keeping at most `cap` bytes.
///
/// It keeps reading past the cap on purpose: stopping would fill the pipe and block the
/// child for ever instead of letting it finish.
fn drain<R: Read + Send + 'static>(mut pipe: R, cap: usize) -> Receiver<(Vec<u8>, bool)> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 64 * 1024];
        let mut kept: Vec<u8> = Vec::new();
        let mut truncated = false;
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let room = cap.saturating_sub(kept.len());
                    if room >= read {
                        kept.extend_from_slice(&buffer[..read]);
                    } else {
                        kept.extend_from_slice(&buffer[..room]);
                        truncated = true;
                    }
                }
                Err(err) if err.kind() == ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
        let _ = sender.send((kept, truncated));
    });
    receiver
}

/// Waits for one pipe's reader until `deadline`. Text that is not valid UTF-8 — a
/// `latin1` comment a script echoed back, or a cut in the middle of a character at the
/// cap — is decoded lossily rather than losing the whole output.
fn collect(pipe: Option<Receiver<(Vec<u8>, bool)>>, deadline: Instant) -> (String, bool) {
    let Some(pipe) = pipe else {
        return (String::new(), false);
    };
    let grace = deadline.saturating_duration_since(Instant::now());
    let (bytes, truncated) = pipe.recv_timeout(grace).unwrap_or_default();
    (String::from_utf8_lossy(&bytes).into_owned(), truncated)
}

// ---------------------------------------------------------------------------
// The interpreter
// ---------------------------------------------------------------------------

/// The interpreter for scripts, in the order of AD-13: the `GEDIT_PYTHON` environment
/// variable, then `scripts.python` from the settings (only when it names a file that
/// exists), then the resolver that looks the user's own `python3` up.
pub fn interpreter(settings: &ScriptSettings) -> PathBuf {
    interpreter_with(std::env::var_os("GEDIT_PYTHON"), settings)
}

/// [`interpreter`] with the environment variable passed in, so the order can be tested
/// without touching a process-wide variable other tests are reading.
pub fn interpreter_with(from_env: Option<OsString>, settings: &ScriptSettings) -> PathBuf {
    if let Some(from_env) = from_env.filter(|value| !value.is_empty()) {
        return PathBuf::from(from_env);
    }
    // The resolver is the last resort because it shells out to a login shell; a
    // configured interpreter must not pay for that.
    settings
        .python
        .clone()
        .unwrap_or_else(crate::python::interpreter)
}

/// Runs the version probe and judges the answer.
pub fn probe(interpreter: &Path) -> PythonStatus {
    let plan = RunPlan::probe(interpreter, &["-c", VERSION_PROBE], PROBE_TIMEOUT);
    let outcome = execute(&plan, &RunState::default());
    judge(&interpreter.to_string_lossy(), outcome)
}

/// What a probe's outcome means. Split out so the rules can be tested without spawning.
fn judge(interpreter: &str, outcome: Result<RunOutcome, String>) -> PythonStatus {
    let unusable = |message: String| PythonStatus {
        ok: false,
        interpreter: Some(interpreter.to_string()),
        version: None,
        message: Some(message),
    };
    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(err) => return unusable(err),
    };
    if outcome.timed_out {
        return unusable(format!(
            "{interpreter} did not answer within {} seconds",
            PROBE_TIMEOUT.as_secs()
        ));
    }
    // The Windows Store's `python` alias is a stub that opens the Store and exits 9009.
    if outcome.exit_code == Some(WINDOWS_NOT_FOUND) {
        return unusable(format!("Python was not found ({interpreter})"));
    }
    if !outcome.success() {
        let detail = outcome.stderr.trim();
        let detail = if detail.is_empty() {
            match outcome.exit_code {
                Some(code) => format!("exit code {code}"),
                None => "killed by a signal".to_string(),
            }
        } else {
            detail.to_string()
        };
        return unusable(format!("{interpreter} could not be run: {detail}"));
    }
    let Some(version) = outcome
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
    else {
        return unusable(format!("{interpreter} did not report a version"));
    };
    let Some(parsed) = parse_version(version) else {
        return unusable(format!(
            "{interpreter} reported an unexpected version: {version}"
        ));
    };
    if parsed < MIN_PYTHON {
        return PythonStatus {
            ok: false,
            interpreter: Some(interpreter.to_string()),
            version: Some(version.to_string()),
            message: Some(format!(
                "Python {version} is too old; {}.{} or newer is required",
                MIN_PYTHON.0, MIN_PYTHON.1
            )),
        };
    }
    PythonStatus {
        ok: true,
        interpreter: Some(interpreter.to_string()),
        version: Some(version.to_string()),
        message: None,
    }
}

/// `3.12.4` → `(3, 12)`. Anything that is not two numbers separated by a dot is not a
/// version this build knows how to judge.
fn parse_version(text: &str) -> Option<(u32, u32)> {
    let mut parts = text.split('.');
    let major = parts.next()?.trim().parse().ok()?;
    let minor = parts.next()?.trim().parse().ok()?;
    Some((major, minor))
}

// ---------------------------------------------------------------------------
// Planning a script run
// ---------------------------------------------------------------------------

/// The seconds a run gets: the webview's override, else the header, else the setting.
pub fn timeout_secs(
    requested: Option<u64>,
    from_header: Option<u64>,
    settings: &ScriptSettings,
) -> u64 {
    requested
        .or(from_header)
        .unwrap_or(settings.timeout_seconds)
        .clamp(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
}

/// The environment a script is given, on top of the one it inherits (plan AD-13).
pub fn script_env(bundled: Option<&Path>, context_file: &Path) -> Vec<(String, OsString)> {
    let mut env = vec![
        ("PYTHONUTF8".to_string(), OsString::from("1")),
        ("PYTHONIOENCODING".to_string(), OsString::from("utf-8")),
        ("PYTHONDONTWRITEBYTECODE".to_string(), OsString::from("1")),
        (
            "GEDIT_CONTEXT".to_string(),
            context_file.as_os_str().to_os_string(),
        ),
    ];
    if let Some(bundled) = bundled {
        // Set, not prepended: an inherited `PYTHONPATH` could put another `gedit_nc`
        // ahead of ours, and a bundled script would then be running someone else's code.
        env.push(("PYTHONPATH".to_string(), bundled.as_os_str().to_os_string()));
    }
    env
}

/// The plan for one script, given everything already resolved.
fn plan_run(
    script: &Resolved,
    interpreter: &Path,
    bundled: Option<&Path>,
    context: &ContextDir,
    stdin: String,
    timeout: Duration,
) -> RunPlan {
    RunPlan {
        program: interpreter.to_path_buf(),
        args: vec![script.path.as_os_str().to_os_string()],
        // The script's own folder, so relative imports and data files work.
        cwd: Some(script.folder().to_path_buf()),
        env: script_env(bundled, &context.context_file()),
        stdin,
        timeout,
        stdout_cap: MAX_STDOUT_BYTES,
        stderr_cap: MAX_STDERR_BYTES,
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Runs a script and answers with everything the output panel needs.
///
/// `async` so the run happens on Tauri's runtime and the window stays responsive.
#[tauri::command(async)]
pub fn script_run(
    app: AppHandle,
    runs: State<'_, RunRegistry>,
    req: RunRequest,
) -> Result<RunResult, String> {
    let settings = ScriptSettings::load(&app);
    let roots = discovery::roots_with(&app, &settings)?;
    let script = discovery::resolve_id(&roots, &req.script_id)?;
    // The header is read again here rather than trusted from the webview's last
    // `scripts_list`: the file on disk is what is about to run.
    let from_header = discovery::header_of(&script.path)
        .meta
        .and_then(|meta| meta.timeout);
    let timeout = Duration::from_secs(timeout_secs(req.timeout_secs, from_header, &settings));

    let interpreter = interpreter(&settings);
    let bundled = discovery::bundled_dir(&app);
    // Dropped at the end of this function, whichever way it leaves.
    let context = ContextDir::create(&req.context)?;
    let plan = plan_run(
        &script,
        &interpreter,
        bundled.as_deref(),
        &context,
        req.stdin,
        timeout,
    );

    let (state, _registered) = Registered::start(&runs, &req.run_id);
    let outcome = execute(&plan, &state)?;
    Ok(RunResult {
        exit_code: outcome.exit_code,
        success: outcome.success(),
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        timed_out: outcome.timed_out,
        cancelled: outcome.cancelled,
        stdout_truncated: outcome.stdout_truncated,
        duration_ms: outcome.duration_ms,
        interpreter: interpreter.to_string_lossy().into_owned(),
    })
}

/// Asks the run to stop. True when it was still running.
#[tauri::command]
pub fn script_cancel(runs: State<'_, RunRegistry>, run_id: String) -> bool {
    runs.cancel(&run_id)
}

/// Whether there is a usable Python, and which one.
#[tauri::command(async)]
pub fn python_check(app: AppHandle) -> PythonStatus {
    probe(&interpreter(&ScriptSettings::load(&app)))
}

/// Stops every script process, called from `on_run_event` on `RunEvent::Exit`
/// (plan AD-13), so quitting cannot leave a `while True:` script running.
///
/// The kill itself is immediate on Unix. The wait afterwards is what Windows needs — its
/// children are stopped by their own runner — and it is also what gives every runner
/// time to remove its context folder before the process goes away.
pub fn kill_all(app: &AppHandle) {
    let Some(runs) = app.try_state::<RunRegistry>() else {
        return;
    };
    if runs.cancel_all() == 0 {
        return;
    }
    wait_until_idle(&runs, EXIT_GRACE);
}

/// Waits for every run to finish, for at most `grace`. Answers whether it did.
pub fn wait_until_idle(runs: &RunRegistry, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        if runs.is_empty() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(POLL / 2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- the registry ------------------------------------------------------

    #[test]
    fn cancel_answers_false_for_a_run_that_is_not_registered() {
        let registry = RunRegistry::default();
        assert!(!registry.cancel("r1"));
        assert!(registry.is_empty());
    }

    #[test]
    fn cancel_sets_the_flag_of_a_live_run() {
        let registry = RunRegistry::default();
        let state = registry.start("r1");
        assert!(!state.is_cancelled());
        assert_eq!(registry.len(), 1);
        assert!(registry.cancel("r1"));
        assert!(state.is_cancelled());
        registry.finish("r1", &state);
        assert!(!registry.cancel("r1"));
        assert!(registry.is_empty());
    }

    #[test]
    fn cancel_all_stops_every_live_run() {
        let registry = RunRegistry::default();
        let first = registry.start("r1");
        let second = registry.start("r2");
        assert_eq!(registry.cancel_all(), 2);
        assert!(first.is_cancelled());
        assert!(second.is_cancelled());
    }

    /// A reused run id must not leave the earlier runner polling a flag nobody can set.
    #[test]
    fn starting_the_same_id_twice_cancels_the_first() {
        let registry = RunRegistry::default();
        let first = registry.start("r1");
        let second = registry.start("r1");
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
    }

    #[test]
    fn the_registration_guard_clears_the_entry_however_the_runner_leaves() {
        let registry = RunRegistry::default();
        {
            let (_state, _registered) = Registered::start(&registry, "r1");
            assert_eq!(registry.len(), 1);
        }
        assert!(registry.is_empty());
        assert!(wait_until_idle(&registry, Duration::from_millis(0)));
    }

    /// The first runner of a reused id must not unregister the run that replaced it.
    ///
    /// G8 M4: `finish` removed by id alone, so the cancelled run's guard deleted the
    /// *new* run's entry on its way out. After that `script_cancel` answered false and
    /// `kill_all` returned on `cancel_all() == 0` without killing anything — a
    /// `while True:` script outliving the window, which is exactly what F19 forbids.
    #[test]
    fn a_finishing_runner_does_not_unregister_the_run_that_took_its_id() {
        let registry = RunRegistry::default();
        let (first, first_guard) = Registered::start(&registry, "r1");
        let (second, _second_guard) = Registered::start(&registry, "r1");
        assert!(
            first.is_cancelled(),
            "starting the same id cancels the first run"
        );
        assert!(!second.is_cancelled());

        drop(first_guard);

        assert_eq!(registry.len(), 1, "the second run is still registered");
        assert!(registry.cancel("r1"), "and can still be cancelled");
        assert!(second.is_cancelled());
        assert_eq!(
            registry.cancel_all(),
            1,
            "so kill_all has something to kill"
        );
    }

    /// And the guard of the run that *is* registered still clears it.
    #[test]
    fn the_second_runner_of_a_reused_id_clears_the_entry_when_it_leaves() {
        let registry = RunRegistry::default();
        let (_first, first_guard) = Registered::start(&registry, "r1");
        {
            let (_second, _second_guard) = Registered::start(&registry, "r1");
            drop(first_guard);
            assert_eq!(registry.len(), 1);
        }
        assert!(registry.is_empty());
    }

    // -- the version probe -------------------------------------------------

    fn outcome(exit_code: i32, stdout: &str, stderr: &str) -> Result<RunOutcome, String> {
        Ok(RunOutcome {
            exit_code: Some(exit_code),
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
            ..RunOutcome::default()
        })
    }

    #[test]
    fn accepts_a_supported_python() {
        let status = judge("/usr/bin/python3", outcome(0, "3.12.4\n", ""));
        assert_eq!(
            status,
            PythonStatus {
                ok: true,
                interpreter: Some("/usr/bin/python3".to_string()),
                version: Some("3.12.4".to_string()),
                message: None,
            }
        );
        assert!(judge("p", outcome(0, "3.9.6\n", "")).ok);
        assert!(judge("p", outcome(0, "4.0.0\n", "")).ok);
    }

    #[test]
    fn refuses_a_python_older_than_the_bundled_scripts_need() {
        let status = judge("p", outcome(0, "3.8.10\n", ""));
        assert!(!status.ok);
        assert_eq!(status.version.as_deref(), Some("3.8.10"));
        assert!(status.message.unwrap().contains("too old"));
        assert!(!judge("p", outcome(0, "2.7.18\n", "")).ok);
    }

    #[test]
    fn reads_exit_code_9009_as_python_was_not_found() {
        let status = judge("python", outcome(WINDOWS_NOT_FOUND, "", ""));
        assert!(!status.ok);
        assert_eq!(status.version, None);
        assert!(status.message.unwrap().contains("Python was not found"));
    }

    #[test]
    fn reports_a_probe_that_could_not_run_at_all() {
        for (probe, expected) in [
            (Err("no such file".to_string()), "no such file"),
            (
                outcome(1, "", "ImportError: broken install"),
                "broken install",
            ),
            (outcome(1, "", ""), "exit code 1"),
            (outcome(0, "  \n", ""), "did not report a version"),
            (outcome(0, "Python 3.12\n", ""), "unexpected version"),
        ] {
            let status = judge("p", probe);
            assert!(!status.ok);
            let message = status.message.unwrap();
            assert!(message.contains(expected), "{message}");
        }
        let timed_out = Ok(RunOutcome {
            timed_out: true,
            ..RunOutcome::default()
        });
        assert!(judge("p", timed_out).message.unwrap().contains("5 seconds"));
    }

    // -- the timeout and the environment -----------------------------------

    #[test]
    fn the_request_beats_the_header_and_the_header_beats_the_setting() {
        let settings = ScriptSettings {
            timeout_seconds: 45,
            ..ScriptSettings::default()
        };
        assert_eq!(timeout_secs(Some(5), Some(30), &settings), 5);
        assert_eq!(timeout_secs(None, Some(30), &settings), 30);
        assert_eq!(timeout_secs(None, None, &settings), 45);
        // Whatever arrives, a run always gets a deadline that can be expressed.
        assert_eq!(timeout_secs(Some(0), None, &settings), MIN_TIMEOUT_SECONDS);
        assert_eq!(
            timeout_secs(Some(u64::MAX), None, &settings),
            MAX_TIMEOUT_SECONDS
        );
    }

    #[test]
    fn the_environment_is_the_one_ad_13_asks_for() {
        let env = script_env(
            Some(Path::new("/res/scripts")),
            Path::new("/tmp/x/context.json"),
        );
        let of = |key: &str| {
            env.iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.to_string_lossy().into_owned())
        };
        assert_eq!(of("PYTHONUTF8").as_deref(), Some("1"));
        assert_eq!(of("PYTHONIOENCODING").as_deref(), Some("utf-8"));
        assert_eq!(of("PYTHONDONTWRITEBYTECODE").as_deref(), Some("1"));
        assert_eq!(of("PYTHONPATH").as_deref(), Some("/res/scripts"));
        assert_eq!(of("GEDIT_CONTEXT").as_deref(), Some("/tmp/x/context.json"));
        assert_eq!(env.len(), 5);
        // A dev build without the resource still gets a usable environment.
        assert_eq!(script_env(None, Path::new("/tmp/x/context.json")).len(), 4);
    }

    /// AD-13's order: the environment variable, then the setting, then the resolver.
    /// The resolver itself is `python.rs`'s and is not reached here, because it shells
    /// out to a login shell.
    #[test]
    fn gedit_python_wins_over_the_setting() {
        let configured = ScriptSettings {
            python: Some(PathBuf::from("/from/settings")),
            ..ScriptSettings::default()
        };
        let env = |value: &str| Some(OsString::from(value));
        assert_eq!(
            interpreter_with(env("/from/env"), &configured),
            PathBuf::from("/from/env")
        );
        assert_eq!(
            interpreter_with(None, &configured),
            PathBuf::from("/from/settings")
        );
        // An empty variable is not an answer; it is what an unset one looks like on
        // some shells.
        assert_eq!(
            interpreter_with(env(""), &configured),
            PathBuf::from("/from/settings")
        );
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    //! The runner itself, driven through `/bin/sh`: Unix CI has a shell whether or not
    //! it has a Python, and a shell can be told to hang, to spawn a grandchild and to
    //! print a gigabyte, which is exactly what needs proving.

    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A plan that runs `script` under `/bin/sh`.
    fn sh(script: &str, timeout: Duration) -> RunPlan {
        RunPlan {
            program: PathBuf::from("/bin/sh"),
            args: vec![OsString::from("-c"), OsString::from(script)],
            cwd: None,
            env: Vec::new(),
            stdin: String::new(),
            timeout,
            stdout_cap: MAX_STDOUT_BYTES,
            stderr_cap: MAX_STDERR_BYTES,
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gedit-runner-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn executable(path: &Path, source: &str) {
        std::fs::write(path, source).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn run(plan: &RunPlan) -> RunOutcome {
        execute(plan, &RunState::default()).expect("the plan did not start")
    }

    /// A shell script that puts a grandchild of ours into the background; the
    /// grandchild appends a byte to `marker` a few times a second and outlives its
    /// parent unless the whole process group is killed (F19).
    fn grandchild_script(marker: &Path) -> String {
        format!(
            "(while true; do printf x >> '{}'; sleep 0.05; done) & sleep 30",
            marker.display()
        )
    }

    /// The marker's size, or `None` while the grandchild has not written yet. A growing
    /// file is unambiguous where a modification time would depend on the file system's
    /// timestamp resolution.
    fn still_alive(marker: &Path) -> Option<u64> {
        std::fs::metadata(marker).ok().map(|meta| meta.len())
    }

    /// Whether anything is still appending to the marker.
    fn is_still_growing(marker: &Path) -> bool {
        let before = still_alive(marker);
        std::thread::sleep(Duration::from_millis(250));
        still_alive(marker) != before
    }

    #[test]
    fn passes_stdin_through_and_reports_a_clean_exit() {
        let mut plan = sh("cat", Duration::from_secs(10));
        plan.stdin = "N10 G0 X1.\nN20 G1 Z-5. F100\n".to_string();
        let outcome = run(&plan);
        assert_eq!(outcome.stdout, plan.stdin);
        assert_eq!(outcome.exit_code, Some(0));
        assert!(outcome.success());
        assert!(!outcome.timed_out && !outcome.cancelled && !outcome.stdout_truncated);
    }

    #[test]
    fn a_non_zero_exit_keeps_stderr_and_is_not_a_failure_to_start() {
        let outcome = run(&sh(
            "echo out; echo boom >&2; exit 3",
            Duration::from_secs(10),
        ));
        assert_eq!(outcome.exit_code, Some(3));
        assert!(!outcome.success());
        assert_eq!(outcome.stdout.trim(), "out");
        assert_eq!(outcome.stderr.trim(), "boom");
    }

    #[test]
    fn a_program_that_cannot_be_started_is_an_error_not_an_outcome() {
        let mut plan = sh("true", Duration::from_secs(5));
        plan.program = PathBuf::from("/definitely/not/here");
        let err = execute(&plan, &RunState::default()).unwrap_err();
        assert!(err.contains("/definitely/not/here"), "{err}");
    }

    #[test]
    fn the_cwd_is_the_folder_the_plan_names() {
        let dir = scratch("cwd");
        std::fs::write(dir.join("data.txt"), "from the script's folder").unwrap();
        let mut plan = sh("cat data.txt", Duration::from_secs(10));
        plan.cwd = Some(dir.clone());
        assert_eq!(run(&plan).stdout, "from the script's folder");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_environment_reaches_the_child() {
        let context = ContextDir::create(&serde_json::json!({ "contract": 2 })).unwrap();
        let mut plan = sh(
            "printf '%s|%s|%s|%s\\n' \"$PYTHONUTF8\" \"$PYTHONIOENCODING\" \
             \"$PYTHONDONTWRITEBYTECODE\" \"$PYTHONPATH\"; cat \"$GEDIT_CONTEXT\"",
            Duration::from_secs(10),
        );
        plan.env = script_env(Some(Path::new("/res/scripts")), &context.context_file());
        let outcome = run(&plan);
        let mut lines = outcome.stdout.lines();
        assert_eq!(lines.next(), Some("1|utf-8|1|/res/scripts"));
        assert_eq!(lines.next(), Some(r#"{"contract":2}"#));
    }

    /// The whole point of F19: a script that spawned its own children must not leave
    /// them running, and the kill must land within the grace the plan promises.
    #[test]
    fn a_timeout_kills_the_child_and_its_grandchild() {
        let dir = scratch("timeout");
        let marker = dir.join("grandchild-alive");
        let script = grandchild_script(&marker);
        let started = Instant::now();
        let outcome = run(&sh(&script, Duration::from_millis(400)));
        let elapsed = started.elapsed();
        assert!(outcome.timed_out, "{outcome:?}");
        assert!(!outcome.cancelled);
        assert!(
            elapsed < Duration::from_millis(900),
            "the kill took {elapsed:?}"
        );
        assert!(
            still_alive(&marker).is_some(),
            "the grandchild never started"
        );
        assert!(
            !is_still_growing(&marker),
            "the grandchild outlived the run"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancel_from_another_thread_stops_the_run() {
        let state = Arc::new(RunState::default());
        let asked = Arc::clone(&state);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            asked.cancel();
        });
        let started = Instant::now();
        let outcome = execute(&sh("sleep 30", Duration::from_secs(30)), &state).unwrap();
        assert!(outcome.cancelled, "{outcome:?}");
        assert!(!outcome.timed_out);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    /// Cancelling through the registry is what the Cancel button does, and it has to
    /// reach a run that started on another thread.
    #[test]
    fn the_registry_cancels_a_run_that_is_already_going() {
        let registry = Arc::new(RunRegistry::default());
        let state = registry.start("r1");
        let asked = Arc::clone(&registry);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            assert!(asked.cancel("r1"));
        });
        let outcome = execute(&sh("sleep 30", Duration::from_secs(30)), &state).unwrap();
        registry.finish("r1", &state);
        assert!(outcome.cancelled);
        assert!(registry.is_empty());
    }

    /// Past the cap the reader keeps draining, or the child would block on a full pipe
    /// and the run would hang instead of being truncated.
    #[test]
    fn the_stdout_cap_truncates_and_still_lets_the_child_finish() {
        let mut plan = sh(
            "i=0; while [ $i -lt 200 ]; do printf '0123456789abcdef'; i=$((i+1)); done; \
             echo done >&2; exit 0",
            Duration::from_secs(20),
        );
        plan.stdout_cap = 100;
        let outcome = run(&plan);
        assert_eq!(outcome.exit_code, Some(0), "{outcome:?}");
        assert!(outcome.stdout_truncated);
        assert_eq!(outcome.stdout.len(), 100);
        assert_eq!(outcome.stderr.trim(), "done");
        // Below the cap nothing is dropped and nothing is claimed.
        plan.stdout_cap = MAX_STDOUT_BYTES;
        let outcome = run(&plan);
        assert!(!outcome.stdout_truncated);
        assert_eq!(outcome.stdout.len(), 200 * 16);
    }

    #[test]
    fn stderr_has_its_own_cap() {
        let mut plan = sh(
            "i=0; while [ $i -lt 50 ]; do printf 'x' >&2; i=$((i+1)); done",
            Duration::from_secs(20),
        );
        plan.stderr_cap = 10;
        let outcome = run(&plan);
        assert_eq!(outcome.stderr.len(), 10);
        // A truncated stderr is not what `stdoutTruncated` means.
        assert!(!outcome.stdout_truncated);
    }

    /// The context folder is the run's, and it goes away with it whether the run
    /// succeeded, timed out or never started.
    #[test]
    fn the_context_folder_is_removed_after_every_kind_of_run() {
        for script in ["cat \"$GEDIT_CONTEXT\"", "exit 1", "sleep 30"] {
            let dir;
            {
                let context = ContextDir::create(&serde_json::json!({ "contract": 2 })).unwrap();
                dir = context.dir().to_path_buf();
                let mut plan = sh(script, Duration::from_millis(200));
                plan.env = script_env(None, &context.context_file());
                let _ = run(&plan);
                assert!(dir.is_dir(), "{script}");
            }
            assert!(!dir.exists(), "{script} left {} behind", dir.display());
        }
    }

    /// Quitting must not leave a `while True:` script running (plan AD-13, F19).
    #[test]
    fn kill_all_leaves_no_live_process() {
        let dir = scratch("kill-all");
        let marker = dir.join("alive");
        let registry = Arc::new(RunRegistry::default());
        let script = grandchild_script(&marker);

        let runner = {
            let registry = Arc::clone(&registry);
            std::thread::spawn(move || {
                let (state, _registered) = Registered::start(&registry, "r1");
                execute(&sh(&script, Duration::from_secs(30)), &state).unwrap()
            })
        };
        // Wait for the grandchild to be up, so the kill has something to prove.
        let deadline = Instant::now() + Duration::from_secs(5);
        while still_alive(&marker).is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(still_alive(&marker).is_some(), "the script never started");

        assert_eq!(registry.cancel_all(), 1);
        assert!(
            wait_until_idle(&registry, EXIT_GRACE),
            "a run was still registered after {EXIT_GRACE:?}"
        );
        let outcome = runner.join().unwrap();
        assert!(outcome.cancelled);
        assert!(!is_still_growing(&marker), "a grandchild outlived kill_all");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -- the whole chain ---------------------------------------------------

    /// Discovery, the id, the header's timeout, the context file, the environment, the
    /// cwd and stdin, in one run. `/bin/sh` stands in for the interpreter, so this also
    /// holds on a machine without a Python; the header block is a comment in both
    /// languages, which is what makes that work.
    #[test]
    fn a_script_runs_from_its_id_with_its_header_its_context_and_its_stdin() {
        let dir = scratch("end-to-end");
        let bundled = dir.join("bundled");
        std::fs::create_dir_all(&bundled).unwrap();
        let script = dir.join("echo.py");
        std::fs::write(
            &script,
            "# /// gedit\n\
             # name = \"Echo\"\n\
             # output = \"replace\"\n\
             # timeout = 7\n\
             # ///\n\
             printf 'cwd=%s\\n' \"$(pwd -P)\"\n\
             printf 'path=%s\\n' \"$PYTHONPATH\"\n\
             printf 'context=%s\\n' \"$(cat \"$GEDIT_CONTEXT\")\"\n\
             cat\n",
        )
        .unwrap();

        // 1. Discovery finds it and reads its header.
        let roots = vec![discovery::RootDir {
            name: "user".to_string(),
            dir: dir.clone(),
            editable: true,
            listed: true,
        }];
        let list = discovery::discover(&roots);
        assert_eq!(list.scripts.len(), 1);
        let meta = list.scripts[0].meta.as_ref().expect("no header");
        assert_eq!(meta.name, "Echo");
        assert_eq!(list.scripts[0].id, "user:echo.py");

        // 2. The id resolves, and the header's timeout beats the setting.
        let resolved = discovery::resolve_id(&roots, "user:echo.py").unwrap();
        let settings = ScriptSettings {
            timeout_seconds: 60,
            ..ScriptSettings::default()
        };
        let seconds = timeout_secs(None, meta.timeout, &settings);
        assert_eq!(seconds, 7);

        // 3. The run gets its context, its folder and its stdin.
        let context = ContextDir::create(&serde_json::json!({ "contract": 2 })).unwrap();
        let plan = plan_run(
            &resolved,
            Path::new("/bin/sh"),
            Some(&bundled),
            &context,
            "N10 G0 X1.\n".to_string(),
            Duration::from_secs(seconds),
        );
        let outcome = run(&plan);
        assert!(outcome.success(), "{outcome:?}");
        let expected = format!(
            "cwd={}\npath={}\ncontext={{\"contract\":2}}\nN10 G0 X1.\n",
            std::fs::canonicalize(&dir).unwrap().display(),
            bundled.display()
        );
        assert_eq!(outcome.stdout, expected);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -- python_check against a fake interpreter ---------------------------

    #[test]
    fn probes_a_fake_interpreter() {
        let dir = scratch("probe");
        let good = dir.join("python-good");
        executable(&good, "#!/bin/sh\necho 3.12.4\n");
        let status = probe(&good);
        assert!(status.ok, "{status:?}");
        assert_eq!(status.version.as_deref(), Some("3.12.4"));
        assert_eq!(status.interpreter.as_deref(), good.to_str());

        let old = dir.join("python-old");
        executable(&old, "#!/bin/sh\necho 3.8.10\n");
        let status = probe(&old);
        assert!(!status.ok);
        assert!(status.message.unwrap().contains("too old"));

        let broken = dir.join("python-broken");
        executable(
            &broken,
            "#!/bin/sh\necho 'no module named encodings' >&2\nexit 1\n",
        );
        assert!(!probe(&broken).ok);

        assert!(!probe(&dir.join("python-missing")).ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A probe that hangs must not hang the app; the 5 s budget is the whole point.
    #[test]
    fn a_probe_that_never_answers_times_out() {
        let plan = RunPlan::probe(
            Path::new("/bin/sh"),
            &["-c", "sleep 30"],
            Duration::from_millis(200),
        );
        let started = Instant::now();
        let outcome = execute(&plan, &RunState::default()).unwrap();
        assert!(outcome.timed_out);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(judge("p", Ok(outcome)).message.unwrap().contains("seconds"));
    }
}

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
//!   the child is put in a job object ([`super::job`]) that is terminated the same way,
//!   and that also ends the whole tree if gEdit itself is gone.
//! - [`POLL`] against the deadline and the cancel flag, then a [`DRAIN_GRACE`] before the
//!   pipes are given up on. Output that was still coming when the grace ran out is lost,
//!   and the outcome says so (`stdoutTruncated`, `stderrTruncated`).
//! - stdout is capped at [`MAX_STDOUT_BYTES`] and stderr at [`MAX_STDERR_BYTES`]. The
//!   readers keep draining past the cap — a full pipe would block the child instead of
//!   ending the run — and set `stdoutTruncated` / `stderrTruncated`.
//! - `PATH`: an app started from Finder gets launchd's short `PATH`, so the script's
//!   environment gets the login shell's directories added where they are missing
//!   ([`path_with_login`]); the existing order stays first.
//! - The context folder is removed by an RAII guard, on every path out.
//! - Interpreter order: `GEDIT_PYTHON`, then `scripts.python` from the settings file
//!   (only when it names an existing file), then [`crate::python::interpreter`].
//!
//! **Killing by pid is only safe while the child has not been reaped**, or the pid may
//! have been recycled by then and `killpg` would hit a stranger. [`RunState`] keeps the
//! pid behind a mutex that the runner holds across its `try_wait`, and clears it in the
//! same breath as the reap — so a pid read out of a [`RunState`] is always still the
//! child's. That is also why `script_cancel` does not need the child handle. (The
//! Windows job handle sits in the same slot and goes with it.)
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
use super::meta::{ScriptInput, ScriptMeta, ScriptOutput};
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
/// temp folders before the app exits anyway. The kill itself is immediate on both
/// platforms (`killpg`, `TerminateJobObject`); what is waited for is a runner's context
/// folder being removed, which takes a few polls. A lost folder is a temp file, so this
/// is short: quitting must not feel stuck.
pub const EXIT_GRACE: Duration = Duration::from_millis(300);

/// How long the tests give a runner to wind down after `cancel_all`. This is the
/// old product grace (1.5 s), not the new one: `EXIT_GRACE` itself is asserted below,
/// and a test that held the runner to 300 ms flaked on a machine under load (an
/// idle CI runner does not need the room, a loaded one does).
#[cfg(test)]
const TEST_WAIT: Duration = Duration::from_millis(1500);

/// The oldest Python the bundled scripts are written for (plan AD-13, gate G4).
pub const MIN_PYTHON: (u32, u32) = (3, 9);

/// What the Windows Store's `python` alias exits with when nothing is installed.
///
/// The other half of that story is [`crate::python`], which never *chooses* an
/// interpreter under `WindowsApps` in the first place. This is what happens when one is
/// run anyway: the user pointed `scripts.python` at it, or the lookup found nothing and
/// the bare fallback name resolved to the alias. Both ends have to say the same thing, so
/// neither may be changed without the other.
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
    /// The `input` mode the webview assumed from its last scan (a header-less script is
    /// `selection-or-document`). When the header on disk now says something else the run
    /// is refused with [`HEADER_CHANGED`] so the webview can rescan. `None` skips the check.
    #[serde(default)]
    pub input: Option<ScriptInput>,
    /// The `output` mode the webview assumed, same rule as `input`.
    #[serde(default)]
    pub output: Option<ScriptOutput>,
}

/// The prefix of the error `script_run` answers with when the script's header was
/// edited since the webview scanned it. The webview matches on it (`scripts.ts`), so it
/// is part of the contract; the text after it is for a human.
pub const HEADER_CHANGED: &str = "header-changed:";

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
    /// stdout hit the [`MAX_STDOUT_BYTES`] cap, or the reader did not finish within the
    /// [`DRAIN_GRACE`]; what is above it was dropped.
    pub stdout_truncated: bool,
    /// The same for stderr and [`MAX_STDERR_BYTES`].
    pub stderr_truncated: bool,
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
    /// The child while it is running and **not yet reaped**. The runner holds this
    /// mutex across `try_wait`/`wait` and clears it before it reaps, so whoever reads a
    /// pid out of here under the lock knows it is still the child's and not some later
    /// process that inherited the number.
    live: Mutex<Option<Live>>,
}

/// What it takes to kill a run: the child's pid, and on Windows its job object.
#[derive(Debug)]
struct Live {
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    job: Option<super::job::Job>,
}

impl Live {
    fn of(child: &Child) -> Self {
        Self {
            #[cfg(unix)]
            pid: child.id(),
            #[cfg(windows)]
            job: super::job::Job::around(child),
        }
    }

    /// Ends the child and everything it started: `killpg` on Unix, the job on Windows.
    fn kill_group(&self) {
        kill_group(self);
    }

    /// The run ended by itself: what the script left running is left alone (Windows
    /// closes its job without killing; Unix has nothing to do).
    fn release(self) {
        #[cfg(windows)]
        if let Some(job) = self.job {
            job.release();
        }
    }
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
        if let Some(live) = &*self.live() {
            live.kill_group();
        }
    }

    /// The slot of the live child. A poisoned mutex is used anyway: the only thing it
    /// holds is a pid and a handle, and refusing to kill a child because another thread
    /// panicked is worse than reading a value that is still perfectly good.
    fn live(&self) -> MutexGuard<'_, Option<Live>> {
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
    pub stderr_truncated: bool,
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
    // No console window on Windows (TODO "Next up 10").
    crate::python::hidden(&mut command);

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start {} ({err})", plan.program.to_string_lossy()))?;
    *state.live() = Some(Live::of(&child));

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
    let (stderr, stderr_truncated) = collect(stderr, drained_by);
    let watched = watched?;
    Ok(RunOutcome {
        exit_code: watched.exit_code,
        stdout,
        stderr,
        timed_out: watched.timed_out,
        cancelled,
        stdout_truncated,
        stderr_truncated,
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
                if let Some(live) = live.take() {
                    live.release();
                }
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
            if let Some(live) = &*live {
                live.kill_group();
            }
            // Makes sure of the leader itself even where the group kill found nothing
            // to do (a Windows run without a job); costs nothing where it has already
            // had its signal.
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
fn kill_group(live: &Live) {
    // SAFETY: `killpg` on a pid that is still a live (or zombie) child of this process.
    // The worst it can do is fail with ESRCH, which is ignored.
    unsafe {
        libc::killpg(live.pid as libc::pid_t, libc::SIGKILL);
    }
}

/// Ends the job the child is in, which is the child and everything it started since.
/// Without a job (it could not be made) the runner's own `child.kill()` still stops the
/// script itself.
#[cfg(windows)]
fn kill_group(live: &Live) {
    if let Some(job) = &live.job {
        job.terminate();
    }
}

/// Neither Unix nor Windows: only the runner's own `child.kill()` stops the script.
#[cfg(not(any(unix, windows)))]
fn kill_group(_live: &Live) {}

/// What a pipe's reader has so far, shared with the runner so that a reader that is still
/// going when the grace ends can be asked for what it has instead of giving up everything.
#[derive(Default)]
struct Kept {
    bytes: Vec<u8>,
    /// Bytes above the cap were dropped.
    truncated: bool,
}

/// A pipe being read on its own thread.
struct Drained {
    kept: Arc<Mutex<Kept>>,
    /// Answers when the reader is done (a closed channel counts: the thread is gone).
    done: Receiver<()>,
}

/// Reads a pipe to the end on its own thread, keeping at most `cap` bytes.
///
/// It keeps reading past the cap on purpose: stopping would fill the pipe and block the
/// child for ever instead of letting it finish.
fn drain<R: Read + Send + 'static>(mut pipe: R, cap: usize) -> Drained {
    let (sender, done) = mpsc::channel();
    let kept = Arc::new(Mutex::new(Kept::default()));
    let shared = Arc::clone(&kept);
    std::thread::spawn(move || {
        let mut buffer = [0u8; 64 * 1024];
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let mut kept = shared.lock().unwrap_or_else(|err| err.into_inner());
                    let room = cap.saturating_sub(kept.bytes.len());
                    if room >= read {
                        kept.bytes.extend_from_slice(&buffer[..read]);
                    } else {
                        kept.bytes.extend_from_slice(&buffer[..room]);
                        kept.truncated = true;
                    }
                }
                Err(err) if err.kind() == ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
        let _ = sender.send(());
    });
    Drained { kept, done }
}

/// Waits for one pipe's reader until `deadline`. Text that is not valid UTF-8 — a
/// `latin1` comment a script echoed back, or a cut in the middle of a character at the
/// cap — is decoded lossily rather than losing the whole output.
///
/// The flag is true when text is missing: the cap was hit, **or** the reader was still
/// going when the deadline came (a grandchild that inherited the pipe and keeps it open),
/// in which case what had arrived by then is returned and the rest is lost.
fn collect(pipe: Option<Drained>, deadline: Instant) -> (String, bool) {
    let Some(pipe) = pipe else {
        return (String::new(), false);
    };
    let grace = deadline.saturating_duration_since(Instant::now());
    let finished = !matches!(
        pipe.done.recv_timeout(grace),
        Err(mpsc::RecvTimeoutError::Timeout)
    );
    let mut kept = pipe.kept.lock().unwrap_or_else(|err| err.into_inner());
    let bytes = std::mem::take(&mut kept.bytes);
    let truncated = kept.truncated || !finished;
    (String::from_utf8_lossy(&bytes).into_owned(), truncated)
}

// ---------------------------------------------------------------------------
// The interpreter
// ---------------------------------------------------------------------------

/// The interpreter for scripts, in the order of AD-13: the `GEDIT_PYTHON` environment
/// variable, then `scripts.python` from the settings (only when it names a file that
/// exists), then [`crate::python`], which looks the user's own interpreter up the way
/// their own shell or command prompt would.
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

/// The `PATH` a script gets: the one the app has, with the login shell's directories that
/// it is missing added after them. `None` when that changes nothing.
///
/// An app started from Finder or the Dock gets launchd's short `PATH`
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), so a script that calls `git`, `ffmpeg` or a
/// Homebrew tool by name did not find it, although the same script works from the
/// Terminal. The existing order stays first — what the app was started with is what it
/// was started with — and only the directories that are not there at all are appended.
pub fn path_with_login(
    existing: Option<&std::ffi::OsStr>,
    login: Option<&std::ffi::OsStr>,
) -> Option<OsString> {
    let login = login?;
    let mut dirs: Vec<PathBuf> = existing
        .map(|existing| std::env::split_paths(existing).collect())
        .unwrap_or_default();
    let before = dirs.len();
    for dir in std::env::split_paths(login) {
        if dir.as_os_str().is_empty() || dirs.contains(&dir) {
            continue;
        }
        dirs.push(dir);
    }
    if dirs.len() == before {
        return None;
    }
    std::env::join_paths(dirs).ok()
}

/// Whether the modes the webview assumed differ from the header on disk now.
pub fn header_changed(req: &RunRequest, now: Option<&ScriptMeta>) -> bool {
    let input = now.map_or_else(ScriptInput::default, |meta| meta.input);
    let output = now.map_or_else(ScriptOutput::default, |meta| meta.output);
    req.input.is_some_and(|assumed| assumed != input)
        || req.output.is_some_and(|assumed| assumed != output)
}

/// The plan for one script, given everything already resolved.
fn plan_run(
    script: &Resolved,
    interpreter: &Path,
    bundled: Option<&Path>,
    context: &ContextDir,
    path: Option<OsString>,
    stdin: String,
    timeout: Duration,
) -> RunPlan {
    let mut env = script_env(bundled, &context.context_file());
    if let Some(path) = path {
        env.push(("PATH".to_string(), path));
    }
    RunPlan {
        program: interpreter.to_path_buf(),
        args: vec![script.path.as_os_str().to_os_string()],
        // The script's own folder, so relative imports and data files work.
        cwd: Some(script.folder().to_path_buf()),
        env,
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
    let header = discovery::header_of(&script.path);
    // The webview decides what to send on stdin, whether to ask for a selection and what
    // to do with the answer from the modes it saw at the last scan. A header edited since
    // then would run with the new code under the old modes (a `replace` script that is
    // now `panel`, or the other way round), so the run is refused and the webview rescans.
    if header_changed(&req, header.meta.as_ref()) {
        return Err(format!(
            "{HEADER_CHANGED} the header of {} was changed after the scripts were listed",
            req.script_id
        ));
    }
    let from_header = header.meta.as_ref().and_then(|meta| meta.timeout);
    let timeout = Duration::from_secs(timeout_secs(req.timeout_secs, from_header, &settings));

    let interpreter = interpreter(&settings);
    let path = path_with_login(
        std::env::var_os("PATH").as_deref(),
        crate::python::login_path().as_deref(),
    );
    let bundled = discovery::bundled_dir(&app);
    // Dropped at the end of this function, whichever way it leaves.
    let context = ContextDir::create(&req.context)?;
    let plan = plan_run(
        &script,
        &interpreter,
        bundled.as_deref(),
        &context,
        path,
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
        stderr_truncated: outcome.stderr_truncated,
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
///
/// This is the one place the user asks gEdit to *look*, so it forgets the cached
/// interpreter first: an install made since the app started, or a changed setting, has to
/// win here or it would not win until a restart. Every other caller — `script_run` above —
/// takes the cached answer, which is what keeps the login-shell lookup to once per app
/// (`crate::python`).
#[tauri::command(async)]
pub fn python_check(app: AppHandle) -> PythonStatus {
    crate::python::forget();
    probe(&interpreter(&ScriptSettings::load(&app)))
}

/// Stops every script process, called from `on_run_event` on `RunEvent::Exit`
/// (plan AD-13), so quitting cannot leave a `while True:` script running.
///
/// The kill itself is immediate on both platforms (`killpg`, `TerminateJobObject`). The
/// wait afterwards, at most [`EXIT_GRACE`], is what gives every runner time to reap its
/// child and remove its context folder before the process goes away. A script that
/// somehow outlives the wait on Windows is still ended by the OS: the job closes with
/// the process.
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

    // -- PATH, the header check, the pipes and the quit grace --------------

    #[cfg(unix)]
    fn os(text: &str) -> OsString {
        OsString::from(text)
    }

    /// Finder gives an app launchd's short PATH; the login shell's directories that are
    /// missing are added, behind the ones already there.
    #[cfg(unix)]
    #[test]
    fn the_login_path_adds_the_missing_folders_and_keeps_the_order() {
        let merged = path_with_login(
            Some(&os("/usr/bin:/bin:/usr/sbin:/sbin")),
            Some(&os("/opt/homebrew/bin:/usr/bin:/Users/p/.local/bin:/bin")),
        );
        assert_eq!(
            merged,
            Some(os(
                "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/Users/p/.local/bin"
            ))
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_login_path_changes_nothing_when_it_has_nothing_new_or_is_not_known() {
        // Nothing new: no override at all, so the child inherits exactly what we have.
        assert_eq!(
            path_with_login(Some(&os("/usr/bin:/bin")), Some(&os("/bin:/usr/bin"))),
            None
        );
        // No answer from the shell (Windows, a shell that did not say).
        assert_eq!(path_with_login(Some(&os("/usr/bin")), None), None);
        // No PATH of our own: the login one is the whole thing.
        assert_eq!(
            path_with_login(None, Some(&os("/opt/homebrew/bin:/usr/bin"))),
            Some(os("/opt/homebrew/bin:/usr/bin"))
        );
    }

    /// The environment reaches the child: a script started from Finder finds a tool that
    /// is only in the login shell's PATH.
    #[cfg(unix)]
    #[test]
    fn a_script_finds_a_tool_that_only_the_login_path_has() {
        let dir = std::env::temp_dir().join(format!("gedit-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let tool = dir.join("gedit-test-tool");
        std::fs::write(&tool, "#!/bin/sh\necho found\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let finder_path = os("/usr/bin:/bin");
        let login_path = os(&format!("/usr/bin:{}", dir.display()));
        let merged = path_with_login(Some(&finder_path), Some(&login_path)).unwrap();

        let mut plan = RunPlan::probe(
            Path::new("/bin/sh"),
            &["-c", "gedit-test-tool"],
            Duration::from_secs(10),
        );
        plan.env = vec![("PATH".to_string(), finder_path.clone())];
        let without = execute(&plan, &RunState::default()).unwrap();
        assert!(
            !without.success(),
            "found it without the login PATH: {without:?}"
        );
        plan.env = vec![("PATH".to_string(), merged)];
        let with = execute(&plan, &RunState::default()).unwrap();
        assert_eq!(with.stdout.trim(), "found", "{with:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn request(input: Option<ScriptInput>, output: Option<ScriptOutput>) -> RunRequest {
        RunRequest {
            run_id: "r1".to_string(),
            script_id: "user:a.py".to_string(),
            stdin: String::new(),
            context: serde_json::Value::Null,
            timeout_secs: None,
            input,
            output,
        }
    }

    fn meta(input: ScriptInput, output: ScriptOutput) -> ScriptMeta {
        let mut meta: ScriptMeta = serde_json::from_str(r#"{"name":"A"}"#).unwrap();
        meta.input = input;
        meta.output = output;
        meta
    }

    /// A script edited after the last scan must not run with the modes the webview
    /// prepared from the old header.
    #[test]
    fn a_header_that_changed_since_the_scan_is_noticed() {
        let now = meta(ScriptInput::Selection, ScriptOutput::Replace);
        // What the webview saw matches: run.
        assert!(!header_changed(
            &request(Some(ScriptInput::Selection), Some(ScriptOutput::Replace)),
            Some(&now)
        ));
        // The output mode was edited (replace -> panel is the dangerous direction).
        assert!(header_changed(
            &request(Some(ScriptInput::Selection), Some(ScriptOutput::Panel)),
            Some(&now)
        ));
        // The input mode was edited.
        assert!(header_changed(
            &request(Some(ScriptInput::Document), Some(ScriptOutput::Replace)),
            Some(&now)
        ));
        // A header added to a script that had none: the webview assumed the defaults.
        assert!(header_changed(
            &request(
                Some(ScriptInput::SelectionOrDocument),
                Some(ScriptOutput::Panel)
            ),
            Some(&now)
        ));
        // A header removed: now the defaults.
        assert!(header_changed(
            &request(Some(ScriptInput::Selection), Some(ScriptOutput::Replace)),
            None
        ));
        assert!(!header_changed(
            &request(
                Some(ScriptInput::SelectionOrDocument),
                Some(ScriptOutput::Panel)
            ),
            None
        ));
        // A request that does not say what it assumed is not compared.
        assert!(!header_changed(&request(None, None), Some(&now)));
    }

    #[test]
    fn the_webview_request_carries_the_modes_in_the_headers_spelling() {
        let req: RunRequest = serde_json::from_str(
            r#"{"runId":"r","scriptId":"user:a.py","stdin":"","context":null,
                "timeoutSecs":null,"input":"selection-or-document","output":"new-document"}"#,
        )
        .unwrap();
        assert_eq!(req.input, Some(ScriptInput::SelectionOrDocument));
        assert_eq!(req.output, Some(ScriptOutput::NewDocument));
        // An older caller that sends neither still parses.
        let req: RunRequest = serde_json::from_str(
            r#"{"runId":"r","scriptId":"user:a.py","stdin":"","context":null,"timeoutSecs":null}"#,
        )
        .unwrap();
        assert_eq!((req.input, req.output), (None, None));
    }

    /// A reader that gives one chunk and then does not finish for a while, like a pipe a
    /// grandchild still holds open.
    struct StallsAfterOneChunk(bool);

    impl Read for StallsAfterOneChunk {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if !self.0 {
                self.0 = true;
                buf[..3].copy_from_slice(b"abc");
                return Ok(3);
            }
            std::thread::sleep(Duration::from_millis(1500));
            Ok(0)
        }
    }

    /// Output that was still coming when the grace ran out is lost, and the outcome says
    /// so: what had arrived is kept, the flag is set. Before, the whole output was
    /// dropped silently.
    #[test]
    fn a_reader_that_misses_the_grace_is_reported_as_cut_and_keeps_what_it_had() {
        let pipe = drain(StallsAfterOneChunk(false), 1024);
        let (text, cut) = collect(Some(pipe), Instant::now() + Duration::from_millis(150));
        assert_eq!(text, "abc");
        assert!(cut, "a missed grace must be reported");
    }

    #[test]
    fn a_reader_that_finishes_in_time_is_not_reported_as_cut() {
        let pipe = drain(std::io::Cursor::new(b"abc".to_vec()), 1024);
        let (text, cut) = collect(Some(pipe), Instant::now() + Duration::from_secs(5));
        assert_eq!((text.as_str(), cut), ("abc", false));
        // And a cap is still a cut.
        let pipe = drain(std::io::Cursor::new(b"abcdef".to_vec()), 3);
        let (text, cut) = collect(Some(pipe), Instant::now() + Duration::from_secs(5));
        assert_eq!((text.as_str(), cut), ("abc", true));
    }

    /// Quit waits for the runners, not for a second and a half: the kill is immediate on
    /// both platforms and what is waited for is a temp folder being removed.
    #[test]
    fn quitting_does_not_wait_longer_than_a_third_of_a_second() {
        assert!(EXIT_GRACE <= Duration::from_millis(300), "{EXIT_GRACE:?}");
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
        // A truncated stderr is not what `stdoutTruncated` means, and has its own flag.
        assert!(!outcome.stdout_truncated);
        assert!(outcome.stderr_truncated);
    }

    /// Something the script started that keeps stderr or stdout open after the script is
    /// gone makes the runner stop waiting; the text that never arrived is reported as cut
    /// instead of vanishing.
    #[test]
    fn a_grandchild_holding_the_pipes_open_makes_the_output_cut_not_silently_short() {
        let plan = sh(
            "echo early; echo early-error >&2; (sleep 3) & exit 0",
            Duration::from_secs(20),
        );
        let started = Instant::now();
        let outcome = run(&plan);
        assert!(
            started.elapsed() < Duration::from_millis(2500),
            "waited for the grandchild"
        );
        assert_eq!(outcome.exit_code, Some(0));
        assert_eq!(outcome.stdout.trim(), "early");
        assert_eq!(outcome.stderr.trim(), "early-error");
        assert!(
            outcome.stdout_truncated && outcome.stderr_truncated,
            "{outcome:?}"
        );
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
            wait_until_idle(&registry, TEST_WAIT),
            "a run was still registered after {TEST_WAIT:?}"
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
            None,
            "N10 G0 X1.\n".to_string(),
            Duration::from_secs(seconds),
        );
        let outcome = run(&plan);
        assert!(outcome.success(), "{outcome:?}");
        let expected = format!(
            "cwd={}\npath={}\ncontext={{\"contract\":2}}\nN10 G0 X1.\n",
            // The ordinary spelling, which is what `Resolved.folder()` is (M8).
            crate::paths::plain(&std::fs::canonicalize(&dir).unwrap()).display(),
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

#[cfg(all(test, windows))]
mod windows_tests {
    //! The runner on Windows, driven through `cmd.exe`: every Windows has one whether or
    //! not it has a Python, and it can be told to hang, to fail and to print more than a
    //! pipe holds, which is what needs proving.
    //!
    //! These are the Unix siblings above, one for one. There is no `killpg` here; the job
    //! object of [`super::super::job`] plays its part, and the tests named
    //! `..._grandchild_...` prove it: a program the script started dies with a timeout, a
    //! cancel and a quit, and survives a run that simply ends (as it does on Unix).
    //!
    //! **Why every command runs with a `cwd` and names files relative to it.** An absolute
    //! path inside a `cmd /c` argument would have to be quoted, and `std` escapes a `"` in
    //! an argument as `\"` — MSVCRT's rule (`make_command_line` in
    //! `library/std/src/sys/args/windows.rs`), which `cmd.exe` does not use. Handing the
    //! folder to the child and letting it say `type data.txt` avoids the whole question.
    //!
    //! Where a *file* has to stand in for a Python, it is a `.bat`: `std` resolves a
    //! `.bat`/`.cmd` program through `cmd.exe` itself and escapes the arguments for it,
    //! including the `%` in the version probe (`make_bat_command_line`, same file), so a
    //! batch file is a faithful stand-in for an interpreter that takes `-c <program>`.

    use super::*;

    /// `cmd.exe`, from the variable Windows always sets, so no PATH search is involved.
    fn cmd_exe() -> PathBuf {
        std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("cmd.exe"))
    }

    /// A plan that runs `command` under `cmd.exe /c`, with `dir` as its working folder.
    fn cmd(command: &str, dir: &Path, timeout: Duration) -> RunPlan {
        RunPlan {
            program: cmd_exe(),
            args: vec![OsString::from("/c"), OsString::from(command)],
            cwd: Some(dir.to_path_buf()),
            env: Vec::new(),
            stdin: String::new(),
            timeout,
            stdout_cap: MAX_STDOUT_BYTES,
            stderr_cap: MAX_STDERR_BYTES,
        }
    }

    /// A plan that runs a program directly, with no shell in between — used wherever a
    /// `cmd.exe` would only add a process between the runner and the thing being killed.
    fn program(program: &str, args: &[&str], timeout: Duration) -> RunPlan {
        RunPlan {
            program: PathBuf::from(program),
            args: args.iter().map(OsString::from).collect(),
            cwd: None,
            env: Vec::new(),
            stdin: String::new(),
            timeout,
            stdout_cap: MAX_STDOUT_BYTES,
            stderr_cap: MAX_STDERR_BYTES,
        }
    }

    /// Something that runs for half a minute and is not a shell, so that killing it is
    /// killing the thing under test. `ping` is in the system directory on every Windows.
    fn sleeper(seconds: u32) -> RunPlan {
        program(
            "ping",
            &["-n", &seconds.to_string(), "127.0.0.1"],
            Duration::from_secs(u64::from(seconds)),
        )
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gedit-runner-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes a batch file. The lines are joined with CRLF because that is what `cmd.exe`
    /// reads batch files as.
    fn batch(path: &Path, lines: &[&str]) {
        std::fs::write(path, format!("{}\r\n", lines.join("\r\n"))).unwrap();
    }

    fn run(plan: &RunPlan) -> RunOutcome {
        execute(plan, &RunState::default()).expect("the plan did not start")
    }

    /// Writes a batch file that prints the script environment and then the context file,
    /// and a plan that runs it.
    ///
    /// A batch file may quote `"%GEDIT_CONTEXT%"` however it likes — `cmd.exe` parses it
    /// from disk — so the context file is read without its folder having to be the
    /// child's working directory. That matters on Windows: a directory that is a live
    /// process's working directory cannot be deleted, and `ContextDir` deletes this one.
    fn reads_the_context(dir: &Path, timeout: Duration) -> RunPlan {
        let script = dir.join("show-context.bat");
        batch(
            &script,
            &[
                "@echo off",
                "echo %PYTHONUTF8%",
                "echo %PYTHONIOENCODING%",
                "echo %PYTHONDONTWRITEBYTECODE%",
                "echo %PYTHONPATH%",
                "echo %GEDIT_CONTEXT%",
                "type \"%GEDIT_CONTEXT%\"",
            ],
        );
        RunPlan {
            program: script,
            ..program("", &[], timeout)
        }
    }

    /// The child's output as lines, with blanks dropped: `cmd.exe` ends every line with
    /// CRLF and `more` is entitled to a blank of its own, and neither is what is under
    /// test here.
    fn lines(text: &str) -> Vec<String> {
        text.lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect()
    }

    /// A command that appends to `alive` about once a second until it is stopped.
    ///
    /// `ping` against the loopback address is the delay, because it wants nothing from
    /// stdin or from a console, which is all a script run is given. Killing the run
    /// mid-sleep ends that `ping.exe` with the rest of the job.
    const MARKER_LOOP: &str = "for /l %i in (1,1,600) do @(echo x>>alive&ping -n 2 127.0.0.1 >nul)";

    /// The marker's size, or `None` while nothing has been written yet.
    fn still_alive(marker: &Path) -> Option<u64> {
        std::fs::metadata(marker).ok().map(|meta| meta.len())
    }

    /// Whether anything is still appending to the marker. The window is longer than one
    /// turn of [`MARKER_LOOP`], so a child that is still running cannot look stopped.
    fn is_still_growing(marker: &Path) -> bool {
        let before = still_alive(marker);
        std::thread::sleep(Duration::from_millis(1500));
        still_alive(marker) != before
    }

    #[test]
    fn passes_stdin_through_and_reports_a_clean_exit() {
        let dir = scratch("stdin");
        // `more` is the filter Windows has always had; with a pipe for its output it
        // copies stdin through instead of paging.
        let mut plan = cmd("more", &dir, Duration::from_secs(20));
        plan.stdin = "N10 G0 X1.\nN20 G1 Z-5. F100\n".to_string();
        let outcome = run(&plan);
        assert_eq!(outcome.exit_code, Some(0), "{outcome:?}");
        assert!(outcome.success());
        assert!(!outcome.timed_out && !outcome.cancelled && !outcome.stdout_truncated);
        assert_eq!(lines(&outcome.stdout), ["N10 G0 X1.", "N20 G1 Z-5. F100"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_non_zero_exit_keeps_stderr_and_is_not_a_failure_to_start() {
        let dir = scratch("exit-code");
        let outcome = run(&cmd(
            "echo out&echo boom 1>&2&exit 3",
            &dir,
            Duration::from_secs(20),
        ));
        assert_eq!(outcome.exit_code, Some(3), "{outcome:?}");
        assert!(!outcome.success());
        assert_eq!(outcome.stdout.trim(), "out");
        assert_eq!(outcome.stderr.trim(), "boom");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_program_that_cannot_be_started_is_an_error_not_an_outcome() {
        let plan = program(r"C:\definitely\not\here.exe", &[], Duration::from_secs(5));
        let err = execute(&plan, &RunState::default()).unwrap_err();
        assert!(err.contains(r"C:\definitely\not\here.exe"), "{err}");
    }

    #[test]
    fn the_cwd_is_the_folder_the_plan_names() {
        let dir = scratch("cwd");
        std::fs::write(dir.join("data.txt"), "from the script's folder").unwrap();
        let outcome = run(&cmd("type data.txt", &dir, Duration::from_secs(20)));
        assert_eq!(outcome.stdout.trim(), "from the script's folder");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_environment_reaches_the_child() {
        let dir = scratch("env");
        let context = ContextDir::create(&serde_json::json!({ "contract": 2 })).unwrap();
        let mut plan = reads_the_context(&dir, Duration::from_secs(20));
        plan.env = script_env(Some(Path::new(r"C:\res\scripts")), &context.context_file());
        let outcome = run(&plan);
        let context_file = context.context_file().display().to_string();
        assert_eq!(
            lines(&outcome.stdout),
            [
                "1",
                "utf-8",
                "1",
                r"C:\res\scripts",
                context_file.as_str(),
                r#"{"contract":2}"#,
            ],
            "{outcome:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The Windows half of F19: the run's own child is killed when the deadline passes.
    /// This watches `cmd.exe`'s own appends; the grandchildren have their own tests
    /// (`a_timeout_kills_the_grandchild_too` and its siblings).
    #[test]
    fn a_timeout_kills_the_child() {
        let dir = scratch("timeout");
        let marker = dir.join("alive");
        // Long enough that `cmd.exe` has certainly started and appended once, short
        // enough that the deadline is what ends the run.
        let started = Instant::now();
        let outcome = run(&cmd(MARKER_LOOP, &dir, Duration::from_millis(2500)));
        let elapsed = started.elapsed();
        assert!(outcome.timed_out, "{outcome:?}");
        assert!(!outcome.cancelled);
        assert!(
            elapsed < Duration::from_secs(5),
            "the kill took {elapsed:?}"
        );
        assert!(still_alive(&marker).is_some(), "the loop never started");
        assert!(!is_still_growing(&marker), "the child outlived the run");
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
        let outcome = execute(&sleeper(30), &state).unwrap();
        assert!(outcome.cancelled, "{outcome:?}");
        assert!(!outcome.timed_out);
        assert!(started.elapsed() < Duration::from_secs(5));
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
        let outcome = execute(&sleeper(30), &state).unwrap();
        registry.finish("r1", &state);
        assert!(outcome.cancelled, "{outcome:?}");
        assert!(registry.is_empty());
    }

    /// `cmd.exe` starts a second `cmd.exe` that appends to `alive` about once a second
    /// for `seconds` seconds: a grandchild of the run, in a batch file so that no
    /// quoting is needed.
    fn grandchild_loop(dir: &Path, seconds: u32) {
        batch(
            &dir.join("inner.bat"),
            &[
                "@echo off",
                &format!(
                    "for /l %%i in (1,1,{seconds}) do @(echo x>>alive&ping -n 2 127.0.0.1 >nul)"
                ),
            ],
        );
    }

    /// The run's child waits for that grandchild, so only the run's end can stop either.
    const RUNS_THE_GRANDCHILD: &str = "cmd /c inner.bat";

    /// The point of the job object: a timeout ends the program the script started, not
    /// only the script. Without the job the grandchild kept appending for its 30 seconds.
    #[test]
    fn a_timeout_kills_the_grandchild_too() {
        let dir = scratch("job-timeout");
        grandchild_loop(&dir, 30);
        let marker = dir.join("alive");
        let started = Instant::now();
        let outcome = run(&cmd(RUNS_THE_GRANDCHILD, &dir, Duration::from_millis(3000)));
        assert!(outcome.timed_out, "{outcome:?}");
        assert!(started.elapsed() < Duration::from_secs(8));
        assert!(
            still_alive(&marker).is_some(),
            "the grandchild never started"
        );
        assert!(
            !is_still_growing(&marker),
            "the grandchild outlived the timeout"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancel_kills_the_grandchild_too() {
        let dir = scratch("job-cancel");
        grandchild_loop(&dir, 30);
        let marker = dir.join("alive");
        let state = Arc::new(RunState::default());
        let asked = Arc::clone(&state);
        let watched = marker.clone();
        std::thread::spawn(move || {
            let up = Instant::now() + Duration::from_secs(10);
            while still_alive(&watched).is_none() && Instant::now() < up {
                std::thread::sleep(Duration::from_millis(20));
            }
            asked.cancel();
        });
        let outcome = execute(
            &cmd(RUNS_THE_GRANDCHILD, &dir, Duration::from_secs(60)),
            &state,
        )
        .unwrap();
        assert!(outcome.cancelled, "{outcome:?}");
        assert!(
            still_alive(&marker).is_some(),
            "the grandchild never started"
        );
        assert!(
            !is_still_growing(&marker),
            "the grandchild outlived the cancel"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Quitting ends the program a script started, not only the script.
    #[test]
    fn kill_all_kills_the_grandchild_too() {
        let dir = scratch("job-kill-all");
        grandchild_loop(&dir, 30);
        let marker = dir.join("alive");
        let registry = Arc::new(RunRegistry::default());
        let plan = cmd(RUNS_THE_GRANDCHILD, &dir, Duration::from_secs(60));
        let runner = {
            let registry = Arc::clone(&registry);
            std::thread::spawn(move || {
                let (state, _registered) = Registered::start(&registry, "r1");
                execute(&plan, &state).unwrap()
            })
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        while still_alive(&marker).is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(still_alive(&marker).is_some(), "the script never started");
        assert_eq!(registry.cancel_all(), 1);
        assert!(
            wait_until_idle(&registry, TEST_WAIT),
            "a run was still registered after {TEST_WAIT:?}"
        );
        assert!(runner.join().unwrap().cancelled);
        assert!(
            !is_still_growing(&marker),
            "the grandchild outlived kill_all"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A run that ends by itself leaves what it started running, as on Unix: closing the
    /// job must not kill it. (The loop ends by itself after a few seconds.)
    #[test]
    fn a_run_that_ends_by_itself_leaves_what_it_started() {
        let dir = scratch("job-release");
        grandchild_loop(&dir, 6);
        let marker = dir.join("alive");
        // `start /b` returns at once, so the run is over while the loop goes on.
        let outcome = run(&cmd(
            "start /b cmd /c inner.bat",
            &dir,
            Duration::from_secs(20),
        ));
        assert_eq!(outcome.exit_code, Some(0), "{outcome:?}");
        assert!(!outcome.timed_out && !outcome.cancelled);
        let up = Instant::now() + Duration::from_secs(10);
        while still_alive(&marker).is_none() && Instant::now() < up {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(still_alive(&marker).is_some(), "the program never started");
        assert!(
            is_still_growing(&marker),
            "closing the job killed what the script left running"
        );
        // Not removed: the loop still has the folder as its working directory.
    }

    /// Past the cap the reader keeps draining, or the child would block on a full pipe
    /// and the run would hang instead of being truncated. 5000 lines of 16 characters
    /// plus CRLF is 90 000 bytes, comfortably more than the 64 KiB `std` gives an
    /// anonymous pipe (`PIPE_BUFFER_CAPACITY` in `library/std/src/sys/pal/windows/
    /// pipe.rs`), so a reader that stopped at the 100-byte cap really would wedge it.
    ///
    /// The loop is parenthesised so that `echo done` runs **once**, after it. `cmd.exe`
    /// gives the `DO` clause the rest of the line, `&` included — the two-command body
    /// of [`MARKER_LOOP`] depends on exactly that — so an unparenthesised
    /// `do @echo x&echo done 1>&2` would write "done" once per iteration and the
    /// assertion below would be reading five thousand of them. The Unix sibling of this
    /// test gets the same shape for free: `;` there does not bind into the `while` body.
    #[test]
    fn the_stdout_cap_truncates_and_still_lets_the_child_finish() {
        let dir = scratch("stdout-cap");
        let mut plan = cmd(
            "(for /l %i in (1,1,5000) do @echo 0123456789abcdef)&echo done 1>&2",
            &dir,
            Duration::from_secs(60),
        );
        plan.stdout_cap = 100;
        let outcome = run(&plan);
        assert_eq!(outcome.exit_code, Some(0), "{outcome:?}");
        assert!(outcome.stdout_truncated);
        assert_eq!(outcome.stdout.len(), 100);
        // One "done", not one per iteration — and the byte count in the message rather
        // than the value, because the failure this guards against is five thousand of
        // them and an `assert_eq!` would print every one.
        assert_eq!(
            lines(&outcome.stderr),
            ["done"],
            "{} bytes of stderr",
            outcome.stderr.len()
        );
        // Below the cap nothing is dropped and nothing is claimed.
        plan.stdout_cap = MAX_STDOUT_BYTES;
        let outcome = run(&plan);
        assert!(!outcome.stdout_truncated);
        assert_eq!(outcome.stdout.len(), 5000 * "0123456789abcdef\r\n".len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stderr_has_its_own_cap() {
        let dir = scratch("stderr-cap");
        let mut plan = cmd(
            "echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx 1>&2",
            &dir,
            Duration::from_secs(20),
        );
        plan.stderr_cap = 10;
        let outcome = run(&plan);
        assert_eq!(outcome.stderr.len(), 10, "{outcome:?}");
        // A truncated stderr is not what `stdoutTruncated` means, and has its own flag.
        assert!(!outcome.stdout_truncated);
        assert!(outcome.stderr_truncated);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The context folder is the run's, and it goes away with it whether the run
    /// succeeded, failed or timed out.
    #[test]
    fn the_context_folder_is_removed_after_every_kind_of_run() {
        let elsewhere = scratch("context");
        for which in ["read", "fail", "hang"] {
            let dir;
            {
                let context = ContextDir::create(&serde_json::json!({ "contract": 2 })).unwrap();
                dir = context.dir().to_path_buf();
                let mut plan = match which {
                    "read" => reads_the_context(&elsewhere, Duration::from_secs(20)),
                    "fail" => cmd("exit 1", &elsewhere, Duration::from_secs(20)),
                    _ => {
                        let mut hang = sleeper(30);
                        hang.timeout = Duration::from_millis(300);
                        hang
                    }
                };
                plan.env = script_env(None, &context.context_file());
                let _ = run(&plan);
                assert!(dir.is_dir(), "{which}");
            }
            assert!(!dir.exists(), "{which} left {} behind", dir.display());
        }
        let _ = std::fs::remove_dir_all(&elsewhere);
    }

    /// Quitting must not leave a `while True:` script running (plan AD-13, F19).
    #[test]
    fn kill_all_leaves_no_live_process() {
        let dir = scratch("kill-all");
        let marker = dir.join("alive");
        let registry = Arc::new(RunRegistry::default());
        let plan = cmd(MARKER_LOOP, &dir, Duration::from_secs(60));

        let runner = {
            let registry = Arc::clone(&registry);
            std::thread::spawn(move || {
                let (state, _registered) = Registered::start(&registry, "r1");
                execute(&plan, &state).unwrap()
            })
        };
        // Wait for the loop to be up, so the kill has something to prove.
        let deadline = Instant::now() + Duration::from_secs(10);
        while still_alive(&marker).is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(still_alive(&marker).is_some(), "the script never started");

        assert_eq!(registry.cancel_all(), 1);
        assert!(
            wait_until_idle(&registry, TEST_WAIT),
            "a run was still registered after {TEST_WAIT:?}"
        );
        let outcome = runner.join().unwrap();
        assert!(outcome.cancelled, "{outcome:?}");
        assert!(!is_still_growing(&marker), "the script outlived kill_all");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -- the whole chain ---------------------------------------------------

    /// Discovery, the id, the header's timeout, the context file, the environment, the
    /// cwd and stdin, in one run. A batch file stands in for the interpreter — it is
    /// handed the script's path exactly as a Python would be — so this also holds on a
    /// machine without a Python.
    #[test]
    fn a_script_runs_from_its_id_with_its_header_its_context_and_its_stdin() {
        let dir = scratch("end-to-end");
        let bundled = dir.join("bundled");
        std::fs::create_dir_all(&bundled).unwrap();
        std::fs::write(dir.join("data.txt"), "in the script's folder\r\n").unwrap();
        let script = dir.join("echo.py");
        std::fs::write(
            &script,
            "# /// gedit\n\
             # name = \"Echo\"\n\
             # output = \"replace\"\n\
             # timeout = 7\n\
             # ///\n\
             print(\"the fake interpreter below answers instead\")\n",
        )
        .unwrap();
        // Quoting `%GEDIT_CONTEXT%` is safe here: the batch file is parsed by `cmd.exe`
        // from disk, not assembled by `std` out of arguments. `set /p` reads the one line
        // of stdin without a second process, and `%stdin%` on the next line is expanded
        // after it has run.
        let interpreter = dir.join("fake-python.bat");
        batch(
            &interpreter,
            &[
                "@echo off",
                "echo script=%~nx1",
                "type data.txt",
                "echo path=%PYTHONPATH%",
                "type \"%GEDIT_CONTEXT%\"",
                "echo.",
                "set /p stdin=",
                "echo %stdin%",
            ],
        );

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

        // 3. The run gets its script, its context, its folder and its stdin.
        let context = ContextDir::create(&serde_json::json!({ "contract": 2 })).unwrap();
        let plan = plan_run(
            &resolved,
            &interpreter,
            Some(&bundled),
            &context,
            None,
            "N10 G0 X1.\n".to_string(),
            Duration::from_secs(seconds),
        );
        let outcome = run(&plan);
        assert!(outcome.success(), "{outcome:?}");
        let on_the_path = format!("path={}", bundled.display());
        assert_eq!(
            lines(&outcome.stdout),
            [
                "script=echo.py",
                "in the script's folder",
                on_the_path.as_str(),
                r#"{"contract":2}"#,
                "N10 G0 X1.",
            ],
            "{outcome:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -- python_check against a fake interpreter ---------------------------

    #[test]
    fn probes_a_fake_interpreter() {
        let dir = scratch("probe");
        let good = dir.join("python-good.bat");
        batch(&good, &["@echo 3.12.4"]);
        let status = probe(&good);
        assert!(status.ok, "{status:?}");
        assert_eq!(status.version.as_deref(), Some("3.12.4"));
        assert_eq!(status.interpreter.as_deref(), good.to_str());

        let old = dir.join("python-old.bat");
        batch(&old, &["@echo 3.8.10"]);
        let status = probe(&old);
        assert!(!status.ok);
        assert!(status.message.unwrap().contains("too old"));

        let broken = dir.join("python-broken.bat");
        batch(
            &broken,
            &["@echo off", "echo no module named encodings 1>&2", "exit 1"],
        );
        assert!(!probe(&broken).ok);

        assert!(!probe(&dir.join("python-missing.bat")).ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The Store's redirector is the one "interpreter" a clean Windows always has, and
    /// what it does is print a line and exit 9009. `python::imp` keeps it from ever being
    /// chosen; this is the other half — when it *is* what got run, because the user
    /// pointed the setting at it or because the fallback name resolved to it, the exit
    /// code has to survive `GetExitCodeProcess` and come out as "Python was not found".
    #[test]
    fn a_real_exit_code_9009_is_read_as_python_was_not_found() {
        let dir = scratch("store-stub");
        let stub = dir.join("python.bat");
        let exit_line = format!("exit {WINDOWS_NOT_FOUND}");
        // *Not* the sentence the redirector prints. If the stub said "Python was not
        // found" itself, deleting `judge`'s 9009 arm would leave the generic
        // "<interpreter> could not be run: <stderr>" arm building a message with the
        // same words in it, and this test would still pass with the branch gone.
        batch(&stub, &["@echo off", "echo stub speaking 1>&2", &exit_line]);
        let outcome = execute(
            &RunPlan::probe(&stub, &["-c", VERSION_PROBE], PROBE_TIMEOUT),
            &RunState::default(),
        )
        .expect("the stub did not start");
        assert_eq!(outcome.exit_code, Some(WINDOWS_NOT_FOUND), "{outcome:?}");

        let status = probe(&stub);
        assert!(!status.ok, "{status:?}");
        assert_eq!(status.version, None);
        // The exact sentence, so only the 9009 arm can have produced it.
        assert_eq!(
            status.message.as_deref(),
            Some(format!("Python was not found ({})", stub.to_string_lossy()).as_str()),
            "{status:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A probe that hangs must not hang the app; the 5 s budget is the whole point.
    #[test]
    fn a_probe_that_never_answers_times_out() {
        let plan = RunPlan::probe(
            Path::new("ping"),
            &["-n", "30", "127.0.0.1"],
            Duration::from_millis(200),
        );
        let started = Instant::now();
        let outcome = execute(&plan, &RunState::default()).unwrap();
        assert!(outcome.timed_out, "{outcome:?}");
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(judge("p", Ok(outcome)).message.unwrap().contains("seconds"));
    }
}

//! The v2 scripting backend (plan AD-13 and §7.6). Owner: **WP4.5**.
//!
//! One concern per module:
//!
//! - [`meta`] — the `# /// gedit` TOML header and what it declares
//! - [`discovery`] — the script roots, the id grammar, and the four path commands
//! - [`runner`] — spawning, the deadline, cancel, the output caps and `python_check`
//! - [`context`] — the `GEDIT_CONTEXT` temp folder and its RAII guard
//! - [`settings`] — the `scripts.*` keys, read from `settings.json` in Rust
//!
//! What this module's rules actually buy (plan §3, AD-13):
//!
//! 1. The webview sends a script **id**, never a path and never an interpreter.
//!    An id is `root:name.py` or `root:group/name.py`; every segment is validated and
//!    the canonicalized file has to stay under the canonicalized root, so `..`, an
//!    absolute path and a symlink out of the root are all refused. **No path traversal:**
//!    a run can only name a file that is already in a script folder.
//! 2. Only `script_new`, `script_copy_to_user` and `script_source_path` ever widen the
//!    fs scope, and only for a file in the user folder or an extra folder. **A bundled
//!    script is never writable**, so the scripts that ship with gEdit are the scripts
//!    that run.
//! 3. The script settings (`scripts.python`, `scripts.folders`, `scripts.timeoutSeconds`,
//!    `scripts.showBundled`) are read in [`settings`], from `settings.json`, so they have
//!    **one source of truth** and a run cannot carry its own (AD-8). See that module for
//!    what this is and is not.
//! 4. Nothing here ever goes through a shell: the interpreter is executed directly, with
//!    the script as an argument, so **a script name can never be read as a command line**.
//! 5. A run has a **bounded deadline**, a cancel and capped output, its own process group
//!    on Unix, and is killed when the app exits — a script cannot outlive the window
//!    (F19).
//!
//! **What none of it buys.** Scripts are ordinary programs with the user's rights and
//! gEdit cannot sandbox them. The rules above bound *which file* runs, *for how long* and
//! *how much it may say*; they say nothing about what is **in** that file. `script_new`
//! hands the webview a writable path in the user folder on purpose, and that path is
//! runnable by id — so anything that can call `invoke` can run code of its own choosing,
//! exactly as anything that can write to the user's disk can. The user guide is what
//! says "only run scripts you trust", and it is doing real work (G8 M4 corrected an
//! overclaim here).
//!
//! The modules are `pub` on purpose: the webview reaches them only through the commands,
//! but the commands are named at their own module path in `lib.rs` (see below).

pub mod context;
pub mod discovery;
pub mod meta;
pub mod runner;
pub mod settings;

pub use runner::{kill_all, RunRegistry};

// The commands themselves are **not** re-exported here: `tauri::generate_handler!` also
// needs the hidden `__cmd__<name>` macro that `#[tauri::command]` puts next to the
// function, and a `pub use` of the function alone does not carry it. `lib.rs` therefore
// names them at their own module path (`scripts::discovery::scripts_list`, ...).

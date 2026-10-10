//! A Windows job object per script run: what a script started dies with the run.
//!
//! Unix does this with a process group and `killpg` (see [`super::runner`]). Windows has
//! no such group, so without this a script that started something — a second Python, a
//! helper `.exe`, a `ping` — left it running after a timeout, a Cancel or a quit.
//!
//! **How it works.** Right after the spawn the runner makes a job object, puts the child
//! in it and keeps the handle in the run's state. Every process the child starts from
//! then on is in the job too. [`Job::terminate`] ends the whole tree at once. The job is
//! created with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so when gEdit itself goes away —
//! quit, crash, being killed — Windows closes the handle and ends the tree with it.
//!
//! **A run that ends by itself does not take its leftovers with it.** On Unix a script
//! may start a program that outlives it (open a viewer, start a long job), and only a
//! cancel or a timeout kills the group. [`Job::release`] gives the Windows run the same
//! rule: it clears the kill-on-close flag before the handle is closed.
//!
//! **What it cannot do.** The child is put in the job after it was started, not before:
//! a process the script started in the first few milliseconds, before the assignment,
//! is not in the job. A Python that has not even finished starting cannot have started
//! one, and the alternative (a suspended start) is not something `std::process` offers.
//! If the job cannot be made or the child cannot be put in it (it is already in a job
//! that forbids it), the run goes on without — as before this module — and only the
//! script's own process is killed.

use std::mem;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// The exit code the processes of a terminated job get. Nothing reads it.
const TERMINATED: u32 = 1;

/// An open job object. Closing it (drop) ends every process still in it, unless
/// [`Job::release`] was called first.
#[derive(Debug)]
pub struct Job(HANDLE);

// SAFETY: a job handle is a kernel object handle; it may be used and closed from any
// thread. The raw pointer type is all that stops the compiler from knowing that.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    /// Makes a job that kills its processes when it is closed, and puts `child` in it.
    /// `None` when either step fails; the run then goes on without a job.
    pub fn around(child: &Child) -> Option<Self> {
        // SAFETY: plain Win32 calls with valid arguments; the handle is owned by the
        // returned `Job` from here on and closed exactly once in `Drop`.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let job = Self(handle);
            job.set_kill_on_close(true)?;
            if AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) == 0 {
                return None;
            }
            Some(job)
        }
    }

    /// Ends every process in the job, the script and whatever it started. Safe to call
    /// more than once.
    pub fn terminate(&self) {
        // SAFETY: the handle is open for as long as `self` exists.
        unsafe {
            TerminateJobObject(self.0, TERMINATED);
        }
    }

    /// The run is over and nothing is to be killed: whatever the script left running
    /// stays, as it does on Unix. Closes the handle.
    pub fn release(self) {
        let _ = self.set_kill_on_close(false);
        // `Drop` closes the handle; with the flag cleared that kills nothing.
    }

    fn set_kill_on_close(&self, on: bool) -> Option<()> {
        // SAFETY: an all-zero `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` is valid (integers
        // and pointers only), and the size passed is that of the struct passed.
        unsafe {
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
            if on {
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            }
            let done = SetInformationJobObject(
                self.0,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(info).cast(),
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            (done != 0).then_some(())
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: the handle is open and closed only here.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

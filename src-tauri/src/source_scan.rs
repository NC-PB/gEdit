//! What the tests that read their own source read it through.
//!
//! A handful of tests pin a rule about the code itself rather than about its output
//! — that a command asks the fs scope before it touches a path, that a pair of files
//! is written in the order that survives a kill, that the exit path never mentions
//! recovery — by reading the module's own text with `include_str!` and searching it.
//!
//! `include_str!` embeds the file exactly as the working tree spells it, and the
//! working tree's line endings are Git's decision, not the code's: with `text=auto`
//! and `core.autocrlf` on (the default of Git for Windows) the checkout has CRLF, a
//! needle spelled `"\n}\n"` matches nothing, and the scan fails on the checkout's
//! settings instead of on the code — the one way a scan like that must never fail.
//!
//! `.gitattributes` pins `*.rs` to `eol=lf`, so a checkout should not get there in
//! the first place. Reading every scanned file through [`lf`] means it does not
//! matter if one does: the two halves are independent, and either one alone keeps
//! the scans honest.

/// A source file with its line endings folded to `\n`, whatever the checkout wrote.
pub fn lf(source: &str) -> String {
    source.replace("\r\n", "\n")
}

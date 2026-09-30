# Changelog

What changed in each release of gEdit, written for the person who edits NC programs. The
release workflow publishes the entry of a version as the notes of its draft release, so
the top of each entry has to make sense on its own.

## v0.2.0 (2026-10-01)

The first release with installers for macOS, Windows and Linux, and the first with release
notes (v0.1.0 was a Windows-only build without notes). The lists below describe gEdit as
it is now, not only what is new. It is an editor for the output of a CAM post-processor: open
the program, find your way around it, clean it up, renumber it, scale the feeds, list the
tools, compare it with the last version, and save it without changing a byte you did not
ask to change. It works offline, and Python is needed only for the script features.

**These installers are not signed.** Your system will warn you the first time; see
"Installing an unsigned build" below for the one step each system needs. Checksums are in
the `SHA256SUMS` file attached to the release.

### What you can do

**Open and save programs safely**

- Open several files at once, in tabs, by dialog or by drag and drop. A file that is already
  open is brought forward instead of being opened twice.
- Encoding (UTF-8, UTF-8 with BOM, UTF-16, Windows-1252), line endings and the punched-tape
  NUL leader and trailer are detected and written back unchanged. A program you open and
  save without editing is byte for byte the file you started with.
- Unsaved changes are marked and asked about before they are lost, including when you quit
  from the Dock on a Mac. A file changed on disk by the CAM system is noticed while you
  work.
- Before a save overwrites a file, the version on disk is copied aside, by default into a
  history of five versions in gEdit's own data folder. If that copy cannot be made you are
  asked; gEdit does not save silently without it.
- Unsaved work is snapshotted every half minute and whenever the window loses focus, so
  after a crash or a power cut it is offered back the next time you start. Restoring only
  reopens the text; nothing on disk is written until you save. A file that changed on disk
  since the snapshot is flagged so you can compare first.
- Your tabs come back the next time you start, each file with its cursor, its bookmarks
  and a dialect or machine you chose by hand.
- A file you may not write opens locked, and Save goes to Save As. You can also lock a tab
  yourself to keep your keystrokes out of a proven program.

**Five dialects**

- Fanuc (ISO) mill, Fanuc (ISO) lathe, Heidenhain Klartext, Okuma OSP lathe and Sinumerik
  840D turning. The dialect is detected from the extension and the content and can be
  changed in the status bar.
- Fanuc lathe: turret tool changes, the lathe meanings of the cycle and threading codes,
  `U`/`W` incremental and `X` as a diameter, G-code systems A and B.
- Okuma OSP: sequence names, four- and six-digit turret tool words, `CALL`/`RTS`, and the
  machine's unit system.
- Sinumerik 840D turning: `;` comments and strings, labels, cycle calls, tools by number or
  by name, and diameter programming on from the start.

**Machine configurations**

- Tell gEdit once how your control reads a number: whether `X50` is millimetres or the
  smallest input increment (on an Okuma, which unit system every number is counted in),
  which G-code system a lathe uses, whether `X` is a diameter, and what is already in
  effect when a program starts. Pick one machine per file.
- Without a machine, gEdit says which defaults it is assuming, and where the possible
  readings disagree it refuses to convert rather than guess.

**Reading a program**

- Syntax highlighting, a program map of tool calls, sections, comments, labels, stops and
  subprogram calls, go to line or block number (`Ctrl+G`), next and previous tool change
  (`F7`), bookmarks, folding and a sticky section heading.
- Hover help and completion from a code database written for the subset of code CAM
  systems emit.

**NC transformations**

- Renumber blocks, remove block numbers, insert or remove the spaces between words, remove
  empty lines, remove comments (keeping the program name and, if you ask, your header),
  convert case. Each runs on the selection or the whole program, is one undo step, and
  lists in a Results panel every line it refused to touch and why.
- Renumbering rewrites the jumps, subprogram calls and cycle references whose target block
  it can prove, and asks before it leaves one behind. Removing block numbers keeps the
  numbers something points at.

**Compare**

- Compare the document with the version on disk, another tab, or any file, side by side or
  inline.

**Python scripts**

- Run a script over the program or the selection. Its result can replace the input as one
  undo step, open in a new tab, or come back as a clickable table of findings. Parameters
  declared in the script become a form. Runs have a time limit and a Stop button.
- Three scripts ship with the app: scale feed rates, scale spindle speeds, and tool list.
  They work on all five dialects and use the same contract as a script you write yourself.

**Everything else**

- Ready-made code blocks (program header, drilling cycle) for Fanuc mill and Klartext; light,
  dark or system theme; a settings dialog; recent files; a command palette (`F1`) and a
  shortcut list.

### Things to know about the new behaviour

- **Detection that cannot wreck a program.** A header that only one control writes
  (`BEGIN PGM` on a numbered block, a `%_N_` or `;$PATH=` line, a `$NAME.MIN%` line) settles
  the dialect on its own, and an Okuma extension no longer outvotes clear Fanuc content.
  When a program's content contradicts its dialect, the NC transformations that could
  damage it and the scripts that replace the text refuse to run, and say why.
- **Tap speeds are left alone.** Scale Spindle Speed does not change the `S` of a tapping
  block (or of a tapping cycle), nor the `S` in force when a tapping block has none of its
  own. It reports them instead. Thread feeds are still scaled, with a warning.
- **Named Fanuc programs.** A program name in angle brackets, `<NAME>`, is one token: its
  line is never numbered, no digit inside it is scaled, a `T` in it is no tool change, and
  `M98`/`G65 <NAME>` calls appear in the program map.
- **The Klartext decimal comma.** A number written with a comma is read everywhere and
  written back with its comma.
- Feeds under a G code the database does not know are reported rather than scaled; the
  arguments of `G65`/`G66` and the data of `G10` are left alone. A five-digit Fanuc lathe
  `T` word is read as a 3-digit tool and a 2-digit offset; on a Sinumerik the main spindle
  is spindle 1.

### Windows

- One spelling per path: a file opened as `c:\x`, `C:/x` or `\\?\C:\x` is one tab. Long
  file names work in the backup history, Windows device names (`CON`, `NUL`, …) are
  refused as file names, and the Python lookup never takes the Microsoft Store
  placeholders that a clean Windows has on its `PATH`.

### Known limits

- **The installers are unsigned** (see below).
- Milling on an Okuma or a Siemens control is not covered yet. Such a program opens with
  the Okuma or Sinumerik turning profile, which reads some of its codes wrongly (a
  preselected tool shows as a tool change, for example). A Sinumerik milling profile is
  planned for the next release.
- The Insert tab has ready-made blocks for Fanuc mill and Klartext only.
- No backplot, simulation or 3D display; no DNC or machine communication; no program
  management.
- Python 3.9 or newer is needed for the script features only. Without it those commands
  are disabled with a message; everything else works.
- Scripts are ordinary programs running with your rights, and gEdit cannot sandbox them.
  Run only scripts you have read and trust.
- On Windows and Linux, logging out or shutting down skips the unsaved-changes prompt;
  the half-minute snapshot is what catches that work.
- Every text in the program is English.

The [user guide](https://github.com/NC-PB/gEdit/blob/v0.2.0/docs/user/README.md#what-gedit-does-not-do) lists the limits in full.

### Installing an unsigned build

These builds are not signed or notarized, so each system asks you to confirm once that you
want to run them. Check the download against `SHA256SUMS` first if you like
(`shasum -a 256 <file>` on a Mac, `sha256sum <file>` on Linux, `certutil -hashfile <file>
SHA256` on Windows).

- **macOS** (one `.dmg` for Apple Silicon and Intel). Drag gEdit to Applications and try to
  open it; macOS will refuse. Then go to **System Settings > Privacy & Security**, scroll
  down to the message about gEdit and click **Open Anyway**, and confirm. You only have to
  do this the first time. (On macOS 14 and earlier, right-clicking the app and choosing
  **Open** works as well; macOS 15 removed that.) If macOS offers no **Open Anyway**, run
  `xattr -dr com.apple.quarantine /Applications/gEdit.app` in Terminal once, and open the
  app again.
- **Windows** (`.msi` and `-setup.exe`). When SmartScreen says "Windows protected your
  PC", click **More info**, then **Run anyway**. If Smart App Control is on (Windows 11),
  Windows blocks unsigned installers outright and offers no such button; this build cannot
  be installed on such a machine until it is signed.
- **Linux** (`.deb`, `.rpm`, `.AppImage`). Install the `.deb` or `.rpm` with your package
  manager. For the AppImage, make it executable (`chmod +x gEdit_*.AppImage`) and run it.
  If the AppImage does not start, install FUSE 2 (`sudo apt install libfuse2`, or
  `libfuse2t64` on Ubuntu 24.04), or use the `.deb` or `.rpm`.

## v0.1.0 (2026-07-06)

A Windows-only build (`.msi` and `-setup.exe`), published without release notes. v0.2.0
replaces it.

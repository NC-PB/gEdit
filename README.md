# gEdit

A desktop editor for NC code. It is the tool you open after the post-processor has run:
read the program, find your way around it, clean it up, renumber it, scale the feeds, list
the tools, compare it with the last version, and save it without changing a byte you did
not ask to change.

Built with Tauri, SvelteKit and Monaco. It works offline — the editor is bundled with the
app and nothing is loaded from the network.

Two dialects:

- **Fanuc (ISO) mill** — `.nc`, `.tap`, `.cnc`, `.eia`, `.iso`, `.min`, `.ncc`, `.ptp`, `.txt`
- **Heidenhain Klartext** — `.h`

## Features

**Files that survive the round trip.** Several files open at once, in tabs, by dialog or by
drag and drop. Encoding (UTF-8, UTF-8 with BOM, UTF-16, Windows-1252), line endings and the
punched-tape NUL leader and trailer are detected and written back unchanged. A program you
open and save without editing is byte for byte the file you started with. Unsaved changes
are marked and are asked about before they are lost, and a file changed on disk by the CAM
system is noticed while you work.

**Dialect profiles.** What a control considers a comment, a block number, a tool change or
a program start is data, not code. The dialect is detected from the extension *and* the
content, and can be changed in the status bar.

**Reading a program.** Syntax highlighting; a program map of tool calls, sections,
comments, labels, stops and subprogram calls; go to line or block number (`Ctrl+G`); next
and previous tool change (`F7`); bookmarks; folding and a sticky section heading; hover
help and completion from a code database written for the subset of code CAM systems emit.

**NC transformations.** Renumber blocks and remove block numbers, insert or remove the
spaces between words, remove empty lines, remove comments (keeping the program name and
your header), convert case. Each one runs on the selection or the whole program, is one
undo step, and lists in a Results panel every line it refused to touch and why. They warn
before they break a jump that points at a block number.

**Comparison.** Compare the document with the version on disk, another tab, or any file,
side by side or inline.

**Python scripts.** Run a script over the program or the selection: it gets the text on
stdin and the document's metadata, the resolved dialect and the code database in a JSON
context. Its result can replace the input as one undo step, open in a new tab, or come back
as a clickable table of findings. Parameters declared in the script become a form. Runs
have a time limit and a Cancel button. Three scripts ship with the app — scale feed rates,
scale spindle speeds, tool list — and they use the same contract as one you write yourself.

**The rest.** Ready-made code blocks per dialect (program header, drilling cycle) from the
Insert tab; light, dark or system theme; a settings dialog; recent files; a command palette
(`F1`) and a shortcut list that are generated from the commands themselves.

### Only run scripts you trust

A script is an ordinary program running with your rights. It can read and write your files
and reach the network, and **gEdit cannot sandbox it**. What gEdit does guarantee is that
nothing runs by itself, that only scripts in the folders you listed can be started, that
bundled scripts are never writable, and that a run is bounded by a timeout, a Cancel button
and capped output — it does not and cannot guarantee anything about what is *inside* a
script. Read a script before you run it, the same way you would read a macro somebody
mailed you. The full picture is in
[docs/user/scripts.md](docs/user/scripts.md#security).

### What gEdit does not do

No backplot, simulation or 3D display. No DNC or machine communication. No program
management. One mill dialect and one Klartext dialect — a lathe profile is planned. Python
is needed **only** for the script features; everything else works without it. The
[user guide](docs/user/README.md) lists the limits in full.

## Documentation

- **[User guide](docs/user/README.md)** — what the program does and how to use it, plus
  [dialects](docs/user/dialects.md), [transformations](docs/user/transformations.md),
  [scripts](docs/user/scripts.md) and the [keyboard](docs/user/shortcuts.md).
- **[Planning](docs/planning/README.md)** — scope, roadmap and feature notes.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, conventions, checks and the runtime harness.

## Requirements

- To build: [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/tools/install), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.
- To use the script features: Python 3.9 or newer. On Windows, `python` must be on `PATH`. On macOS and Linux, gEdit looks up `python3` through your login shell (so a Homebrew or python.org install is found even when the app is started from Finder), then in common install locations. The interpreter can also be set in the settings dialog, or with the `GEDIT_PYTHON` environment variable.

## Development

```bash
npm ci
npm run tauri dev
```

Type check and unit tests: `npm run check` and `npm test`. Setup, conventions, the full list
of checks and the macOS runtime harness are described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Build

```bash
npm run tauri build
```

Installers are written to `src-tauri/target/release/bundle/`.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a
pull request.

## License

MIT. Third-party license notices are generated into `src/lib/data/licenses.json`
(`npm run licenses`) and shown in the About dialog.

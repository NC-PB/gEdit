# Release checklist

What the owner does with the bundles of a draft release before publishing it. The release
workflow (`.github/workflows/release.yml`) builds them on a version tag and attaches them
to a **draft** GitHub release; nothing is public until the draft is published by hand.

Copy this page into a note for the release and tick it off. It is short on purpose: the
automated checks have already run on the tagged commit, so this is about what only a
person on a real machine can see.

## Before the tag

- [ ] The release's milestone is on `main` and CI is green.
- [ ] `CHANGELOG.md` has the `## vX.Y.Z (date)` entry, and what it says is what the build does.
- [ ] The tag ruleset on `refs/tags/v*` (only the owner may create, update or delete) and the
      branch protection on `main` are still in place (see CONTRIBUTING.md, Releases).
- [ ] `npm run versions:check` agrees with the tag you are about to push (`vX.Y.Z`).
- [ ] Optional: Actions > Release > Run workflow on `main` (a dry run) builds the bundles
      as workflow artifacts without touching any release.

## Tag and draft

- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z`.
- [ ] The Release run is green. A draft release for the tag exists, with the notes from the
      CHANGELOG entry, the bundles and `SHA256SUMS`.

## On each platform

Use the sample programs in `tests/fixtures/exit/` (open them by the application, not in
another editor first: they contain a BOM, CRLF, NUL bytes and Windows-1252 bytes on
purpose).

| | macOS (`.dmg`) | Windows (`.msi` or `-setup.exe`) | Linux (`.deb`/`.rpm` or `.AppImage`) |
|---|---|---|---|
| Download matches `SHA256SUMS` | [ ] | [ ] | [ ] |
| Installs, and starts after the unsigned-build step in the notes | [ ] | [ ] | [ ] |
| macOS: the `.dmg` was downloaded from the draft **through a browser** (so it is quarantined, as a user's would be) and, after the Open Anyway step in the notes, the app opens | [ ] | | |
| Windows: on a machine with Smart App Control on, the installer is blocked with no way past; the notes say so | | [ ] | |
| Linux: the `.AppImage` starts on a current Ubuntu (FUSE 2 present or installed as the notes say) | | | [ ] |
| **Open**: a Fanuc program and a Klartext program open in tabs, the dialect in the status bar is right, the program map is filled | [ ] | [ ] | [ ] |
| **Edit**: type a change, undo it, type it again; the tab shows it as modified | [ ] | [ ] | [ ] |
| **Save byte-exact**: open a sample and save it with no edit; the file's hash is the same as before (`shasum -a 256`, `sha256sum`, `certutil -hashfile <file> SHA256`) | [ ] | [ ] | [ ] |
| **Close guard**: close the window with a modified tab; gEdit asks, Cancel keeps it open, Discard closes (on a Mac also Cmd+Q and Dock > Quit) | [ ] | [ ] | [ ] |
| **A script with Python**: Tools > Tool list on a sample shows its table in the Results panel | [ ] | [ ] | [ ] |
| **A script without Python**: on a machine or account where Python 3.9+ is not installed, the script commands are disabled with a message and everything else still works | [ ] | [ ] | [ ] |
| About shows the version of the tag | [ ] | [ ] | [ ] |

The "without Python" row needs a machine that has none (a fresh account, a clean VM).
If you cannot arrange one for a platform, leave the box empty and say so in the notes
rather than ticking it.

## Publish

- [ ] Every box above is ticked, or what is not ticked is written into the notes as a known limit.
- [ ] Edit the draft on GitHub: read the notes once, then **Publish release**. The workflow
      never does this, and never changes a release once it is published: a problem found
      later is fixed in the next version.

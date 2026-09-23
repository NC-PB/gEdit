# Your own programs (never committed)

This folder is where **your real NC programs** go when you want gEdit checked against
them. It is gitignored: everything in it except this README stays on your machine. It is
never committed, never pushed and never seen by CI (plan §9.2, decision D45).

That is the whole point. A real program carries part numbers, customer names, tool
comments and know-how, and a public repository is the wrong place for all of it. The
committed fixtures are synthetic files written for gEdit; these are yours.

## Where to put them

Either here, in a folder per control:

```
tests/real/fanuc-lathe/
tests/real/okuma/
tests/real/sinumerik/
tests/real/heidenhain/
```

or anywhere else on your disk, and point `GEDIT_REAL_FIXTURES` at it:

```sh
GEDIT_REAL_FIXTURES=/Volumes/work/nc npm test -- realFixtures
```

Without either, the tests **skip**. They say "no local folder found" when there is no
folder at all and "no programs" when the folder is there but has no `manifest.json`, so a
skip never looks like a pass.

## `manifest.json`

One entry per program, next to the files (or at the root of `GEDIT_REAL_FIXTURES`):

```json
{
  "$version": 1,
  "programs": [
    {
      "file": "fanuc-lathe/2001.nc",
      "profile": "fanuc-lathe",
      "variant": { "gcodeSystem": "B" },
      "machine": { "numberInput": { "mode": "calculator", "incrementMm": "1" } },
      "tools": ["01", "03", "05"],
      "allowUnknown": ["M138", "M139"]
    }
  ]
}
```

| Member | What it says |
|---|---|
| `file` | path of the program, relative to this folder |
| `profile` | the profile it must be detected as |
| `variant` | the variant gEdit must detect when no machine is named (optional) |
| `machine` | the machine parameters to read it with — an inline partial `MachineParams` (§7.15), or `{ "id": "lathe-2" }` together with a copy of your `machines.json` **next to the manifest**. The tests never read the app's config folder |
| `tools` | the tool stations the outline must find, in order (optional) |
| `allowUnknown` | words gEdit may report as unknown without failing (optional) |

## What the checks do

Detection equals the manifest; no unknown token outside comments except the allow-list;
the outline's tool stations equal the manifest; `tool_list` agrees with the outline; and a
read-write round trip is **byte exact** — same bytes out as in, including the line endings,
the encoding and a NUL leader.

The output is **counts and pass/fail only**. A failure names the manifest index and the
line number, never a file name and never a line of your program. Goldens derived from a
program of yours stay in this folder too; nothing under `tests/` is written from them, and
the tests use no snapshot helper, because a snapshot would write your program's text into
a committed file.

## If you want to publish one

A few programs that are safe to share are worth having in the repository, so that CI and
every contributor test against something real. The path for that is:

1. run `node tests/gen/check-anonymized.mjs <files>` — it lists what looks personal
   (names, customers, part numbers, dates, paths, e-mail addresses, telephone numbers, a
   program header) for your second look. It never rewrites anything;
2. decide, file by file, whether it may be public;
3. only then it is copied, byte for byte, to `tests/fixtures/nc/owner-public/<profileId>/`
   with a line in `tests/fixtures/README.md` that names the control, a generic description
   of what it makes, the hand-over date and your permission.

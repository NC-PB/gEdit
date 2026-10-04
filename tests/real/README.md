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

Two test files run the checks, one per language:

```sh
npm test -- realFixtures                                  # every check below
python3 -m unittest tests.python.test_real_fixtures       # the Python tokenizer's unknownTokens
GEDIT_G11=strict npm test -- realFixtures                 # and fail on every failure
```

By default a run prints its report and fails only when a check crashed: the report is the
result of gate G11, and its counts go into the commit body. With `GEDIT_G11=strict` every
failure, and every known gap that passes now, fails the run too — use it once your manifest
lists every gap with its reason.

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
      "allowUnknown": ["M138", { "text": "SPANBRECHEN.", "why": "a cycle name in the dialog language" }],
      "knownGaps": { "scaleFeed": "the lead of a builder cycle the database does not know is reported" }
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
| `allowUnknown` | words gEdit may report as unknown without failing (optional): a token's text as the tokenizer reads it, case ignored, or `{ "text": …, "why": … }` with the reason. A text written `/…/` is a pattern over the token's text instead (the pattern rules of the profiles) |
| `knownGaps` | checks this program is known to fail, each with its reason (optional): `{ "<check>": "why" }`, the check names of the table below. Such a check counts as **known**, not as a failure; one that passes is reported as "no longer a gap", so the entry gets removed |

`$version` stays 1: every member above except `file` and `profile` is optional, and a
manifest written before M9 reads the same.

An entry that is not an object, or has no `file` or no `profile` written as a string, is
not skipped: it is counted, and fails `noCrash` at its own index, so a typo in one key
cannot move the index of every later program or turn into a quiet pass with fewer programs.

## What the checks do

From M9 (WP9.6) these run for real. Each program goes through every check, under the
machine its entry names (no `machine`: the profile's defaults, and the variant as detected),
and every step is the app's own: the file is opened by the app's decoder, the dialect
detected, the machine merged and the program tokenized and mapped by the same code, and
the bundled scripts are started the way the app starts them:

| Check | Passes when |
|---|---|
| `detection` | the detected profile is the manifest's `profile` **whichever document was open before** (detection is tried with the default profile and with each built-in as the fallback, so a program that only gets its dialect by luck fails), and with no machine named, each variant of `variant` is the detected one |
| `unknownTokens` | no `unknown` token outside comments, except the `allowUnknown` entries; a failure names the line of the first one. The Python half checks the same with the Python tokenizer |
| `map` | the program map's tool stations equal `tools`, in order (skipped without `tools`). A station is compared without `T`, quotes and leading zeros: `T01`, `01` and `1` are one station |
| `toolList` | `tool_list` gives one row per station of the map, in order of first use, with the line of its first call and the number of tool segments the map has for it |
| `roundTrip` | reading and writing the file gives back the same bytes: line endings, encoding, a byte-order mark and a NUL leader included (a file that mixes line endings does not: the editor writes one) |
| `scaleFeed` | scale feed at 100 % gives back every byte of the program |
| `scaleSpeed` | scale speed at 100 % gives back every byte of the program |
| `programChecks` | M10: the program checks (every check on) end with a well-formed report, every row carrying its `checkId`. A finding is **not** a failure; the counts of findings by check go on their own line (below) so that a check that fires on most correct programs shows |
| `extents` | M10: the extents end with a report whose rows are an array |
| `addressArithmetic` | M10: address arithmetic adding 0 to `Z` gives back every byte of the program |
| `noCrash` | nothing above threw or timed out, the file is there, and the machine the entry names exists |

`toolList`, `scaleFeed`, `scaleSpeed` and the three M10 checks need Python 3.9 or newer:
`GEDIT_PYTHON` names the interpreter, else `python3` (`python` on Windows) is used. Without one, they are
counted as skipped, never as passed, and the report says why. A file the app refuses to
open (binary) fails `roundTrip` and skips everything else; a missing file fails `noCrash`.

## What the run reports

**Counts and pass/fail only** (plan §4 standing rule 12). A failure names the manifest
index (from 0) and, where there is one, the line number — never a file name and never a
line of your program. One line per check, then the failures:

```
G11 source: main working tree; 12 programs
G11 detection      11 pass   1 fail   0 known
G11 unknownTokens   9 pass   2 fail   1 known
G11 map            10 pass   0 fail   0 known   2 skipped
G11 toolList       12 pass   0 fail   0 known
G11 roundTrip      12 pass   0 fail   0 known
G11 scaleFeed      12 pass   0 fail   0 known
G11 scaleSpeed     12 pass   0 fail   0 known
G11 programChecks  12 pass   0 fail   0 known
G11 extents        12 pass   0 fail   0 known
G11 addressArithmetic 12 pass   0 fail   0 known
G11 noCrash        12 pass   0 fail
G11 failures: detection #3; unknownTokens #1:40 #7:212
G11 no longer a gap: (none)
G11 programChecks findings: stops 40 in 6; machineReading 12 in 3; spindleOff 2 in 2
```

The last line counts the program checks' rows by check id and the programs they came in. It
is not a pass or a fail: it is how you see a check that fires on most of your correct programs.

(An example of the shape, not a result.) The Python half prints the same lines for
`unknownTokens` and `noCrash`, each starting with `G11 (Python)`; the two must name the
same failures.

The source line says which of the two folders was used (`GEDIT_REAL_FIXTURES` or the main
working tree), never its path; without a folder the line is `G11 skipped: no local folder
found`, and with a folder but no `manifest.json` it is `G11 skipped: no programs in the local
folder (main working tree)` (or `(GEDIT_REAL_FIXTURES)`). The same numbers go into the
commit body of a milestone (gate G11) and into the exit criterion X13.

With `GEDIT_G11_REPORT=<file>` set, the run also writes them as JSON, to that file only
(keep it inside this folder or outside the repository: a path under the repository's
`tests/`, this folder excepted, is refused and the run says so):

```json
{
  "$format": 1,
  "source": "main working tree",
  "programs": 12,
  "checks": {
    "detection": { "pass": 11, "fail": 1, "known": 0, "skipped": 0 },
    "unknownTokens": { "pass": 9, "fail": 2, "known": 1, "skipped": 0 }
  },
  "failures": [
    { "check": "detection", "index": 3 },
    { "check": "unknownTokens", "index": 1, "line": 40 }
  ],
  "noLongerGaps": []
}
```

`source` is `"GEDIT_REAL_FIXTURES"` or `"main working tree"`; every check of the table
above has an entry in `checks`.

The committed programs of `tests/fixtures/nc/owner-public/` go through the same checks in
CI (exit criterion X13: `tests/unit/ownerPublic.test.ts` and
`tests/python/test_owner_public.py`), with their known gaps in
`tests/fixtures/expected/owner-public/known-gaps.json` instead of a manifest: there every
remaining unknown token is listed with its count, first line and reason, both tokenizers
must find exactly those, and the map is compared with the program's outline golden. Goldens derived from a
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

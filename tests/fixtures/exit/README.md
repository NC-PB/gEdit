# `tests/fixtures/exit/`: the Phase 1 exit criteria

The three programs a CNC programmer works through in `m5-exit-criteria` and
`m5-exit-criteria-nopython` (plan §5 M5 H5), and the bytes those two runs must write.

Every file is synthetic: written for gEdit from the syntax notes in
`docs/planning/syntax/`, never copied from a machine, a control manual or a customer
program, and not meant to run on a machine. Each one says so in its first line — after
the NUL leader in `fanuc-utf8-lf-packed-nul.nc`, after the BOM and `BEGIN PGM` in
`klartext-utf8bom-crlf.h`.

`.gitattributes` marks `tests/fixtures/**` as `-text`, so the bytes in the repository are
the bytes the run sees. **Do not open these files in an editor**: a BOM, a CRLF, a NUL
run and a Windows-1252 byte are exactly what an editor is helpful about. They are written
by `tests/fixtures/exit/gen-exit.py`, which is also where a change belongs:

```sh
python3 tests/fixtures/exit/gen-exit.py .        # from the repository root
```

The plan (§12) asks the owner to review these goldens. What follows is what to review.

## The three programs

| File | Bytes | What it carries |
|---|---|---|
| `fanuc-cp1252-crlf.nc` | Windows-1252, CRLF, no BOM | A 3-tool milling program. `%`, `O4001 (BRACKET – Ø10 MÜLLER)` with three non-ASCII characters in the **program-name** comment, a header comment block, three blank lines, a trailing comment on `N110` and on `N215`, and block numbers running from `N100` in steps of 5 — deliberately **not** the profile default, so renumbering has work to do. `T1 M6`, `T2 M6` and `T3 M6` are the three tool changes F7 steps through; `N120` is the block `Ctrl+G` looks up (document line 12, so a block lookup cannot be mistaken for a line jump). |
| `fanuc-utf8-lf-packed-nul.nc` | UTF-8, LF, 32 NUL bytes before the text and 16 after it | The same shape written without spaces (`N60G1Z-2.F250.`), which is what a posted program off a DNC line looks like. Four feeds (`F250.`, `F800.`, `F120.`, `F600.`) and two speeds (`S3000`, `S2400`). No NUL inside the text, so the document opens **unmodified** (D2). |
| `klartext-utf8bom-crlf.h` | UTF-8 with BOM, CRLF | A 3-tool Klartext program: `BEGIN PGM`, `BLK FORM`, `* -` section headings, `;` comments (one with `Ø`), `TOOL CALL` with `S` and with `S`+`F`, a `CYCL DEF 200 ~` block whose continuation lines carry `Q206` (a cycle feed), `M99` calls and `END PGM`. |

## `expected/`: what `m5-exit-criteria` saves

Each file is the input after exactly the operations the scenario performs on it, saved in
its own encoding and line ending, with the BOM and the NUL leader and trailer kept.

- **`fanuc-cp1252-crlf.nc`** — remove empty lines, remove comments (program name kept),
  renumber, all with the form defaults. The provenance comment and the three header
  comments go with the other comments; `O4001 (BRACKET – Ø10 MÜLLER)` stays, which is what
  "keeping the program name" means and what proves the three Windows-1252 bytes survived
  the round trip. `N110 S3000 M3 (ROUGH)` becomes `N30 S3000 M3`. The numbers become
  `N10`…`N270` (start 10, step 10, one space after the number); `%` and the `O` line are
  not numbered.
- **`fanuc-utf8-lf-packed-nul.nc`** — feeds × 90 % ("as written" decimals: `F250.` →
  `F225.`), then speeds × 110 % (whole revolutions: `S3000` → `S3300`). Nothing else
  changes, and the 48 NUL bytes are still where they were.
- **`klartext-utf8bom-crlf.h`** — feeds × 90 %, then speeds × 110 %. `Q206=150` is a cycle
  feed and stays, reported as a finding rather than scaled; the `F` of a `TOOL CALL` is a
  feed and is scaled.

## `expected-nopython/`: what `m5-exit-criteria-nopython` saves

The same run with `GEDIT_PYTHON` pointing at nothing. The scripts are the only thing that
is gone, so:

- `fanuc-cp1252-crlf.nc` is **the same golden** — the three transforms are TypeScript and
  do not need Python.
- the other two files are **byte for byte their inputs**: nothing edited them, and an
  unedited document is never rewritten (D3).

# Runtime harness fixtures

Files the runtime scenarios copy into a run folder with `h.fixture(<path>, { from: 'runtime' })`.
NC programs live in `tests/fixtures/` instead; only harness-specific input belongs here.

Everything here was written for gEdit and is synthetic.

| Path | Purpose |
|---|---|
| `scripts/a_echo.py` | Prints what it read on stdin as JSON (`len`, `upper`, `lines`, `cwd`). |
| `scripts/b_fail.py` | Writes to stderr and exits 1. |
| `scripts/c_sleep.py` | Runs for two seconds; shows that a script does not block the UI. |
| `scripts/pyexe.py` | Prints the interpreter, its version, `GEDIT_RH_VIA`, `GEDIT_PYTHON`, `PATH` and `SHELL`. |
| `scripts/x.txt`, `scripts/notes.txt` | Not `.py`: the script list must skip them. |
| `scripts/dir.py/keep.txt` | Keeps the folder `dir.py`, which the script list must skip. |
| `scripts/sub/x.py` | Trap: reachable only through a path (`sub/x.py`), which the backend rejects. |
| `channels/dpair_CH1.nc`, `channels/dpair_CH2.nc` | A pair of channel programs (M12), named `<stem>_CH<n>.nc`, read with the `c06` machine of `tests/fixtures/channels/resolve/` (`P` is a bit sum): `M901 P3` and `M903 P3` in both, `M902 P3` in channel 1 only (line 13) and `M904 P3` in channel 2 only (line 13) - exactly two findings of the wait-code check, one in each document. |
| `evil.py` | Trap next to the scripts folder, reachable only as `../evil.py`. |

Both traps write a `PWNED` file next to the scripts folder when they run, and the
scenarios check that the file stays absent.

`.gitattributes` marks `tests/runtime/fixtures/**` as `-text`, so the bytes in the
repository are the bytes a run sees.

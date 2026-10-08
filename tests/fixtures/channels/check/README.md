# Wait-code check goldens (WP12.2)

Written for gEdit: every program here is synthetic, written from the syntax notes
(`docs/planning/syntax/syntax-fanuc.md`, `syntax-okuma.md` §11.7a, `syntax-sinumerik.md`
§7.2a) and the presets of plan §8.9. None was copied from a machine, a CAM system, a manual
or a customer program, and none is meant to run on a machine. Each program carries the
`WRITTEN FOR GEDIT` comment.

Read by `src/lib/core/channels/check.test.ts`. The NC lines are kept inside the golden (not
under `nc/`) so that the check's cases do not need detection and outline goldens of their own.

```json
{ "comment": "…", "description": "what the case shows, and why it is correct NC or which defect it has",
  "profile": "fanuc-lathe", "preset": "fanuc-2path",
  "machine": { "stopsAndEndsWait": true },
  "program": { "1": ["%", "…"], "2": ["…"] },
  "jumpLines": { "1": [5] },
  "expect": { "findings": [ { "kind": "missing", "channel": "1", "line": 8, "mark": "M904", "other": "2" } ] } }
```

- `preset` is a channel preset of the built-in `profile` (`machineParams.channels.presets`);
  `machine` (optional) is merged over it.
- `program` is either an object, one document per channel (`multi-file`), or an array, one
  document resolved with `findSections` (`single-file`; marks no section owns go under `''`).
- `jumpLines` (optional) is what WP12.5 computes per channel: jump-target label lines and
  backward-jump lines.
- `expect.findings` lists every finding, in the check's order; each compares `kind`,
  `channel`, `line`, `mark`, and `other` / `otherLine` / `counts` when the finding has them
  (an expectation without them fails if the finding has them); `ruleId` only where given.
  Messages are pinned in the unit tests, not here.
- Line numbers are 1-based.

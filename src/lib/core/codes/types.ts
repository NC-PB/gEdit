// The code database contract (plan §7.4; file format: `docs/planning/code-assistant.md`,
// "Code database format", without `templates` in P1). Written by the M3 prelude (P3);
// binding.
//
// One database per dialect, in `$lib/data/codes/<dialect>.json`. A profile points at its
// database with `profile.codes`, so several profiles can share one (a Fanuc mill and a
// Fanuc lathe profile, later on).
//
// Content rules (WP3.3 writes the data, `code-assistant.md` "Authoring rules"):
//   - Every label and description is written in our own words, short and factual. Text is
//     never copied from a control manual, and no commercial editor is named.
//   - P1 covers the CAM-output subset of `docs/planning/syntax/`. A missing code is shown
//     as unknown, never guessed.
//   - An entry we are not sure about carries `verify: true`; it stays out of hover until
//     it is confirmed.

/**
 * One word that belongs to a code, e.g. `Z` of `G81` or `Q201` of `CYCL DEF 200`.
 * The same shape serves template parameters and script parameters (§7.5), so one form
 * engine renders all three.
 */
export interface CodeParam {
  /** The address letter or the Klartext Q parameter, e.g. `'Z'`, `'Q201'`. */
  address: string;
  label: string;
  required?: boolean;
  min?: number;
  max?: number;
}

/** One G/M code, address keyword or cycle. */
export interface CodeEntry {
  /** Canonical form, without zero padding: `G1`, `M8`, `G54.1`, `CYCL DEF 200`, `L`. */
  code: string;
  /** Other spellings that mean the same, e.g. `['G01']`. */
  aliases?: string[];
  /** Free text, but the known groups drive sorting and the modal state: `motion`, `plane`,
   * `distance`, `feedmode`, `offset`, `compensation`, `cycle`, `spindle`, `coolant`, `program`. */
  group?: string;
  /** Stays active until another code of the same group replaces it. */
  modal?: boolean;
  /** Feed is tied to the thread pitch here, so feed scaling has to skip the block. */
  pitchFeed?: boolean;
  label: string;
  description?: string;
  params?: CodeParam[];
  /** Not confirmed against the syntax notes yet: never shown in hover (WP3.6). */
  verify?: boolean;
}

/** One dialect's database, as stored in JSON. */
export interface CodeDb {
  /** Database id, e.g. `fanuc`; `profile.codes` names it. */
  dialect: string;
  version: number;
  /** Address letter → what it means, e.g. `X`, `F`, `S`. */
  addresses: Record<string, { label: string; description?: string }>;
  codes: CodeEntry[];
}

/**
 * What the database knows about one word of a block.
 *
 * `entry` is the code itself (`G83`), `address` the letter it started with (`X` of
 * `X10.`). `unknown` is set when neither was found, so the assistant can say "unknown"
 * instead of staying silent.
 */
export interface CodeLookup {
  entry: CodeEntry | null;
  address?: { letter: string; label: string; description?: string };
  unknown?: boolean;
}

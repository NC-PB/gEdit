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

import type { NumberClass } from '$lib/core/machines/types';

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
  /**
   * P6, AD-31. How a value of this parameter is read. It wins over every other rule,
   * because a cycle parameter is often the one place a control breaks its own convention.
   *
   * Absent: the value is read by the address's class. `'increment'`: a whole number of
   * least increments whatever the address suggests (the µm depths and pecks of §8.2).
   * `'count'`: a plain integer no reading touches — dwell counts, repeat counts `K`/`L`,
   * block and program numbers.
   *
   * The complete list per code is the table in §8.2 of the plan, which WP6.2 writes from
   * and the G10 review reads first.
   */
  unit?: NumberClass | 'increment' | 'count';
}

/**
 * P6, AD-19. What a code switches on. This is the whole of "what does this code mean to
 * the modal state": the interpreter reads these members and nothing else, so a dialect is
 * described here and never in code.
 */
export interface CodeSets {
  feedUnit?: 'per-minute' | 'per-rev' | 'per-tooth' | 'inverse-time';
  speedUnit?: 'rpm' | 'surface';
  distance?: 'absolute' | 'incremental';
  units?: 'mm' | 'inch';
  plane?: 'XY' | 'ZX' | 'YZ';
  /**
   * The entry starts or cancels a cycle. A `'start'` on a **non-modal** entry (the Fanuc
   * lathe `G70`–`G76`) applies to its own block only.
   */
  cycle?: 'start' | 'cancel';
  /** The `S` word of this block is a spindle-speed clamp, not a speed (Fanuc A `G50`, B `G92`). */
  speedLimit?: boolean;
  /** Switches diameter programming (Sinumerik `DIAMON` on, `DIAMOF` off, `DIAM90` absolute-only). */
  diameter?: 'on' | 'off' | 'absolute-only';
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
  /**
   * The same number means a threading cycle on another kind of machine, or in another
   * G-code system of this dialect, so whether `F` is a feed rate or a thread lead cannot
   * be decided from the code alone.
   *
   * Fanuc `G76` is a fine boring cycle on a mill and a multi-pass threading cycle on a
   * lathe in G-code system A; `G92` sets the coordinate system on a mill and is the
   * single-pass threading cycle on that same lathe. Until a lathe profile ships, a lathe
   * program is opened with the mill profile, and `scale_feed` multiplied thread leads
   * (G8 M4). Anything that scales a feed treats this like [`pitchFeed`] — it refuses —
   * but says that it refused because the meaning is ambiguous, not because it knows the
   * value is a pitch. Refusing a real fine-boring feed costs one manual edit; scaling a
   * thread lead scraps the part.
   *
   * M6 (G8) carries the same flag the other way and across the two G-code systems of the
   * lathe: the lathe's `G74` is a face pecking cycle whose `F` is an ordinary feed and a
   * left-hand tapping cycle on a mill; `G78` is a threading pass in G-code system B and
   * nothing at all in system A; and system B's `G92` is the coordinate set while system
   * A's is the threading pass. Whichever way round a program and a profile are paired,
   * the number is refused and the line is reported.
   */
  pitchFeedAmbiguous?: boolean;
  label: string;
  description?: string;
  params?: CodeParam[];
  /** Not confirmed against the syntax notes yet: never shown in hover (WP3.6). */
  verify?: boolean;
  /** P6. What this code switches on, for the modal interpreter (AD-19). */
  sets?: CodeSets;
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
 * P6, AD-17. The database **file** format; [`CodeDb`] is what loading and resolving give.
 *
 * A file may name a parent dialect with `extends` and list parent codes it does not have
 * in `remove`. The child's entries **replace** the parent's by normalized code — the whole
 * entry, not a field merge, because a reviewer has to be able to read one entry and know
 * what it says. Addresses override by letter, and aliases are re-checked after the merge.
 */
export interface CodeDbFile {
  dialect: string;
  version: 1;
  /** Parent dialect id. */
  extends?: string;
  /** Codes of the parent this database does not have, as written in the parent. */
  remove?: string[];
  addresses?: CodeDb['addresses'];
  codes: unknown[];
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

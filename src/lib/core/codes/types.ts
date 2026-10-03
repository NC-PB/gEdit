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
  /** `'travel-time'` (M9 review F8): Sinumerik `G931`, whose F is the time the move takes. */
  feedUnit?: 'per-minute' | 'per-rev' | 'per-tooth' | 'inverse-time' | 'travel-time';
  /**
   * On an entry for a word written with `=` (Sinumerik `SVC=`), which is a value and never
   * a code (§7.5) and so switches nothing, `'surface'` says what the word's own value is:
   * a cutting speed, which scale_speed treats like the `S` of constant surface speed
   * (2026-09).
   */
  speedUnit?: 'rpm' | 'surface';
  distance?: 'absolute' | 'incremental';
  units?: 'mm' | 'inch';
  plane?: 'XY' | 'ZX' | 'YZ';
  /**
   * The entry starts or cancels a cycle. A `'start'` on a **non-modal** entry (the Fanuc
   * lathe `G70`–`G76`) applies to its own block only.
   *
   * P9 (§7.4, AD-19, the "defined cycle"): three more values describe a control whose
   * cycles are **defined** once and **called** later (Klartext), next to the Fanuc model of
   * `'start'`/`'cancel'`:
   *   - `'define'`: the block stores this cycle as the defined one, replacing any earlier
   *     definition; it does not run it (`CYCL DEF 200`). Only the next `'define'` replaces
   *     it: no call and no tool change ends a definition.
   *   - `'call'`: the block runs the defined cycle once (`CYCL CALL`, `M99`), and ends a
   *     modal call that is in force.
   *   - `'call-modal'`: from this block on, the defined cycle runs after every positioning
   *     block, until a `'call'` or the next `'define'` (`M89`).
   * A cycle that takes effect where it is defined (a datum shift, a working-plane tilt)
   * carries none of the three: it is never called and never replaces the defined cycle.
   * The interpreter reads these values and no dialect name; WP9.5 implements them in
   * `_nc_modal.py`, the TypeScript interpreter follows the same goldens in Phase 3.
   */
  cycle?: 'start' | 'cancel' | 'define' | 'call' | 'call-modal';
  /**
   * The `S` word of this block is a spindle-speed **limit**, not a speed (Fanuc A `G50`,
   * B `G92`; Sinumerik `G26`, and `G25` with `speedLimitBound: 'lower'`). Anything that
   * scales speeds never scales it as a speed; which side it bounds says `speedLimitBound`.
   */
  speedLimit?: boolean;
  /**
   * P9 (TODO "Ahead"; §7.2, §7.16). Which side of the speed range the `speedLimit` of this
   * block bounds. Absent: `'upper'`, the clamp every entry meant before M9, so no reading
   * changes. `'lower'` (Sinumerik `G25`) is a minimum: its value is not a clamp, the modal
   * state's `speedLimit` (the clamp in force) does not take it, and a script that offers
   * to scale clamps leaves it alone. Only valid together with `speedLimit: true`
   * (`core/codes/load.ts` drops it otherwise). Set on Sinumerik `G25`.
   */
  speedLimitBound?: 'upper' | 'lower';
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
  /**
   * 2026-09 (review finding NC1). Set together with [`pitchFeedAmbiguous`]: the reading of
   * the number on the other kind of machine is a **tap**, not a thread (Okuma `G84`, a LAP
   * code on the lathe and the tapping cycle of the machining centres, whose programs open
   * with the Okuma profile; Okuma `G88`; the lathe's `G74`, the left-hand tap of a mill).
   * A tap's speed and feed are tied by the pitch, and the feed of such a block is refused
   * already, so anything that scales speeds leaves the speed of the block, and the speed in
   * force when it runs, as written too (owner decision 1 of 2026-09-27). A code whose other
   * reading is a thread (`G76`, `G92`) keeps its speed scaled with a warning, as a thread
   * does.
   */
  tappingElsewhere?: boolean;
  label: string;
  description?: string;
  params?: CodeParam[];
  /** Not confirmed against the syntax notes yet: never shown in hover (WP3.6). */
  verify?: boolean;
  /** P6. What this code switches on, for the modal interpreter (AD-19). */
  sets?: CodeSets;
  /**
   * P8. The `F` word of a block with this code is a **time**, not a feed: the dwell of
   * Okuma `G04` is `F` seconds, and so is Sinumerik `G4 F`.
   *
   * Everything that reads or changes feeds has to skip such a block. Scaling the dwell of
   * a chip-breaking peck by the feed factor would change how long the tool stands still at
   * the bottom of the hole, and reporting it as a feed would put a time into the feed
   * range of the program report.
   */
  fNotFeed?: boolean;
  /**
   * 2026-09 (owner decision of 2026-09-27). The code taps a thread: a tapping cycle, a
   * rigid-tapping call or a tapping mode (Fanuc `G84`, `M29`, `G63`; Sinumerik `G331`,
   * `CYCLE84`; Klartext cycle 207). The spindle speed and the feed of a tap are tied by
   * the pitch, so the speed of such a block, and the speed in force when it runs, is left
   * as written by anything that scales speeds. Threading (`G32`, `G76`) is not tapping.
   *
   * Independent of [`pitchFeed`]: a rigid-tapping cycle whose lead is one of its own
   * arguments (`CYCLE84`) taps without taking its lead from the feed word.
   */
  tapping?: boolean;
  /**
   * 2026-09. The address words of a block with this code are its arguments or its data,
   * not the program's feed and speed: the arguments of a macro call (`G65 P9810 F3000.`)
   * and the values of a data-setting block (`G10`). Anything that scales feeds or speeds
   * leaves them as written and says so.
   *
   * P9 (roadmap R3, §7.16): **every** word of such a block is data, its axis words
   * included, so `wordsAreData: true` also means `axisWords: 'data'` — read both through
   * `axisWordsOf` (`lookup.ts`) / `axis_words_of` (`gedit_nc`), never one of them alone.
   */
  wordsAreData?: boolean;
  /**
   * P9 (roadmap R3, §7.2, §7.16). What the **axis** words of a block with this code are,
   * where they are not a move to a position in the program's own frame. The block's
   * feed and speed words keep their meaning (that is the difference to `wordsAreData`):
   *   - `'data'`: values, not a position — a coordinate set or a local shift (`G92 X…`,
   *     `G52 X…`, lathe A `G50 X… Z…`, whose `S` is still a clamp), the centre and angle of
   *     a rotation (`G68 X… Y… R…`), a frame origin (`G68.2 X…`, `CYCL DEF 7`).
   *   - `'machine'`: a position, but not in the program's frame — machine coordinates or a
   *     reference point (`G53`, Klartext `M91`/`M92`, Sinumerik `G75`, `SUPA`; `G28`, whose
   *     words are the point on the way to the reference point, as WP9.2 settles it).
   * Absent: an ordinary block, its axis words are positions in the program's frame.
   * Extents (WP10.3) leave both kinds out of the ranges, and list `'machine'` blocks;
   * address arithmetic (WP10.4) leaves `'data'` words alone and refuses and lists a
   * `'machine'` block. Neither keeps a list of codes of its own. Set by WP9.1 and WP9.2.
   */
  axisWords?: 'data' | 'machine';
  /**
   * P9 (roadmap R3, §7.2, §7.16). The code opens or closes a coordinate frame that is not
   * the program's own: a tilted working plane, a rotation, a transformation or a shift
   * (`'open'`: Fanuc `G68`, `G68.2`–`G68.4`, `G51.1`, Klartext `PLANE SPATIAL`, cycle 19,
   * Sinumerik `CYCLE800`, `TRAORI`, `ROT`; `'close'`: `G69`, `G69.1`, `PLANE RESET`,
   * `TRAFOOF`). A consumer that needs the plain frame treats every block from an
   * `'open'` to the next `'close'` as inside a frame. Where the same code both opens and
   * closes, depending on its values (`CYCLE800()` with zero angles, `G52 X0 Y0`), it is
   * `'open'`: the safe reading, which refuses where it could have worked.
   * Set by WP9.1 and WP9.2; read by WP10.3 and WP10.4 instead of a list of codes.
   */
  frame?: 'open' | 'close';
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

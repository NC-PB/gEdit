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
  /**
   * P10 (roadmap R8, accepted 2026-10-01; plan §7.2, §7.16 #106). What this parameter is to a
   * program shift (address arithmetic, WP10.4), stated per parameter so that nothing is
   * guessed from its name:
   *   - `'tool-axis'`: an **absolute** coordinate on the tool axis — the hole's reference
   *     plane, retraction plane, surface or depth (Fanuc mill `R` under `G90`, Klartext
   *     `Q203`, Sinumerik `RTP`, `RFP`, `DP`, `FDEP`). A shift on the tool axis moves it with
   *     the axis words. The tool axis is `Z` while the plane in force is `XY`; in any other
   *     plane, or an unknown one, the call is refused (Fanuc's drilling axis is a parameter
   *     there, a Sinumerik cycle can select its own).
   *   - `'none'`: reviewed, and no absolute position — a distance from another value, a feed,
   *     a dwell, a count, a direction (Klartext `Q200`, `Q201`, Sinumerik `SDIS`, `DPR`).
   *   - `'other'`: an absolute position the role does not cover (a point in the working
   *     plane, a pivot, a point of a rotated frame, a coordinate that adds to the one of
   *     another block). The block is refused and listed whenever the entry has one.
   *   - `'mode'`: a mode argument that can change whether, or on which axis, the other
   *     parameters are positions (Sinumerik `_DMODE`, `_AMODE`, `_GMODE`, `_AXN`). Absent,
   *     empty or `0` keeps the documented reading; any other value refuses the call.
   * Absent: **not reviewed**. A cycle call that writes a parameter without a role, or an
   * argument its entry does not describe, is refused and listed; an axis word is an axis
   * word unless its own parameter says `'other'`. Read through `positionOf` (`lookup.ts`) /
   * `gedit_nc.position_of`; the G10 table lists every role.
   */
  position?: 'tool-axis' | 'none' | 'other' | 'mode';
  /**
   * M10 review (NC-3). The parameter is a **coordinate of this axis** (an axis of the
   * profile's `addresses.axes`), read in the distance mode in force like the axis word
   * itself: the intermediate point `I1=`, `J1=`, `K1=` of the Sinumerik `CIP` arc (`X`, `Y`,
   * `Z`). Address arithmetic moves it with its axis, so the three points of the arc stay one
   * circle. Absent: the parameter is no coordinate of an axis.
   */
  axis?: string;
  /**
   * P11 (§7.6, §7.16 #136). The parameter's value **names a program** by its number, so a
   * search for that program number (`O2000`) finds the call too:
   *   - `'plain'`: the value is the program number (`G65 P2000`, `G66 P2000`);
   *   - `'packed'`: as `'plain'`, and a value of more than four digits may also be read as a
   *     repeat count in front of a four-digit program number (`M98 P52000` = five times
   *     `O2000`; a five- to eight-digit program number is called with `L` instead), so it
   *     names both programs and search finds it under both.
   * Absent: the value names no program. Only search reads it; a replace never follows it.
   */
  programNumber?: 'plain' | 'packed';
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
  /**
   * P10 (owner/orchestrator decision of 2026-10-04; plan §7.2, §7.16 #107). Switches
   * **tool centre point control** on or off: while it is on, the `X`/`Y`/`Z` of a block are
   * the tool tip in the workpiece, whatever the rotary axes do (Fanuc `G43.4`/`G43.5` on,
   * `G49` off; Klartext `M128` and `FUNCTION TCPM` on, `M129` and `FUNCTION RESET TCPM`
   * off; Sinumerik `TRAORI` on, `TRAFOOF` off). It is **no frame** (`CodeEntry.frame`): a
   * block under it can be judged. The modal state's `tcp` follows it (§7.4); another code of
   * the same modal group as the code that switched it on (`G43` after `G43.4`) ends it too.
   */
  tcp?: 'on' | 'off';
  /**
   * P10 (§7.2, §7.4, §7.16 #108). A bare axis letter in this block (an axis word without a
   * value: `TOOL CALL 1 Z S3000`) names the **tool axis**, and with it the working plane:
   * `Z` → `XY`, `Y` → `ZX`, `X` → `YZ`; another letter makes the plane unknown. Set on the
   * Klartext tool call, which is where that control takes its plane from. Only `true`.
   */
  planeFromAxisWord?: boolean;
  /**
   * M10 (WP10.2, the program checks; plan §7.16). The code starts (`'on'`) or stops
   * (`'off'`) the spindle the program's plain speed word drives (`M3`, `M4` / `M5`; Klartext
   * `M13`, `M14`). A spindle addressed by its number (`M2=3`) is the script's reading of the
   * assignment, never a code.
   */
  spindle?: 'on' | 'off';
  /** M10 (WP10.2). The same for a driven tool's own spindle (Okuma `M13`, `M14` / `M12`). */
  toolSpindle?: 'on' | 'off';
  /**
   * M10 (WP10.2). The code moves at rapid (`'rapid'`: `G0`) or at the feed (`'feed'`: the
   * path and thread moves, the Klartext path functions). A block cuts only under `'feed'`.
   */
  motion?: 'rapid' | 'feed';
  /** M10 (WP10.2). Cutter or nose radius compensation on (`G41`, `G42`, `RL`, `RR`) or off (`G40`, `R0`). */
  radiusComp?: 'on' | 'off';
  /** M10 (WP10.2). A tool length offset on (`G43`, `G44`, `G43.4`, `G43.5`) or off (`G49`). */
  lengthComp?: 'on' | 'off';
  /** M10 (WP10.2). Leaving this modal code sets the spindle speed to zero (Sinumerik `G331`, `G332`). */
  exitSpeed?: 'zero';
  /** M10 (WP10.2). From this code on the control reads its ISO dialect (`'iso'`, Sinumerik `G291`) or its own language (`'native'`, `G290`). */
  language?: 'iso' | 'native';
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
   * Sinumerik `CYCLE800`, `TRANSMIT`, `ROT`; `'close'`: `G69`, `G69.1`, `PLANE RESET`,
   * `TRAFOOF`). Where the same code both opens and closes, depending on its values
   * (`CYCLE800()` with zero angles, `G52 X0 Y0`), it is `'open'`: the safe reading, which
   * refuses where it could have worked.
   *
   * P10 (§7.4 rule 13, §7.16 #109): a `'close'` ends the open frames **of its own
   * `group`** (a close without a group, those without one): `G69` ends `G68`, not the
   * scaling of `G51`; `PLANE RESET` ends a `PLANE` and cycle 19, not the mirror of cycle 8;
   * `TRAFOOF` ends `TRANSMIT`, not `CYCLE800`. Opening a code that is already open does not
   * stack. The modal state's `frame` is the frame in force; tool centre point control is
   * `sets.tcp`, never a frame (`TRAORI` lost its `'open'` at P10).
   * Set by WP9.1 and WP9.2; read by WP10.3 and WP10.4 instead of a list of codes.
   */
  frame?: 'open' | 'close';
  /**
   * P10 (§7.4 rule 13, §7.16 #109). Written **without values** — an empty argument list
   * (`CYCLE800()`), or a block with no value word besides its codes (`TRANS`, `ROT`,
   * `SCALE`, `MIRROR` alone) — the code closes the open frames of its own `group`, whatever
   * `frame` says. The Siemens manuals state both: `CYCLE800()` clears the swivel frames, and
   * a frame instruction without an axis clears the programmable frame. Only `'close'`.
   * Anything with a value keeps the safe reading of `frame` (`'open'`).
   */
  frameWithoutValues?: 'close';
  /**
   * Owner decision of 2026-10-08 (M10-2; §7.4 rule 13). The angle words of a tilt that reads as
   * **no tilt when every one of them is zero** (Klartext cycle 19's `A`, `B`, `C`; `PLANE
   * SPATIAL`'s `SPA`, `SPB`, `SPC`). A block of this code that writes none of them changes no
   * frame (`CYCL DEF 19.0` names the cycle, its `19.1` gives the angles); one that writes
   * them opens the frame while any of them stands at a value other than zero, and closes the
   * frames of its `group` once all of them are zero. A word the block does not write keeps
   * its earlier value (the TNC manual: an angle that is not programmed stays unchanged), and
   * a value that is not a plain number (`SPB+Q5`) counts as not zero, so a frame stays open
   * when in doubt. Read by the modal interpreter (`_nc_modal.py`).
   */
  frameZeroWords?: string[];
  /**
   * M12.5 (§7.16 #180; TNC 640 cycle manual, cycle 19: "define
   * cycle 19 again and answer the dialog question with NO ENT" switches the tilt off). The
   * sub-block number — the digits after the point, `"1"` for `CYCL DEF 19.1` — whose block,
   * when it writes **none** of the `frameZeroWords`, closes the frames of the code's `group`.
   * Any other block that writes none of them still changes nothing (`CYCL DEF 19.0` only
   * names the cycle), and a sub-block that writes some of them keeps the `frameZeroWords`
   * reading. Only meaningful with `frameZeroWords`. Read by the modal interpreter
   * (`_nc_modal.py`); the loader (`load.ts`) copies it (WP-RP4).
   */
  frameEmptyCloses?: string;
  /**
   * M10 (WP10.2, the program checks; plan §7.16). The states in which the control refuses
   * this code, each one of `tcp`, `radiusComp`, `lengthComp`, `cycle` (a modal cycle or call),
   * `surfaceSpeed`, `feedNotPerMinute`, or `frame:<group>` (an open frame of that group); a
   * leading `!` turns one round ("refused unless"): Fanuc `G53.1` is `['!frame:frame']`. Read
   * by `program_checks.py` (`stateConflicts`).
   */
  conflicts?: string[];
  /**
   * M10 (WP10.2). The code has to stand in a block of its own (Fanuc `G53.1`, Okuma `M110`).
   * On a `wordsAreData` code (a macro call, `G65`) its arguments may follow it.
   */
  alone?: boolean;
  /** M10 (WP10.2). The block of this code has to write at least one of these addresses or keywords (Klartext `PLANE …` one of `MOVE`, `TURN`, `STAY`). */
  requires?: string[];
  /**
   * M10 (WP10.2). The blocks from an `'open'` code to its `'close'` describe a contour a later
   * cycle machines (the Okuma LAP shape between `G81`/`G82`/`G83` and `G80`); they do not move.
   */
  contour?: 'open' | 'close';
  /**
   * M10 review (NC-2). The circle centre or pole of a dialect that writes it in a block of its
   * own (Klartext `CC`): `'set'` on the code whose axis words are the pole, `'use'` on the
   * codes that move around it (`C`, `LP`, `CP`, `CTP`). The axis words of a `'set'` block are
   * a **position** in the program's frame (absolute, or with the incremental prefix relative
   * to the last position), not data, even though the entry keeps `axisWords: 'data'` for the
   * readers that only ask whether the block moves: address arithmetic moves an absolute pole
   * with its axes, extents work out the polar moves from it.
   */
  pole?: 'set' | 'use';
  /**
   * M10 review (NC-6). The code runs another program and hands it the block's words as its
   * arguments (Fanuc `G65`). Unlike a data code (`G10`, `G52`), those arguments may be
   * absolute positions of this program (a probing or protected move), so address arithmetic
   * refuses and lists a block whose call writes a chosen address with a number. Only `true`;
   * usually together with `wordsAreData`.
   */
  call?: boolean;
  /**
   * M10 review (NC-7). The axis words of this code shift or set the program's coordinate
   * system (Fanuc `G52`, `G92`, the lathe `G50`, `G10`; Sinumerik `TRANS`, `ATRANS`; Okuma
   * `G50`): the absolute positions after it lie in another system than those before it, so
   * the extents start a new group there, and a multiply or divide refuses to scale it. A
   * block that writes no axis word (`G50 S2000`, a clamp) shifts nothing, except where it
   * writes no value at all (`TRANS` alone, a reset). Only `true`.
   */
  shift?: boolean;
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

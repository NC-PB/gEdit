#!/usr/bin/env python3
# /// gedit
# name = "Scale feed rates"
# description = "Multiplies F values by a percentage, an F written in a rapid block included: it is the feed of the moves after it. Thread leads and tapping feeds, rapid keywords such as FMAX, feeds written as variables and feeds under a code the database does not know are left alone and reported."
# input = "selection-or-document"
# output = "replace"
# envelope = true
#
# [[params]]
# id = "percent"
# type = "number"
# label = "Percentage"
# help = "100 % leaves every feed as it is."
# default = 100
# required = true
# min = 0.1
# max = 1000
# decimals = 3
#
# [[params]]
# id = "decimals"
# type = "choice"
# label = "Decimal places"
# help = "As written keeps the number of decimals each value was written with."
# default = "keep"
# choices = [
#   { label = "As written", value = "keep" },
#   { label = "0", value = "0" },
#   { label = "1", value = "1" },
#   { label = "2", value = "2" },
#   { label = "3", value = "3" },
#   { label = "4", value = "4" }
# ]
#
# [[params]]
# id = "minFeed"
# type = "number"
# label = "Smallest feed"
# help = "A scaled feed below this is raised to it. Empty means no limit."
# required = false
# min = 0
#
# [[params]]
# id = "maxFeed"
# type = "number"
# label = "Largest feed"
# help = "A scaled feed above this is lowered to it. Empty means no limit."
# required = false
# min = 0
#
# [[params]]
# id = "onlyAbove"
# type = "number"
# label = "Only feeds above"
# help = "Feeds at or below this value are left as they are."
# required = false
#
# [[params]]
# id = "onlyBelow"
# type = "number"
# label = "Only feeds below"
# help = "Feeds at or above this value are left as they are."
# required = false
#
# [[params]]
# id = "limitUnit"
# type = "choice"
# label = "The limits are in"
# help = "Which feeds the smallest and largest feed and the two filters above are compared with. A feed in another unit is scaled without the smallest and largest feed, and left as it is while a filter is set, and the run says so: a largest feed of 0.3 meant per revolution must never lower a feed per minute, nor a smallest feed of 100 per minute raise a feed per revolution. Automatically means per revolution on a turning profile and per minute on a milling profile."
# default = "auto"
# choices = [
#   { label = "Automatically (per revolution when turning)", value = "auto" },
#   { label = "Feed per minute", value = "per-minute" },
#   { label = "Feed per revolution", value = "per-rev" }
# ]
#
# [[params]]
# id = "perRevolution"
# type = "choice"
# label = "Also scale per-revolution feeds"
# help = "A feed per revolution (G99 or G95, and the Klartext FU and FZ feeds) is not millimetres per minute. Automatically means yes on a turning profile, where nearly every feed is one, and no on a milling profile."
# default = "auto"
# choices = [
#   { label = "Automatically (yes when turning)", value = "auto" },
#   { label = "Yes", value = "yes" },
#   { label = "No", value = "no" }
# ]
#
# [[params]]
# id = "inverseTime"
# type = "bool"
# label = "Also scale inverse-time feeds"
# help = "G93, where F is the reciprocal of the time the block may take."
# default = false
# ///
"""Scale feed rates (plan section 5, WP4.7; `nc-transformations.md`, "Scale feed rates").

Multiplies the feed of every block by a percentage and hands the program back through the
`envelope` output, together with a summary and one finding per value it refused to touch.

What it never does, and why
---------------------------
A feed that is not a feed rate must not be scaled. Getting this wrong does not produce a
slower program, it produces a broken thread or a crash, so each rule is checked against
the **tokens** of the block and against the profile's own code database, never against a
regex over the raw line:

``F`` inside a comment or a string
    is not a token with the feed address at all. `gedit_nc.tokenize_line` knows the
    dialect's comment syntax, so `(FINISH F500 PASS)` and `; F500` stay as they are.
Thread pitches
    in tapping and thread-cutting blocks the ``F`` word carries the pitch or the lead, not
    a speed. Which codes those are comes from the code database's ``pitchFeed`` flag
    (`FeedModeTracker`), because the same number means different things per dialect: Fanuc
    `G84`, `G74`, `G84.2`, `G84.3`, `G32`, `G33` and the Klartext tapping cycles carry a
    pitch. The database decides; this script has no table of its own. A tapping **mode** is
    one too (Fanuc `G63`, a modal code of its own group): every `F` while it is the active
    code of its group is a tap's feed, until `G61`, `G62` or `G64` replaces it
    (``FeedModeTracker.pitch_mode``, the 2026-09 decision on `pitchFeed` outside a cycle or
    motion group).
Codes the database does not know
    a builder's cycle under a G number of its own (a radial tapping cycle) had its lead
    scaled like a feed. The `F` of a block that writes a code the database does not know,
    under the letter the database writes its moves with (`G` on the ISO dialects, none on
    Klartext), is reported and left: what that `F` is cannot be told (R10). A run without a
    database says so once and scales as before.
Arguments and data
    the words of a block whose code the database marks ``wordsAreData`` are the arguments of
    a macro call (`G65 P9810 Z-5. F3000.`, `G66`) or the values of a data-setting block
    (`G10`), not feeds of this program. They are reported and left, and not counted as
    feed rates.
A second feed address
    `E` is never the F word: the feed along an Okuma LAP contour, a thread lead or a dwell
    elsewhere. Where no code of its block, and not the cycle in force, declares `E` as a
    parameter, and the block is no thread and no dwell, it is reported and left.
Codes that mean two things
    `G76` is a fine boring cycle on the shipped mill dialect and a multi-pass threading
    cycle on a lathe in G-code system A; `G92` sets the coordinate system on the one and
    is the single-pass threading cycle on the other. Nothing in the block says which when
    a turning program is opened with the mill profile, so the mill database marks these
    entries ``pitchFeedAmbiguous`` and the script **refuses** them with a warning rather
    than multiplying what may be a thread lead. Refusing a real boring feed costs one
    manual edit; scaling a lead scraps the part. On the lathe profile there is nothing to
    refuse: `G76`, `G92`, `G32` and `G78` carry ``pitchFeed`` outright, and their `F` is a
    thread lead, which is never scaled.
Which code is a feed mode
    is data, not a table in this file: a Fanuc lathe in G-code system A writes `G98` /
    `G99`, in system B `G94` / `G95`, and in system A `G94` is a **facing cycle** and not a
    feed mode at all (`FeedModeTracker` over the database's `sets`, plan AD-19, F24). The
    state the control powers on in comes from the effective profile's `modal.initial`, so a
    turning program that never writes a feed mode is still read in feed per revolution.
Selections
    feed modes and cycles are modal, so a run over a selection starts in the middle of a
    sentence. When the context carries `input.precedingLines` the run is **primed** from
    the lines above the selection (`gedit_nc.prime_tracker`), so a `G95` or a `G84` that
    starts higher up is in force here exactly as it would be in a whole-document run, and
    the run says at its first line what it inherited. When the field is absent — which is
    a supported context, not a fault — the run still happens, from the top-of-program
    state, and opens with a warning saying what it could not see.
Rapid
    Klartext `FMAX` and `FAUTO` are keywords, not numbers, so they are never touched.
Feed modes
    per revolution (`G99` or `G95`, and Klartext `FU` / `FZ`) and inverse time (`G93`) are
    a different unit from feed per minute. Scaling them is linear and correct, it is just
    rarely what was meant on a milling program — and it is nearly always what is meant on a
    turning one, where almost every feed is per revolution. So the option is **auto / yes /
    no** and auto follows the profile's `machineType`: yes on a lathe, no on a mill. What is
    not scaled is listed, with the code that put the mode in force.
Variables and expressions
    `F#101`, `FQ50`, `F[#1+2.]`, `F=R1`, `F=V1`, or an `F` with no value at all: there is
    no number to scale. They are skipped and reported, never rewritten.
Dwell times
    in a dwell block the `F` word is a time, not a feed (the database's ``fNotFeed``: Okuma
    `G04 F2`, Sinumerik `G4 F2`). It is never scaled, and it is not a feed rate either, so it
    is not counted as one; the summary says how many were left as written.
Cycle parameters
    a Klartext cycle definition carries its feeds as `Q` parameters (`Q206`), and a cycle
    written as a call (`CYCLE85(…)`, `CYCLE95(…)`) carries them as arguments. Both are
    listed and left unchanged (plan section 5); which argument is which comes from the
    order of the database's ``params``.
A tapping cycle written as a call
    stands in a block of its own, so it has no `F` word of its own either. A call whose
    database entry carries ``pitchFeed`` is one that may take its thread lead from the
    feed **in force** (a tapping cycle without a spindle encoder, where the feed has to be
    the speed times the pitch): that `F` is left exactly as written and reported, whatever
    line it stands on. A call written behind a keyword whose ``sets.cycle`` is
    ``'call-modal-next'`` (`MCALL CYCLE840(…)`) repeats after every following move until that keyword stands on
    its own again, so every `F` written in between is left too. A cycle whose lead is one
    of its own arguments (a rigid tapping cycle, a thread-turning cycle) carries no
    ``pitchFeed`` and changes nothing here. The walk for these starts at the top of the
    document, the lines above a selection included, so a selection that starts inside a
    modal call, or below the feed a call runs with, is read as the whole document is.
Feeds of their own
    a feed written under an address that extends the feed address and takes `=` (a
    chamfer or corner feed `FRC=`, `FRCM=`, the feeds `FA=` / `FB=` of a contour
    continuation) is not the `F` word. It is reported and left as written.

Numbers
-------
Arithmetic is `decimal.Decimal` through `gedit_nc.scale_decimal`, and the result is
written by `gedit_nc.format_number` with the profile's `numberFormat`, so `1200.` keeps
its trailing point on a Fanuc control, `.15` keeps its dropped leading zero, the written
precision survives unless the run asks for a fixed one, and rounding is half away from
zero. Nothing here ever sees a float.

Two rules protect the value itself:

* Where the profile says the decimal point is **significant** (`F100` is not `F100.`), a
  value written without a point is never given one. Asking for two decimals would
  otherwise turn `F100` into `F90.00`, which a control in the standard increment system
  reads as ninety times the feed. Such values are rounded to whole numbers and counted.
* A value that would round to **zero** is left as it was and reported. `F0` is not a slow
  feed, it is a block that does not move.

The machine, and what the limits compare
----------------------------------------
`F155` is 155 mm/min on one control and 0.155 mm/min on the next: how a number written
without a decimal point is read is a **machine** parameter, not a property of the dialect
(plan §7.15, AD-31). Scaling itself is unaffected — multiplying a literal by a percentage
gives the same answer in every reading, which is why every value above is scaled as it is
written — but the four limits are not: "largest feed 3000" is 3000 mm/min, and comparing it
with the literal `F3500000` of a control in increments of 0.001 would clamp a feed of
3500 mm/min that is well inside the limit.

So the limits (`minFeed`, `maxFeed`, `onlyAbove`, `onlyBelow`) compare the **effective**
value, through `gedit_nc.resolve_value` with the document's machine, and a clamped value is
written back into the word's own form with `gedit_nc.write_back`, so a point-less word stays
point-less. `gedit_nc.machine_params` answers the profile's own defaults for a document with
no machine, and the run's summary always says which of the two it used.

The limits are also **in one feed unit** (M9, `limitUnit`): per revolution on a turning
profile and per minute on a milling one, unless the run says otherwise. A feed in another
unit is scaled without the smallest and largest feed and reported. A largest feed of 0.3
typed for the turning feeds lowered every `G98 F200` of the same program to `F0.3`, and a
smallest feed of 100 raised a feed per revolution to 100 mm/rev — a number in the right range for the wrong unit is the
most dangerous kind there is. The unit of a feed is its number class
(`gedit_nc.number_class_of`): the feed mode in force, or what the code database declares
for the code of the block or the move in force (Okuma `G101`-`G103` cut at a feed per
minute whatever the feed mode is).

Where a word has **no** value — it has no class at all, or no machine is chosen and the
profile's presets do not read it alike (AD-31, "No machine, no guess"; on the Fanuc presets
a point-less feed per revolution is 0.25 mm/rev in increments and 25 as written, M9) — the
feed is still scaled as a count, the limits are not applied to it, and the run says so.
Guessing the value there is how a feed ends up a thousand times too large.

The two filters are different (M9 review NC-F1). "Only feeds above" and "only feeds below"
say **which** feeds are scaled, so a feed they cannot be compared with — one in another
unit, or one with no value — is left exactly as written and reported, whether or not a
smallest or largest feed is also set. Letting it through scaled every `G98 F200` of a
program whose filter said "only feeds below 0.3 mm/rev".

A profile-range cycle with no range
-----------------------------------
A cycle whose database entry runs the profile between a `P` and a `Q` block (the Fanuc
lathe roughing cycles `G71`, `G72` and `G73`) carries its feed in the block that names that
range: a Fanuc `G71` always writes `P`/`Q` or `U…R`. The same `G71 X… Z… F2.` without a `P`
is an Okuma thread cycle, whose `F` is the lead. A program detected as the wrong one of the
two — and nothing else in the block says which — had its lead multiplied. So while no
machine confirms the dialect (the document has none chosen), the `F` of such a block
without a `P` is left and reported; with a machine of this profile chosen it is scaled.

Everything outside the values it scales — line endings, encoding, the trailing newline,
spacing, block numbers, skip marks and comments — is handed back byte for byte, because
the only edits made are the value spans of feed word tokens.

`scale_speed.py` is the same script for `S` words, and deliberately stands on its own: a
bundled script is one file, so the two share `gedit_nc` and nothing else.
"""

from __future__ import annotations

import re
import sys
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc

#: The feed mode a plain `F` is written in; `FeedModeTracker` starts here.
PER_MINUTE = "G94"

#: Klartext writes a feed per revolution and a feed per tooth with their own address
#: (plan section 7.10). They are feeds, but not in millimetres per minute.
PER_REVOLUTION_ADDRESSES = ("FU", "FZ")

#: What each mode is called in a finding. The keys are `FeedModeTracker.feed_mode` values
#: and the two addresses above. An ISO mode also names the **code** that is in force, which
#: is a property of the dialect and of its G-code system: per revolution is `G95` on a mill,
#: `G99` on a lathe in system A and `G95` again in system B (see :func:`mode_text`).
MODE_TEXT = {
    "G95": "a feed per revolution",
    "G93": "an inverse-time feed",
    # M9 review F8: Sinumerik `G931`. Its F is a time, so scaling it would move the other
    # way; no option scales it.
    "G931": "a travel time, not a feed rate",
    "FU": "a feed per revolution",
    "FZ": "a feed per tooth",
}

#: The modes whose text carries the code in force. The Klartext modes are addresses: the
#: word in the finding already spells them out (`FU0.12`), so a code in brackets would only
#: repeat it.
CODE_IN_TEXT = ("G93", "G94", "G95", "G931")

#: The modes each option covers.
PER_REVOLUTION_MODES = ("G95", "FU", "FZ")

#: M9: the number class of the feeds the limits are in, per `limitUnit` choice.
LIMIT_CLASS = {"per-minute": "feedPerMin", "per-rev": "feedPerRev"}

#: What a finding calls a feed of a number class (`gedit_nc.number_class_of`).
CLASS_TEXT = {
    "feedPerMin": "a feed per minute",
    "feedPerRev": "a feed per revolution",
    "feedPerTooth": "a feed per tooth",
    "inverseTime": "an inverse-time feed",
}

#: The limits' unit, as a finding names it.
LIMIT_TEXT = {"feedPerMin": "per minute", "feedPerRev": "per revolution"}

#: M9: the feed mode a code's declared feed class puts the word in, whatever mode is in
#: force (Okuma `G101` cuts at a feed per minute under `G95`). A declared lead is a
#: thread and never reaches the mode question.
MODE_OF_CLASS = {"feedPerMin": "G94"}
INVERSE_TIME_MODES = ("G93",)

#: A `FeedModeTracker.feed_mode` as the §7.1 feed unit the number rules think in. The
#: tracker answers in Phase 1's names — per revolution is `'G95'` whatever code the dialect
#: writes — and `gedit_nc.number_class_of` wants the unit. Klartext's `FU` / `FZ` are not
#: here: they are addresses, and the profile's `addresses.feedUnitWords` says what they mean.
UNIT_OF_MODE = {"G93": "inverse-time", "G94": "per-minute", "G95": "per-rev", "G931": "travel-time"}

#: A cycle parameter whose code-database label names it a feed. The label is display text
#: out of the database we ship, and this only decides what is **listed**: a cycle
#: parameter is left unchanged either way, because it is not a feed word.
FEED_PARAM_LABEL = re.compile(r"\bfeed", re.IGNORECASE)

#: The same question for the arguments of a cycle written as a call (`CYCLE85(…)`), where a
#: database also names factors of the feed (`FRF`, "feed factor for the first peck"). A
#: factor follows the feed it multiplies, so listing it as a feed left alone would invite a
#: hand edit that doubles the change; it is not listed.
CALL_FEED_LABEL = re.compile(r"\bfeed\b(?!\s+factor)", re.IGNORECASE)

#: The second feed-like address of the ISO dialects: a contour feed of its own inside a
#: turning-cycle shape on one control (the feed along an Okuma LAP contour), a thread lead
#: on another, a dwell or a lead change as a cycle parameter. It is never the F word, so it
#: is never scaled; where no code of its block declares it as a parameter it is reported,
#: because it may be a feed that did not follow the others (the M8 re-review).
SECOND_FEED_ADDRESS = "E"

#: At most this many findings; the rest are counted in the message. A 100k-line program
#: with a G95 section would otherwise hand the results panel tens of thousands of rows.
MAX_FINDINGS = 200

#: How far the written value may sit from the exact scaled one before the run says so,
#: as a fraction of the exact value.
#:
#: With the default ``decimals = "keep"`` a value is written with the precision it was
#: written with, and on a lathe that is one or two decimals: 150 % of ``F0.1`` is 0.15,
#: which written with one decimal is ``F0.2`` — the feed doubled where half again was
#: asked for (G8 M4). Rounding to the written precision is the right default, because
#: inventing decimals a post never wrote is worse; being quiet about a 100 % error is
#: not. 5 % is well outside anything ordinary rounding does to a four-digit mill feed
#: and well inside the error a one-decimal lathe feed can take.
ROUNDING_NOTICE = Decimal("0.05")


def as_dict(value: Any) -> Dict[str, Any]:
    """``value`` when it is a dictionary, else an empty one — the context arrives as JSON."""
    return value if isinstance(value, dict) else {}


def decimal_text(value: Any) -> Optional[str]:
    """A parameter value as an exact decimal string, or ``None`` when it is not a number.

    Form values arrive as JSON, so a percentage can be an int, a float or text. A float is
    read through its ``repr``, which is the shortest string that reads back as the same
    double, and is written without an exponent so that it parses as an NC number.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        try:
            number = Decimal(repr(value))
        except InvalidOperation:
            return None
        if not number.is_finite():
            return None
        return format(number, "f")
    if isinstance(value, str):
        text = value.strip()
        return text if gedit_nc.parse_number(text) is not None else None
    return None


def decimal_param(values: Dict[str, Any], key: str, label: str, default: Optional[str] = None) -> Optional[str]:
    """One numeric parameter as a decimal string. An unusable value is an error, not a guess."""
    value = values.get(key)
    if value is None or value == "":
        return default
    text = decimal_text(value)
    if text is None:
        raise ValueError("%s: %r is not a number." % (label, value))
    return text


def decimals_param(value: Any) -> Any:
    """``'keep'`` or a decimal count. Anything else is an error."""
    if value is None or value == "" or value == "keep":
        return "keep"
    if isinstance(value, bool):
        raise ValueError("Decimal places: %r is not a number of decimals." % (value,))
    if isinstance(value, int):
        count = value
    elif isinstance(value, str) and value.strip().isdigit():
        count = int(value.strip(), 10)
    else:
        raise ValueError("Decimal places: %r is not a number of decimals." % (value,))
    if count < 0 or count > 10:
        raise ValueError("Decimal places: %d is outside 0 to 10." % count)
    return count


def trim(value: Decimal) -> str:
    """A decimal as short text, never in exponent form: ``Decimal('90.0')`` is ``'90'``."""
    return format(value.normalize(), "f")


def choice_param(value: Any, default: str = "auto") -> str:
    """An ``auto`` / ``yes`` / ``no`` option, from the form or from an older context.

    Phase 1 declared this option as a ``bool``; the form engine turns a remembered ``false``
    into the field's default when a field becomes a ``choice`` (plan F33), so the app never
    sends one. A context written by hand or by an older build still can, and a run that
    says ``true`` or ``false`` meant it — so both are honoured rather than quietly turned
    into ``auto``, which would scale a per-revolution feed a caller had asked to leave.
    """
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return value if value in ("auto", "yes", "no") else default


def count_text(count: int, singular: str, plural: Optional[str] = None) -> str:
    """``1 feed rate`` / ``4 feed rates``."""
    return "%s %s" % ("{:,}".format(count), singular if count == 1 else (plural or singular + "s"))


class Params:
    """The run's parameters, turned into exact decimals and the profile's number format."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        self.percent_text = decimal_param(values, "percent", "Percentage", "100")
        self.percent = Decimal(self.percent_text)
        if self.percent <= 0:
            raise ValueError("Percentage must be greater than zero.")

        self.min_text = decimal_param(values, "minFeed", "Smallest feed")
        self.max_text = decimal_param(values, "maxFeed", "Largest feed")
        self.min_feed = None if self.min_text is None else Decimal(self.min_text)
        self.max_feed = None if self.max_text is None else Decimal(self.max_text)
        if self.min_feed is not None and self.max_feed is not None and self.min_feed > self.max_feed:
            raise ValueError("The smallest feed is larger than the largest feed.")

        above = decimal_param(values, "onlyAbove", "Only feeds above")
        below = decimal_param(values, "onlyBelow", "Only feeds below")
        self.only_above = None if above is None else Decimal(above)
        self.only_below = None if below is None else Decimal(below)

        self.fmt = gedit_nc.number_format_of(profile)
        self.decimals = decimals_param(values.get("decimals"))
        if self.decimals != "keep":
            self.fmt["decimals"] = self.decimals

        syntax = as_dict(profile.get("syntax"))
        self.decimal_point_significant = syntax.get("decimalPointSignificant") is True
        #: A fixed decimal count would give a point-less value a point; see the docstring.
        self.whole_fmt = dict(self.fmt)
        self.whole_fmt["decimals"] = 0

        addresses = as_dict(profile.get("addresses"))
        feed = addresses.get("feed")
        self.feed_address = feed if isinstance(feed, str) and feed != "" else "F"

        # A feed per revolution is the ordinary feed of a turning program and the exception
        # on a milling one, so "automatically" follows the profile's `machineType`
        # (plan §7.4). The option still says yes or no outright.
        self.per_revolution_choice = choice_param(values.get("perRevolution"))
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        self.per_revolution = (
            self.lathe if self.per_revolution_choice == "auto" else self.per_revolution_choice == "yes"
        )
        self.inverse_time = values.get("inverseTime") is True

        # M9: the unit the four limit values are in. "Automatically" follows the profile as
        # the per-revolution option does: the turning feeds of a lathe, the per-minute
        # feeds of a mill.
        limit_unit = values.get("limitUnit")
        self.limit_choice = limit_unit if limit_unit in ("auto", "per-minute", "per-rev") else "auto"
        unit = self.limit_choice if self.limit_choice != "auto" else ("per-rev" if self.lathe else "per-minute")
        self.limit_class = LIMIT_CLASS[unit]

        #: True while a limit or a filter is set: only then does the run need to know what
        #: a value is **worth**, and only then does it pay for working it out.
        self.has_limits = any(
            limit is not None
            for limit in (self.min_feed, self.max_feed, self.only_above, self.only_below)
        )
        #: True while "only feeds above" or "only feeds below" is set. A filter decides
        #: **whether** a feed is scaled, so a feed it cannot be compared with is left as
        #: written; the smallest and largest feed only bound a scaled one (NC-F1).
        self.has_filter = self.only_above is not None or self.only_below is not None

    def filter_text(self) -> str:
        """The filter the run set, as a finding names it: ``"only feeds below" value (0.3)``."""
        if self.only_above is not None and self.only_below is not None:
            return '"only feeds above" and "only feeds below" values (%s and %s)' % (
                trim(self.only_above),
                trim(self.only_below),
            )
        if self.only_above is not None:
            return '"only feeds above" value (%s)' % trim(self.only_above)
        return '"only feeds below" value (%s)' % trim(self.only_below)

    def filter_verb(self) -> str:
        """``is`` for one filter, ``are`` for both."""
        return "are" if self.only_above is not None and self.only_below is not None else "is"

    def format_for(self, token: gedit_nc.Token) -> Tuple[Dict[str, Any], bool]:
        """The number format for this value, and whether it had to be kept whole.

        A fixed decimal count is dropped for a value the file wrote without a decimal
        point in a dialect where the point is significant: giving it one changes what the
        control reads.
        """
        if (
            self.decimal_point_significant
            and self.decimals != "keep"
            and self.decimals > 0
            and token.value is not None
            and not token.value.has_point
        ):
            return self.whole_fmt, True
        return self.fmt, False

    def scales(self, mode: str) -> bool:
        """True when this run scales feeds written in ``mode``."""
        if mode == PER_MINUTE:
            return True
        if mode in PER_REVOLUTION_MODES:
            return self.per_revolution
        if mode in INVERSE_TIME_MODES:
            return self.inverse_time
        # A mode this build does not know is left alone: it cannot be shown to be minutes.
        return False


class Reading:
    """How this run reads the program: the dialect's feed units and the machine's numbers.

    What the document's machine says a written number is worth (plan §7.15, AD-31).

    The whole of the machine's effect on this script: the limits compare values, everything
    else works on the literal. It answers ``None`` for a word whose value is not settled,
    and the caller then scales the word and leaves the limits out of it.

    ``gedit_nc.machine_params`` answers the profile's documented defaults for a context
    without a machine (an M5 context, or a document with "none" chosen), so there is no
    second path through this file for "no machine".
    """

    def __init__(
        self, context: Dict[str, Any], profile: Dict[str, Any], codes: Sequence[Dict[str, Any]]
    ) -> None:
        self.profile = profile
        #: Klartext `{'FU': 'per-rev'}`; empty on a dialect whose feed unit is a code.
        self.words = feed_unit_words(profile)
        #: Feed unit -> the code that switches to it, for a finding that names it.
        self.by_unit = codes_by_unit(codes)
        self.effective = gedit_nc.machine_params(context)
        params = as_dict(self.effective.get("params"))
        self.name = self.effective.get("name")
        self.chosen = self.effective.get("id") is not None
        #: mm or inch at power-on; `sets.units` in the program moves it (AD-19).
        self.units = params.get("units") if params.get("units") in ("mm", "inch") else "mm"
        #: (literal text, written with a point, class, units) -> (value, readings). A
        #: 100,000-line program writes the same few feeds over and over.
        self._cache: Dict[Any, Tuple[Optional[str], List[Dict[str, Any]]]] = {}
        #: The code whose ``sets.feedUnit`` is in force, and that unit: the power-on code
        #: until the program writes one. A finding names it, because on a control where
        #: several codes switch to one unit (`G95`, `G96`, `G97` all mean per revolution on
        #: a Sinumerik) the unit alone does not say which code put the feed in force.
        self.feed_code: Optional[str] = None
        self.feed_code_unit: Optional[str] = None

    def note(self) -> str:
        """What the summary says about the machine this run read the program with."""
        if self.chosen and isinstance(self.name, str) and self.name != "":
            return "Machine %r." % self.name
        return "No machine: profile defaults assumed."

    def sets_units(self, entries: Sequence[Dict[str, Any]]) -> None:
        """Applies this block's ``sets.units`` (Fanuc `G20` / `G21`), AD-19 rule 1."""
        for entry in entries:
            sets = entry.get("sets")
            units = sets.get("units") if isinstance(sets, dict) else None
            if units in ("mm", "inch"):
                self.units = units

    def sets_feed_code(self, entries: Sequence[Dict[str, Any]]) -> None:
        """Remembers the code of this block that switches the feed unit, if it has one."""
        for entry in entries:
            sets = entry.get("sets")
            unit = sets.get("feedUnit") if isinstance(sets, dict) else None
            code = entry.get("code")
            if isinstance(unit, str) and isinstance(code, str) and code != "":
                self.feed_code, self.feed_code_unit = code, unit

    def unit_of(self, mode: str) -> str:
        """The §7.1 feed unit a `FeedModeTracker` mode name stands for."""
        if mode in self.words:
            return self.words[mode]
        return UNIT_OF_MODE.get(mode, "unknown")

    def mode_text(self, mode: str) -> str:
        """What a finding calls the feed mode a value is written in.

        The ISO modes name the code that is in force, which the database decides: a turning
        program in G-code system A reads "a feed per revolution (G99)" although
        `FeedModeTracker` calls that mode `G95` (plan §7.10, F24). The code the program
        actually wrote wins, because a unit may have several codes: a Sinumerik `G96` puts
        the feed per revolution in force as much as `G95` does.
        """
        text = MODE_TEXT.get(mode)
        if text is None:
            return "in the feed mode " + mode
        if mode not in CODE_IN_TEXT:
            return text
        unit = self.unit_of(mode)
        if self.feed_code is not None and self.feed_code_unit == unit:
            return "%s (%s)" % (text, self.feed_code)
        return "%s (%s)" % (text, self.by_unit.get(unit, mode))

    def number_class(
        self,
        token: gedit_nc.Token,
        tracker: gedit_nc.FeedModeTracker,
        entries: Sequence[Dict[str, Any]],
        in_force: Sequence[Dict[str, Any]] = (),
    ) -> Optional[str]:
        """The §7.15 number class of this feed word in this block, or ``None``.

        ``in_force`` are the entries of the move, the cycle and the mode in force that the
        block does not write (M9): what they declare for the feed word holds here too.
        """
        return gedit_nc.number_class_of(
            token.address or "",
            self.profile,
            self.unit_of(feed_mode_of(token, tracker)),
            entries,
            tracker.pitch_feed,
            list(in_force),
        )

    def resolve(
        self, token: gedit_nc.Token, number_class: Optional[str]
    ) -> Tuple[Optional[str], List[Dict[str, Any]]]:
        """``(value, readings)`` for this word: what it is worth, or what has to be asked.

        A non-empty ``readings`` means the reading depends on a machine nobody chose
        (AD-31); an empty one with no value means the word has no value at all here.
        """
        literal = token.value
        if literal is None or number_class is None:
            return (None, [])
        key = (literal.raw, literal.has_point, number_class, self.units)
        found = self._cache.get(key)
        if found is None:
            found = gedit_nc.resolve_value(literal, number_class, self.effective, self.profile, self.units)
            self._cache[key] = found
        return found

    def write_back(
        self, value: str, token: gedit_nc.Token, number_class: Optional[str], fmt: Dict[str, Any]
    ) -> Tuple[Optional[str], bool, Optional[str]]:
        """A value put back into this word's own form (``gedit_nc.write_back``)."""
        return gedit_nc.write_back(
            value, token.value, number_class, self.effective, self.units, fmt
        )


def power_on_state(
    tracker: gedit_nc.FeedModeTracker, cp: gedit_nc.CompiledProfile
) -> List[Dict[str, Any]]:
    """Puts the tracker into the state the control powers on in (plan AD-19 rule 8, AD-31).

    Answers the database entries of the power-on codes, so a finding can name the one that
    put the feed unit in force.

    `FeedModeTracker` is Phase 1's API: it is built from a code database alone, so it starts
    every run in feed per minute and in rpm — which is what a milling control powers on in,
    and what Phase 1 assumed everywhere. A turning control does not: a Fanuc lathe in G-code
    system A powers on in `G99`, feed **per revolution**, in system B in `G95`, and the
    document's machine may say something else again (plan §7.15).

    The **effective** profile carries that state in `modal.initial`, so the run walks those
    codes through the tracker as the block before the first one. A feed-mode or spindle-mode
    code in the program then overrides it exactly as it overrides a code on an earlier line,
    and a dialect that declares no power-on state (Klartext) is untouched.
    """
    initial = as_dict(as_dict(cp.profile.get("modal")).get("initial"))
    codes = [value for value in initial.values() if isinstance(value, str) and value != ""]
    if not codes:
        return []
    tokens, _ = gedit_nc.tokenize_line(" ".join(codes), cp, None)
    tracker.update(tokens)
    return block_entries(tokens, tracker)


def block_entries(
    tokens: Sequence[gedit_nc.Token], tracker: gedit_nc.FeedModeTracker
) -> List[Dict[str, Any]]:
    """The code-database entries of the codes this block writes, in written order.

    An ISO dialect writes a code as an address word (`G21` is `G` + `21`); Klartext writes
    it as a keyword whose number may stand in the next token (`CYCL DEF` + `247`). Both
    spellings reach the same entry, through `FeedModeTracker.entry`, which follows aliases.

    They are what `gedit_nc.number_class_of` needs to see a cycle parameter's declared unit
    and an `fNotFeed` block, and what carries `sets.units`.
    """
    out: List[Dict[str, Any]] = []
    count = len(tokens)
    for i, token in enumerate(tokens):
        if token.kind == "word":
            # An address written with `=` is a value and never a code (`M3=3` is not M33).
            address = token.address or ""
            written = (
                address + (token.value_text or "")
                if address != "" and not assignment_word(token)
                else ""
            )
        elif token.kind == "call":
            # A cycle written as a call is the code of its identifier (`CYCLE84(…)`).
            written = token.address or ""
        elif token.kind == "keyword":
            name = token.address or token.text
            number = token.value_text
            if number is None:
                for j in range(i + 1, count):
                    if tokens[j].kind == "whitespace":
                        continue
                    nxt = tokens[j]
                    if nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                    break
            written = "%s %s" % (name, number) if number is not None else name
            if tracker.entry(written) is None:
                written = name
        else:
            continue
        entry = tracker.entry(written) if written else None
        if entry is not None:
            out.append(entry)
    return out


def last_motion(entries: Sequence[Dict[str, Any]], motion: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The motion code in force after a block: the last one it writes, else the one before.

    A modal move is the active code of the motion group until another replaces it (AD-19
    rule 1); a one-shot cycle of the group does not stay in force.
    """
    for entry in entries:
        if entry.get("group") == "motion" and entry.get("modal") is True:
            motion = entry
    return motion


def assignment_word(token: gedit_nc.Token) -> bool:
    """True for an address written with `=` (plan §7.5): `F=R1`, `SB=1200`, `M3=3`.

    The address is exactly what stands in front of the `=`, so such a word is a value and
    never a code; `F=R1` is the feed word with a value that is not a number. An indexed
    one (`M[2]=3`, `FA[X]=100`, `syntax.assignmentIndex`) is one too, though its text in
    front of the `=` carries the bracket (M9 review F1).
    """
    if token.kind != "word" or not token.address:
        return False
    if token.index is not None:
        return True
    head, sep, _ = token.text.partition("=")
    return sep == "=" and head.strip().upper() == token.address.upper()


def feed_unit_words(profile: Dict[str, Any]) -> Dict[str, str]:
    """``addresses.feedUnitWords`` with upper-case keys: Klartext ``{'FU': 'per-rev'}``."""
    addresses = as_dict(profile.get("addresses"))
    words = as_dict(addresses.get("feedUnitWords"))
    return {k.upper(): v for k, v in words.items() if isinstance(k, str) and isinstance(v, str)}


def codes_by_unit(codes: Sequence[Dict[str, Any]]) -> Dict[str, str]:
    """Feed unit -> the code that switches the dialect to it, where exactly one does.

    `G99` on a Fanuc lathe in G-code system A, `G95` on a mill and in system B. A unit two
    codes of one database can switch to is left out: a finding then names the mode instead
    of claiming one of them.
    """
    found: Dict[str, Optional[str]] = {}
    for entry in codes or []:
        if not isinstance(entry, dict):
            continue
        sets = entry.get("sets")
        unit = sets.get("feedUnit") if isinstance(sets, dict) else None
        code = entry.get("code")
        if not isinstance(unit, str) or not isinstance(code, str) or code == "":
            continue
        found[unit] = None if unit in found and found[unit] != code else code
    return {unit: code for unit, code in found.items() if code is not None}


class Findings:
    """The findings of a run, capped so that a huge program cannot flood the panel."""

    def __init__(self, limit: int = MAX_FINDINGS) -> None:
        self.items: List[Dict[str, Any]] = []
        self.dropped = 0
        self.limit = limit

    def add(self, line: int, severity: str, message: str) -> None:
        if len(self.items) >= self.limit:
            self.dropped += 1
            return
        self.items.append({"line": line, "severity": severity, "message": message})

    def in_line_order(self) -> List[Dict[str, Any]]:
        """The findings, by line. Python's sort is stable, so one line keeps its order."""
        return sorted(self.items, key=lambda finding: finding["line"])


class Counts:
    """What the run did, for the summary line."""

    def __init__(self) -> None:
        #: Feed words seen, whatever happened to them.
        self.total = 0
        self.changed = 0
        #: Scaled, but written exactly as it already stood.
        self.same = 0
        #: Left out by "only above" / "only below".
        self.filtered = 0
        self.clamped = 0
        #: Cycle parameters that are feeds, listed and left unchanged: a Klartext `Q206`, or
        #: an argument of a cycle written as a call (`CYCLE85(…)`).
        self.cycle = 0
        #: Feeds in force when a tapping cycle written as a call runs, which may be its
        #: lead: left as written (:func:`lead_carriers`). Counted in ``total``.
        self.carried = 0
        #: Words under an address of their own that extends the feed address (`FRC=`):
        #: reported and left, not counted in ``total``.
        self.other = 0
        self.other_addresses: List[str] = []
        #: `F` words of a dwell block (`fNotFeed`): times, never feed rates, never scaled.
        self.dwell = 0
        #: `F` words of a block whose words are data (`wordsAreData`: `G65`, `G10`).
        self.data = 0
        #: Written further from the exact scaled value than ROUNDING_NOTICE allows.
        self.rounded = 0
        #: Rounded whole because the dialect's decimal point is significant.
        self.whole = 0
        self.whole_line = 0
        #: Scaled, but with no settled value, so no limit was applied to it (AD-31).
        self.unresolved = 0
        #: M9: scaled, but in another feed unit than the limits, so they were not applied.
        self.other_unit = 0
        #: Left as written: a value filter is set and cannot be compared with the feed
        #: (another unit, or no settled value), NC-F1.
        self.filter_unknown = 0
        #: Left alone because the run would have written a zero feed.
        self.zero = 0
        #: The value was already zero or negative: a limit bounds a feed, it does not
        #: invent one, so neither the scaling nor the limits touch such a block.
        self.nonpositive = 0
        self.skipped: Dict[str, int] = {}

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1

    def skipped_for(self, reason: str) -> int:
        return sum(count for key, count in self.skipped.items() if key.split(":", 1)[0] == reason)


def apply_edits(line: str, edits: Sequence[Tuple[int, int, str]]) -> str:
    """Replaces the given spans of ``line``. The spans come from tokens, so they never overlap."""
    out: List[str] = []
    at = 0
    for start, end, text in edits:
        out.append(line[at:start])
        out.append(text)
        at = end
    out.append(line[at:])
    return "".join(out)


def feed_word(token: gedit_nc.Token, params: Params) -> bool:
    """True when this token is a feed word of the active dialect."""
    if token.kind != "word" or token.address is None:
        return False
    return token.address == params.feed_address or token.address in PER_REVOLUTION_ADDRESSES


def feed_mode_of(token: gedit_nc.Token, tracker: gedit_nc.FeedModeTracker) -> str:
    """The mode this feed word is written in: its own address wins over the modal state."""
    if token.address in PER_REVOLUTION_ADDRESSES:
        return token.address
    return tracker.feed_mode


def cycle_definition(
    tokens: Sequence[gedit_nc.Token], tracker: gedit_nc.FeedModeTracker
) -> Optional[Dict[str, Any]]:
    """The code-database entry of the cycle this line **defines**, or ``None``.

    Only a cycle written as a keyword counts (Klartext `CYCL DEF 200`), and only when the
    keyword is the one that named the active cycle. A Fanuc cycle is a plain `G` word
    whose feed is the `F` of the block, which the pitch rule already covers.
    """
    code = tracker.active_cycle
    if code is None:
        return None
    for token in tokens:
        if token.kind != "keyword" or not token.address:
            continue
        if code.startswith(gedit_nc.normalize_code(token.address)):
            entry = tracker.entry(code)
            if entry is not None and entry.get("params"):
                return entry
    return None


def cycle_feed_addresses(entry: Dict[str, Any]) -> List[str]:
    """The cycle's parameters that the code database labels as feeds (`Q206`)."""
    out: List[str] = []
    for param in entry.get("params") or []:
        if not isinstance(param, dict):
            continue
        address = param.get("address")
        label = param.get("label")
        if isinstance(address, str) and address != "" and isinstance(label, str):
            if FEED_PARAM_LABEL.search(label):
                out.append(address.upper())
    return out


def list_cycle_feeds(
    entry: Dict[str, Any],
    tokens: Sequence[gedit_nc.Token],
    line: int,
    findings: Findings,
    counts: Counts,
) -> None:
    """Lists the cycle feeds on this line. They are parameters, not feed words: never scaled."""
    addresses = cycle_feed_addresses(entry)
    if not addresses:
        return
    code = entry.get("code")
    for token in tokens:
        if token.kind != "variable" or token.text.upper() not in addresses:
            continue
        counts.cycle += 1
        findings.add(
            line,
            "info",
            "%s is a feed of %s and is left unchanged." % (token.text, code),
        )


def call_arguments(text: Optional[str]) -> List[str]:
    """The arguments of a call as written, split at the commas between them.

    `5,0,2,-30,,-8` is `['5', '0', '2', '-30', '', '-8']`: an empty argument keeps its place,
    because a cycle reads its arguments by position. A comma inside a string, a bracket or a
    nested call (`AC(10)`) does not split.
    """
    if text is None:
        return []
    out: List[str] = []
    current: List[str] = []
    depth = 0
    quoted = False
    for char in text:
        if quoted:
            quoted = char != '"'
        elif char == '"':
            quoted = True
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            out.append("".join(current).strip())
            current = []
            continue
        current.append(char)
    out.append("".join(current).strip())
    return out


def lower_first(label: str) -> str:
    """``Feed on the way in`` → ``feed on the way in``, for the middle of a sentence."""
    return label[:1].lower() + label[1:] if label[1:2].islower() else label


def list_call_feeds(
    entry: Dict[str, Any],
    token: gedit_nc.Token,
    line: int,
    findings: Findings,
    counts: Counts,
) -> None:
    """Lists the feeds among the arguments of a cycle written as a call. Never scaled.

    A cycle written as a call (`CYCLE85(…)`) carries its technology as arguments, and the
    tokenizer keeps them in one piece (plan §7.5): none of them is a feed word, so nothing
    here could scale one by mistake. The database's ``params`` say which position is which;
    a feed among them is listed so that a run which changed every feed of the program does
    not leave the user believing this one changed too.
    """
    params = entry.get("params")
    if not isinstance(params, list) or not params:
        return
    code = entry.get("code") or token.address
    for position, (param, argument) in enumerate(zip(params, call_arguments(token.value_text)), 1):
        if not isinstance(param, dict) or argument == "":
            continue
        label = param.get("label")
        if not isinstance(label, str) or CALL_FEED_LABEL.search(label) is None:
            continue
        counts.cycle += 1
        findings.add(
            line,
            "info",
            "Argument %d of %s (%s, %s) is %s and is left unchanged: this run does not "
            "scale the arguments of a cycle." % (position, code, param.get("address"), lower_first(label), argument),
        )


#: `(line index, token start)` of a feed word -> `(code, line of the call, how)`, where
#: `how` is ``'in-force'`` for the feed a call runs with and ``'repeat'`` for a feed written
#: while a modal call repeats (:func:`lead_carriers`).
Carriers = Dict[Tuple[int, int], Tuple[str, int, str]]


def cycle_keyword(token: gedit_nc.Token, lookup: gedit_nc.FeedModeTracker) -> Optional[str]:
    """The name of a keyword that makes the call behind it modal, or ``None``.

    That is a keyword whose ``sets.cycle`` is ``'call-modal-next'``: `MCALL CYCLE840(…)`
    repeats the call after every following move, and `MCALL` on its own ends that. The
    database says which keyword it is, not this file.
    """
    if token.kind != "keyword":
        return None
    name = (token.address or token.text or "").upper()
    entry = lookup.entry(name)
    sets = entry.get("sets") if entry is not None else None
    if not isinstance(sets, dict) or sets.get("cycle") != "call-modal-next":
        return None
    return name


def lead_carriers(
    lines: Sequence[str],
    cp: gedit_nc.CompiledProfile,
    codes: Sequence[Dict[str, Any]],
    params: Params,
    preceding: Optional[Sequence[str]],
    base_line: int,
) -> Carriers:
    """The feed words a tapping cycle written as a call may take as its thread lead.

    A cycle written as a call stands in a block of its own (`CYCLE840(…)`), so it has no
    feed word of its own: a tapping cycle without a spindle encoder cuts with the feed **in
    force**, which then has to be the spindle speed times the pitch. Which calls may do that
    is the database's ``pitchFeed`` on the call's entry; which of them actually does depends
    on an argument whose meaning the database does not carry, so every such call protects
    the feed it runs with. Refusing a feed that turns out to be a plain feed costs one edit
    by hand; scaling a lead breaks the tap.

    Two kinds of feed word are answered:

    * the numeric feed word in force when such a call runs, wherever it was written — the
      line above, or ten lines above;
    * every numeric feed word written while such a call repeats as a modal call (written
      behind a keyword of :func:`cycle_keyword`, until that keyword stands on its own or
      another modal call replaces it), because each following move runs the cycle again
      with the feed in force then.

    The walk starts at the top of the document: the lines above a selection (``preceding``)
    are walked first, so a selection that starts inside a modal call, or below the feed a
    call runs with, is read as the whole document is (the re-review of the M8 fixes found the
    next tap's lead scaled with no finding when a selection started inside a modal
    `MCALL CYCLE840`). Only feed words of the selection itself are answered.

    A dwell block's `F` is a time and is never the feed in force. The walk only runs on a
    profile whose tokenizer writes calls at all (``syntax.calls``), so every other dialect
    pays nothing for it, and only on a program whose text names such a call somewhere: a
    call is written with its name, so a program without the name cannot have one, and a
    long program without a tapping call is not tokenized twice.
    """
    carriers: Carriers = {}
    if as_dict(cp.profile.get("syntax")).get("calls") is not True or not codes:
        return carriers
    names = {code.upper() for code in (entry.get("code") for entry in codes if entry.get("pitchFeed") is True) if isinstance(code, str) and code}
    above = list(preceding or ())
    walk = above + list(lines)
    text = "\n".join(walk).upper()
    if not any(name in text for name in names):
        return carriers
    lookup = gedit_nc.FeedModeTracker(codes)
    #: The feed word in force, `(index, start)`, or `None` when it is not a number. The
    #: index is the selection's: a line above it has a negative one and is never answered.
    in_force: Optional[Tuple[int, int]] = None
    #: `(keyword, code, line)` while a modal call that may take its lead from F repeats.
    modal: Optional[Tuple[str, str, int]] = None
    state: Optional[gedit_nc.LineState] = None
    for walked, line in enumerate(walk):
        index = walked - len(above)
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        entries = block_entries(tokens, lookup)
        if not any(entry.get("fNotFeed") is True for entry in entries):
            for token in tokens:
                if not feed_word(token, params):
                    continue
                in_force = (index, token.start) if token.value is not None else None
                if modal is not None and in_force is not None and index >= 0:
                    carriers.setdefault(in_force, (modal[1], modal[2], "repeat"))
        keywords = {name for name in (cycle_keyword(token, lookup) for token in tokens) if name}
        calls = [token for token in tokens if token.kind == "call" and token.address]
        for call in calls:
            entry = lookup.entry(call.address or "")
            pitch = entry is not None and entry.get("pitchFeed") is True
            code = (entry.get("code") if entry is not None else None) or call.address or ""
            if keywords:
                # A new modal call replaces the one before it, whether it taps or not.
                modal = (sorted(keywords)[0], code, base_line + index) if pitch else None
            if pitch and in_force is not None and in_force[0] >= 0:
                carriers.setdefault(in_force, (code, base_line + index, "in-force"))
        if not calls and modal is not None and modal[0] in keywords:
            modal = None
    return carriers


def report_carried(
    token: gedit_nc.Token,
    carried: Tuple[str, int, str],
    line: int,
    findings: Findings,
    counts: Counts,
) -> None:
    """A feed a tapping cycle written as a call may take as its lead: left and reported."""
    code, call_line, how = carried
    word = token.text.strip()
    counts.carried += 1
    if how == "repeat":
        where = "%s is written while %s (line %d) repeats after every move" % (word, code, call_line)
    elif call_line == line:
        where = "%s is the feed in force when %s runs in this block" % (word, code)
    else:
        where = "%s is the feed in force when %s runs on line %d" % (word, code, call_line)
    findings.add(
        line,
        "warning",
        "%s. A tapping cycle written as a call can take its thread lead from that feed (the "
        "feed is then the spindle speed times the pitch), so it is left as written: scaled, "
        "it would cut a different thread. Scale it by hand if the cycle takes its lead from "
        "its own arguments." % where,
    )


def other_feed_word(token: gedit_nc.Token, params: Params) -> bool:
    """True for a feed written under an address of its own: `FRC=0.1`, `FRCM=`, `FA=`.

    The feed address extended by letters and written with `=` is a feed, but not the feed
    word this run scales — a chamfer or corner feed, or the feed of a contour continuation.
    A number in the extension would be something else again, so only letters count.
    """
    if not assignment_word(token):
        return False
    address = (token.address or "").upper()
    feed = params.feed_address.upper()
    rest = address[len(feed) :] if address.startswith(feed) else ""
    return rest != "" and rest.isalpha() and address not in PER_REVOLUTION_ADDRESSES


def report_other_feed(
    token: gedit_nc.Token, line: int, findings: Findings, counts: Counts
) -> None:
    """A feed under an address of its own: reported, never scaled."""
    address = (token.address or "").upper() + "="
    counts.other += 1
    if address not in counts.other_addresses:
        counts.other_addresses.append(address)
    findings.add(
        line,
        "info",
        "%s is a feed under an address of its own, not the F word, so it is left as it is. "
        "Change it by hand if it should follow the other feeds." % token.text.strip(),
    )


def second_feed_word(
    token: gedit_nc.Token,
    tracker: gedit_nc.FeedModeTracker,
    entries: Sequence[Dict[str, Any]],
) -> bool:
    """True for an `E` word this run has to report (:data:`SECOND_FEED_ADDRESS`).

    Not in a block whose feed is a lead or a time, whose words are data, or where a code
    of the block or the cycle in force declares `E` as a parameter of its own (a dwell, a
    change of lead): there it is what that parameter says, and none of this run's business.
    """
    if token.kind != "word" or (token.address or "").upper() != SECOND_FEED_ADDRESS or assignment_word(token):
        return False
    if tracker.pitch_feed or tracker.pitch_feed_ambiguous or tracker.f_not_feed or tracker.data_code is not None:
        return False
    declaring = list(entries)
    cycle = tracker.entry(tracker.active_cycle) if tracker.active_cycle else None
    if cycle is not None:
        declaring.append(cycle)
    for entry in declaring:
        for param in entry.get("params") or []:
            if isinstance(param, dict) and str(param.get("address") or "").upper() == SECOND_FEED_ADDRESS:
                return False
    return True


def report_second_feed(token: gedit_nc.Token, line: int, findings: Findings, counts: Counts) -> None:
    """An `E` word no code of its block explains: reported, never scaled."""
    counts.other += 1
    if SECOND_FEED_ADDRESS not in counts.other_addresses:
        counts.other_addresses.append(SECOND_FEED_ADDRESS)
    findings.add(
        line,
        "info",
        "%s is left as written: this run scales only the F word, and an E word is a feed "
        "of its own along a contour definition on some controls, a thread lead or a dwell "
        "on others. Change it by hand if it should follow the other feeds." % token.text.strip(),
    )


def code_letters(codes: Sequence[Dict[str, Any]]) -> frozenset:
    """The address letters the database writes its moves with: `G` on the ISO dialects.

    Read off the database's ``motion`` group, whose codes are a letter and a number there
    (`G1`); a dialect whose moves are keywords (Klartext `L`) has none. A code under such a
    letter decides what the block's feed is, so one the database does not know is reported
    (:func:`unknown_code`).
    """
    out = set()
    for entry in codes or ():
        code = entry.get("code") if isinstance(entry, dict) else None
        if entry.get("group") == "motion" and isinstance(code, str) and re.match(r"^[A-Z]\d", code):
            out.add(code[0])
    return frozenset(out)


def unknown_code(
    tokens: Sequence[gedit_nc.Token], tracker: gedit_nc.FeedModeTracker, letters: frozenset
) -> Optional[str]:
    """The first code of the block under one of ``letters`` that the database does not know.

    A builder's cycle (a radial tapping cycle under a G number of its own) had its lead
    scaled like a feed: the database cannot say what the `F` of such a block is, so the run
    does not guess (R10).
    """
    if not letters:
        return None
    for token in tokens:
        if token.kind != "word" or not token.address or assignment_word(token):
            continue
        if token.address.upper() not in letters or not token.value_text:
            continue
        written = token.address + token.value_text
        if tracker.entry(written) is None:
            return written.upper()
    return None


def ambiguous_kind(tracker: gedit_nc.FeedModeTracker) -> str:
    """``'tapping'`` when the code in force taps on the other kind of machine, else ``'threading'``.

    The database says which (`tappingElsewhere`, 2026-09): Okuma `G84` is the tapping cycle
    of the machining centres and a LAP code on the lathe, and calling it a threading cycle
    sent the reader of a drilling program the wrong way (review finding NC1).
    """
    entry = tracker.entry(tracker.ambiguous_code) if tracker.ambiguous_code else None
    return "tapping" if entry is not None and entry.get("tappingElsewhere") is True else "threading"


def pitch_code_of(entries: Sequence[Dict[str, Any]], tracker: gedit_nc.FeedModeTracker) -> Optional[str]:
    """The code that makes this block's feed a thread lead: the block's own first.

    A one-block thread cycle (`G71` on a control where it threads) written while a modal
    thread pass is still in force (`G32`) carries its own lead, and a finding that named the
    modal code would send the reader to the wrong line.
    """
    for entry in entries:
        if entry.get("pitchFeed") is True:
            code = entry.get("code")
            if isinstance(code, str) and code != "":
                return code
    return tracker.active_cycle or tracker.pitch_mode


def lead_addresses(entry: Optional[Dict[str, Any]], feed_address: str) -> List[str]:
    """The words a thread code takes its lead from, where that is not the feed word.

    M9 (WP9.5a): the database declares a lead as a parameter whose unit is a feed per
    revolution. A code that declares one under other addresses only (Sinumerik `G33`,
    `G331`, `G332`: I, J or K) does not cut with its F, so its F is no pitch. Empty when the
    code declares its F a lead, declares no lead at all (a tap: its F **is** tied to the
    pitch), or is not known.
    """
    if not isinstance(entry, dict):
        return []
    leads = [
        param.get("address")
        for param in entry.get("params") or []
        if isinstance(param, dict) and param.get("unit") == "feedPerRev" and isinstance(param.get("address"), str)
    ]
    if any(address.upper() == feed_address.upper() for address in leads):
        return []
    return leads


def or_list(words: Sequence[str]) -> str:
    """``K`` / ``I or K`` / ``I, J or K``."""
    if len(words) <= 1:
        return words[0] if words else ""
    return "%s or %s" % (", ".join(words[:-1]), words[-1])


def declared_feed_class(
    token: gedit_nc.Token, entries: Sequence[Dict[str, Any]], in_force: Sequence[Dict[str, Any]]
) -> Optional[str]:
    """The class a code of the block, or else one in force, declares for this feed word."""
    address = (token.address or "").upper()
    for group in (entries, in_force):
        for entry in group:
            for param in entry.get("params") or []:
                if not isinstance(param, dict):
                    continue
                written = param.get("address")
                if isinstance(written, str) and written.upper() == address and isinstance(param.get("unit"), str):
                    return param["unit"]
    return None


def profile_range_code(entries: Sequence[Dict[str, Any]]) -> Optional[str]:
    """The code of a cycle in this block that runs a profile between a P and a Q block.

    The database says which (M9): a cycle entry that declares both ``P`` and ``Q`` as block
    numbers (``unit: 'count'``) and a feed — the Fanuc lathe roughing cycles `G71`-`G73`.
    """
    for entry in entries:
        if entry.get("group") != "cycle":
            continue
        units = {
            param.get("address"): param.get("unit")
            for param in entry.get("params") or []
            if isinstance(param, dict)
        }
        if units.get("P") == "count" and units.get("Q") == "count" and "F" in units:
            code = entry.get("code")
            if isinstance(code, str) and code != "":
                return code
    return None


def writes_address(tokens: Sequence[gedit_nc.Token], address: str) -> bool:
    """True when the block writes a word under ``address`` (a plain one, not ``P=…``)."""
    return any(
        token.kind == "word" and (token.address or "").upper() == address and not assignment_word(token)
        for token in tokens
    )


def codes_in_force(
    tracker: gedit_nc.FeedModeTracker, motion: Optional[Dict[str, Any]], entries: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """The entries in force that this block does not write: the move, the cycle, the mode.

    What a code declares for its parameters holds in the blocks it is in force for (M9,
    `gedit_nc.number_class_of`): the per-minute feed of an Okuma `G101` in the lines that
    follow it, the lead of a thread pass repeated with a new X.
    """
    out: List[Dict[str, Any]] = []
    for entry in (
        motion,
        tracker.entry(tracker.active_cycle) if tracker.active_cycle else None,
        tracker.entry(tracker.pitch_mode) if tracker.pitch_mode else None,
    ):
        if isinstance(entry, dict) and entry not in out and not any(entry is own for own in entries):
            out.append(entry)
    return out


def readings_text(readings: Sequence[Dict[str, Any]]) -> str:
    """``0.050 mm (increments of 0.001 mm) or 50 mm (as written)``, for a finding.

    One entry per preset the profile declares, the assumed default first, exactly as
    `gedit_nc.readings_of` hands them over. A preset that gives the word no value at all is
    named too: that is a difference like any other and must not be dropped in silence.
    """
    parts: List[str] = []
    for entry in readings:
        value = entry.get("value")
        label = entry.get("label") or entry.get("preset") or ""
        parts.append("%s (%s)" % (value if isinstance(value, str) else "no value", label))
    if len(parts) <= 1:
        return parts[0] if parts else ""
    return "%s or %s" % (", ".join(parts[:-1]), parts[-1])


def scale_token(
    token: gedit_nc.Token,
    tracker: gedit_nc.FeedModeTracker,
    params: Params,
    reading: Reading,
    entries: Sequence[Dict[str, Any]],
    line: int,
    findings: Findings,
    counts: Counts,
    unknown: Optional[str] = None,
    in_force: Sequence[Dict[str, Any]] = (),
    tokens: Sequence[gedit_nc.Token] = (),
) -> Optional[Tuple[int, int, str]]:
    """The edit this feed word needs, or ``None`` — with a finding when it is left alone.

    ``in_force`` are the database entries of the move, the cycle and the mode in force that
    this block does not write (:func:`codes_in_force`), ``tokens`` the block's own tokens.
    """
    word = token.text.strip()

    if token.value is None or token.value_text is None:
        # M13 review (NC-5): `F–200.` with a dash pasted for the minus sign is the address
        # alone, a character no control reads and a bare number: named as such, not as a
        # variable.
        unreadable = gedit_nc.unreadable_value(token, tokens)
        if unreadable is not None:
            counts.skip("unreadable")
            findings.add(line, "warning", "%s: %s, so it is not scaled." % unreadable)
            return None
        counts.skip("value")
        findings.add(line, "warning", "%s is not a plain number, so it is not scaled." % word)
        return None

    if tracker.pitch_feed:
        code = pitch_code_of(entries, tracker)
        elsewhere = lead_addresses(tracker.entry(code) if code else None, token.address or "")
        if elsewhere:
            # M9 (WP9.5a): a thread code whose lead is a word of its own (Sinumerik `G33`,
            # `G331`, `G332`: I, J or K). Its F is no pitch; the control does not cut the
            # thread with it, and it stays the feed in force afterwards. It is still left,
            # because nothing here can tell a thread written that way from one whose F the
            # dialect makes the lead; the finding says what it is and where to look.
            counts.skip("thread")
            findings.add(
                line,
                "warning",
                "%s is not scaled: %s takes its lead from %s, not from F, and does not cut "
                "with this F, which stays the feed in force for the blocks after the thread. "
                "Check those feeds by hand." % (word, code, or_list(elsewhere)),
            )
            return None
        counts.skip("pitch")
        findings.add(
            line,
            "warning",
            "%s is a thread pitch (%s), not a feed rate, so it is not scaled: scaling it "
            "would cut a different thread." % (word, code),
        )
        return None

    # The same code number is a threading cycle on another kind of machine, or in another
    # G-code system of this dialect
    # (`pitchFeedAmbiguous`: Fanuc G76 and G92 on the mill database). Nothing in the block
    # says which system it was written for, and a turning program opened with the mill
    # profile had its thread leads multiplied in silence (G8 M4). Refusing a real
    # fine-boring feed costs one manual edit; scaling a lead scraps the part. On the lathe
    # profile these codes carry `pitchFeed` outright and never reach this branch.
    if tracker.pitch_feed_ambiguous:
        counts.skip("ambiguous")
        findings.add(
            line,
            "warning",
            "%s is not scaled: %s is a %s cycle on another kind of machine or in "
            "another G-code system, where this F is the thread lead and not a feed rate. "
            "Check the block and scale it by hand if it really is a feed."
            % (word, tracker.ambiguous_code, ambiguous_kind(tracker)),
        )
        return None

    # A code the database does not know: what its F is cannot be told (R10).
    if unknown is not None:
        counts.skip("unknown")
        findings.add(
            line,
            "warning",
            "%s is not scaled: this block writes %s, which the code database does not know, "
            "so gEdit cannot tell whether its F is a feed rate or the lead of a builder's "
            "cycle. Check the block and scale it by hand if it really is a feed."
            % (word, unknown),
        )
        return None

    # M9 (WP9.5a, the last "Next up" item): a Fanuc lathe roughing cycle carries its feed
    # with its profile range, and the same code without one is an Okuma thread cycle whose
    # F is the lead. Only a machine confirms which dialect the program was written for.
    range_code = profile_range_code(entries)
    if range_code is not None and not reading.chosen and not writes_address(tokens, "P"):
        counts.skip("range")
        findings.add(
            line,
            "warning",
            "%s is not scaled: %s is a cycle that runs the profile between its P and Q "
            "blocks here, and this block names no P. On another control the same code is a "
            "thread cycle whose F is the lead, and no machine is chosen to confirm the "
            "dialect. Choose a machine for the document, or scale the block by hand if it "
            "really is a feed." % (word, range_code),
        )
        return None

    mode = feed_mode_of(token, tracker)
    # A code that declares the unit of its feed decides the mode (Okuma `G101`: per minute
    # whatever the feed mode in force says).
    if token.address not in PER_REVOLUTION_ADDRESSES:
        mode = MODE_OF_CLASS.get(declared_feed_class(token, entries, in_force) or "", mode)
    if not params.scales(mode):
        counts.skip("mode:" + mode)
        findings.add(line, "info", "%s is %s, so it is not scaled." % (word, reading.mode_text(mode)))
        return None

    value = exact_value(token.value)

    # What the limits compare (plan §7.15, AD-31). Only a run that set one needs it, and a
    # run that did not must not pay for working it out on every feed of a 100,000-line
    # program. `None` means the word has no settled value: it is still scaled — scaling is
    # unit-free — but no limit is applied to it and the run says so.
    number_class = None
    effective: Optional[Decimal] = None
    if params.has_limits:
        number_class = reading.number_class(token, tracker, entries, in_force)
        if number_class in CLASS_TEXT and number_class != params.limit_class:
            # M9: the limits are in one feed unit; a feed in another one is never compared
            # with them, whatever its number looks like.
            if params.has_filter:
                # A filter says which feeds to scale. One that cannot be compared with
                # this feed must not let it through: "only feeds below 0.3 mm/rev" scaling
                # every `G98 F200` of the program is the opposite of what was asked
                # (M9 review NC-F1). Left as written, and reported.
                counts.filter_unknown += 1
                findings.add(
                    line,
                    "warning",
                    "%s is not scaled: it is %s, and the %s %s for feeds %s, so whether "
                    "it passes the filter cannot be told. It is left as it is."
                    % (word, CLASS_TEXT[number_class], params.filter_text(),
                       params.filter_verb(), LIMIT_TEXT[params.limit_class]),
                )
                return None
            counts.other_unit += 1
            findings.add(
                line,
                "warning",
                "%s is scaled, but the feed limits were not applied to it: it is %s, and "
                "the limits are for feeds %s."
                % (word, CLASS_TEXT[number_class], LIMIT_TEXT[params.limit_class]),
            )
            number_class = None
        else:
            effective_text, readings = reading.resolve(token, number_class)
            if effective_text is not None:
                effective = Decimal(effective_text)
            else:
                if readings:
                    why = (
                        "what it is worth depends on the machine (%s), and none is chosen"
                        % readings_text(readings)
                    )
                else:
                    why = "gEdit cannot say what this feed is worth here"
                if params.has_filter:
                    # The same as a feed in another unit: a filter that cannot be
                    # compared leaves the feed alone (NC-F1).
                    counts.filter_unknown += 1
                    findings.add(
                        line,
                        "warning",
                        "%s is not scaled: %s, so the %s cannot be compared with it. It is "
                        "left as it is." % (word, why, params.filter_text()),
                    )
                    return None
                counts.unresolved += 1
                findings.add(
                    line,
                    "warning",
                    "%s is scaled, but the feed limits were not applied to it: %s." % (word, why),
                )

    if effective is not None and params.only_above is not None and effective <= params.only_above:
        counts.filtered += 1
        findings.add(
            line,
            "info",
            "%s is at or below the \"only feeds above\" value (%s), so it is left as it is."
            % (word, trim(params.only_above)),
        )
        return None
    if effective is not None and params.only_below is not None and effective >= params.only_below:
        counts.filtered += 1
        findings.add(
            line,
            "info",
            "%s is at or above the \"only feeds below\" value (%s), so it is left as it is."
            % (word, trim(params.only_below)),
        )
        return None

    scaled = gedit_nc.scale_decimal(token.value.raw, params.percent_text)

    # The zero guard comes **before** the limits. A limit bounds a scaled feed; it must
    # not invent one. `F0.` with a smallest feed of 700 used to come back as `F700.` and
    # a block that did not cut started cutting (G8 M4). The same for a negative value,
    # which is not a feed rate at all.
    if value <= 0:
        counts.nonpositive += 1
        what = (
            "a feed of zero, which is a block that does not cut"
            if value == 0
            else "negative, which is not a feed rate"
        )
        limit = (
            " The smallest feed (%s) is not applied to it either: a limit bounds a "
            "scaled feed, it does not invent one." % params.min_text
            if params.min_feed is not None
            else ""
        )
        findings.add(
            line,
            "warning",
            "%s is %s, so it is left exactly as written and the percentage is not "
            "applied.%s" % (word, what, limit),
        )
        return None

    fmt, whole = params.format_for(token)
    limited, limit_text, limit_label, rounded_back = clamp(
        scaled, effective, token, params, reading, number_class, fmt
    )
    new_text = gedit_nc.format_number(limited, token.value, fmt, params.decimal_point_significant)

    # A feed of zero is not a slow feed, it is a block that does not cut. The finding has
    # to name which of the two ways the run got there, because the fix is different: a
    # rounded-away value needs more decimal places, a zero limit needs a different limit.
    if exact_value(new_text) == 0:
        counts.zero += 1
        if limit_text is not None:
            why = "the %s is %s" % (limit_label, limit_text)
            advice = ""
        else:
            why = "%s %% of %s is %s, which written with %s is %s" % (
                trim(params.percent),
                token.value_text,
                trim(exact_value(limited)),
                result_precision(token, params),
                new_text,
            )
            advice = " Ask for more decimal places to scale it."
        findings.add(
            line,
            "warning",
            "%s is not scaled: %s, and a feed of zero is a block that does not cut, not "
            "a slow one.%s" % (word, why, advice),
        )
        return None

    if new_text == token.value_text:
        counts.same += 1
        # Rounding swallowed a real change. With the default `decimals = keep` that is
        # common on a lathe: F0.1 at 90 % is 0.09, which written with one decimal is
        # F0.1 again, and the block silently did not move (G8 M4). A count in the summary
        # is not something a user can find in a 20,000-line program; a row is.
        #
        # A value the run did not change at all — 100 %, or a feed already at the limit —
        # is not reported: nothing was asked of it and nothing happened.
        if exact_value(limited) != value:
            findings.add(
                line,
                "info",
                "%s stays as it is: %s %% of %s is %s, which written with %s is %s. "
                "Ask for more decimal places to scale it."
                % (
                    word,
                    trim(params.percent),
                    token.value_text,
                    trim(exact_value(limited)),
                    result_precision(token, params),
                    new_text,
                ),
            )
        return None

    if limit_text is not None:
        counts.clamped += 1
        # A clamp is a value, and a value has to be put back into the word in the form the
        # word is written in (`gedit_nc.write_back`): on a control that reads a point-less
        # word as a count of increments, a largest feed of 3000 mm/min is written `F3000000`
        # and not `F3000`. `rounded_back` says the word cannot hold the limit exactly.
        if same_number(new_text, limit_text):
            # The word is written in the values the limit is in, so the limit **is** the
            # text: `F700.` for a smallest feed of 700. Nothing to explain.
            written = ""
        elif rounded_back:
            written = ", written as %s, which is the nearest this word can hold" % new_text
        else:
            written = ", written as %s" % new_text
        findings.add(
            line,
            "info",
            "%s would become %s; the %s (%s) was used instead%s."
            % (word, write(scaled, token, params)[0], limit_label, limit_text, written),
        )
    else:
        # The value moved, but rounding to the written precision moved it further than
        # asked. See ROUNDING_NOTICE.
        exact = exact_value(limited)
        written = exact_value(new_text)
        if exact != 0 and abs(written - exact) > ROUNDING_NOTICE * abs(exact):
            counts.rounded += 1
            findings.add(
                line,
                "warning",
                "%s becomes %s, not %s: the result was rounded to %s. Ask for more "
                "decimal places if that is too coarse."
                % (
                    word,
                    new_text,
                    trim(exact),
                    result_precision(token, params),
                ),
            )
    if whole:
        counts.whole += 1
        counts.whole_line = counts.whole_line or line

    counts.changed += 1
    return (token.end - len(token.value_text), token.end, new_text)


def exact_value(number: Any) -> Decimal:
    """The exact value of a token's literal or of a written number (`gedit_nc.decimal_of`).

    Not ``Decimal(literal.raw)``: a Klartext decimal comma stays in ``raw`` (`F500,5`) so
    that the rewrite writes it back, and ``Decimal("500,5")`` raises. Only ever called with
    a number the tokenizer or ``format_number`` produced, so ``None`` cannot come back.
    """
    value = gedit_nc.decimal_of(number)
    if value is None:  # pragma: no cover - the tokenizer and format_number write numbers
        raise ValueError("not a number: %r" % (number,))
    return value


def decimals_text(count: int) -> str:
    """``no decimals`` / ``1 decimal`` / ``3 decimals``."""
    if count <= 0:
        return "no decimals"
    return "1 decimal" if count == 1 else "%d decimals" % count


def written_precision(token: gedit_nc.Token) -> str:
    """How this value was written, for a finding: ``no decimals``, ``1 decimal`` ..."""
    if token.value is None or not token.value.has_point:
        return "no decimals"
    return decimals_text(len(token.value.frac_part or ""))


def result_precision(token: gedit_nc.Token, params: Params) -> str:
    """How the **result** was written, which is what a finding has to name.

    With ``decimals = "keep"`` that is the precision the value already had; with a fixed
    count it is the run's, unless the count had to be dropped to keep a point-less value
    point-less (:meth:`Params.format_for`). Naming the wrong one turns an honest warning
    into a wrong explanation of a right number.
    """
    _, whole = params.format_for(token)
    if whole:
        return "no decimals"
    if params.decimals == "keep":
        return written_precision(token)
    return decimals_text(params.decimals)


def same_number(text: str, other: Optional[str]) -> bool:
    """Whether two written decimals are the same value: ``700.`` and ``700`` are."""
    left, right = gedit_nc.decimal_of(text), gedit_nc.decimal_of(other or "")
    if left is None or right is None:
        return False
    return left == right


def clamp(
    scaled: str,
    effective: Optional[Decimal],
    token: gedit_nc.Token,
    params: Params,
    reading: Reading,
    number_class: Optional[str],
    fmt: Dict[str, Any],
) -> Tuple[str, Optional[str], str, bool]:
    """``scaled`` inside the run's limits: the literal to write, and the limit applied.

    The limits are values a control reads — 3000 is 3000 mm/min — so the comparison happens
    there and the answer comes back into the word's own form through `gedit_nc.write_back`
    (plan §7.15, F48). ``effective`` is the word's value **before** scaling, or ``None``
    when it has none; with ``None`` no limit is applied at all, because a limit compared
    with a number whose unit nobody knows is a guess.

    The fourth element says the word cannot hold the limit exactly and was rounded.
    """
    if effective is None or (params.min_feed is None and params.max_feed is None):
        return scaled, None, "", False
    value = Decimal(gedit_nc.scale_decimal(format(effective, "f"), params.percent_text))
    if params.min_feed is not None and value < params.min_feed:
        wanted, label = params.min_text, "smallest feed"
    elif params.max_feed is not None and value > params.max_feed:
        wanted, label = params.max_text, "largest feed"
    else:
        return scaled, None, "", False
    text, rounded, error = reading.write_back(wanted or "0", token, number_class, fmt)
    if text is None or error is not None:  # pragma: no cover - a value resolved, so it writes
        return scaled, None, "", False
    # `write_back` writes a Klartext decimal comma back (`F1500,`), and the caller hands this
    # text to `format_number`, which reads a decimal with a point and writes the comma
    # itself from the original literal.
    return text.replace(",", "."), wanted, label, rounded


def write(value: str, token: gedit_nc.Token, params: Params) -> Tuple[str, bool]:
    """A decimal string written the way the profile and the original literal ask for.

    The second half of the answer says whether a fixed decimal count had to be dropped to
    keep a point-less value point-less.
    """
    fmt, whole = params.format_for(token)
    return gedit_nc.format_number(value, token.value, fmt, params.decimal_point_significant), whole


def inherited_text(tracker: gedit_nc.FeedModeTracker, reading: Reading) -> Optional[str]:
    """What a primed run starts with, or ``None`` when that is the top-of-program state.

    Only the parts that change what this script does are named: the feed mode decides
    whether a value is scaled at all, and an active cycle decides whether its ``F`` is a
    pitch or a lead. A run that inherits nothing says nothing.
    """
    parts: List[str] = []
    if tracker.feed_mode != PER_MINUTE:
        parts.append(reading.mode_text(tracker.feed_mode))
    if tracker.pitch_feed and tracker.active_cycle is not None:
        parts.append("the thread-pitch cycle %s" % tracker.active_cycle)
    elif tracker.pitch_feed_ambiguous and tracker.ambiguous_code is not None:
        parts.append(
            "%s, which is a %s cycle on another kind of machine or in another "
            "G-code system" % (tracker.ambiguous_code, ambiguous_kind(tracker))
        )
    elif tracker.active_cycle is not None:
        parts.append("the cycle %s" % tracker.active_cycle)
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else "%s and %s" % (parts[0], parts[1])


def run(
    lines: Sequence[str],
    cp: gedit_nc.CompiledProfile,
    codes: Sequence[Dict[str, Any]],
    params: Params,
    reading: Reading,
    base_line: int,
    fragment: bool = False,
    preceding: Optional[Sequence[str]] = None,
) -> Tuple[str, Counts, Findings]:
    """Walks the program once and returns the new text, the counts and the findings.

    ``fragment`` says that these lines are a **selection**, not the whole program. Feed
    modes and cycles are modal: a ``G95`` or a ``G84`` tapping cycle set further up is
    still in force inside the selection.

    ``preceding`` are the document lines above it (``gedit_nc.preceding_lines`` of the
    context). When they are there the run is **primed** with them, so the selection is
    read in the state it is really written in, and the first finding names what was
    inherited when that changes what this script does. When they are not — an older
    runner, or text too large for the context to carry — the run starts from the
    top-of-program state instead, a thread pitch it would have recognised in a whole
    document is then scaled like an ordinary feed (G8 M4 finding 6), and the run says so,
    loudly, at its first line.
    """
    tracker = gedit_nc.FeedModeTracker(codes)
    reading.sets_feed_code(power_on_state(tracker, cp))
    findings = Findings()
    counts = Counts()
    out: List[str] = []
    state: Optional[gedit_nc.LineState] = None
    cycle: Optional[Dict[str, Any]] = None
    #: The motion code in force (M9): its database entry, or None while none was written.
    motion: Optional[Dict[str, Any]] = None

    primed = fragment and bool(preceding)
    if primed:
        state = gedit_nc.prime_tracker(tracker, preceding or (), cp, lines[0] if lines else None)
        # `prime_tracker` walks the lines above the selection for the modal state, but it
        # answers about feeds and cycles, not about millimetres and inches, nor about which
        # code put the feed unit in force. The run reads them once more for their
        # `sets.units` and `sets.feedUnit`, so a `G20` or a `G96` above the selection is in
        # force inside it as well.
        above_state: Optional[gedit_nc.LineState] = None
        for above in preceding or ():
            above_tokens, above_state = gedit_nc.tokenize_line(above, cp, above_state)
            above_entries = block_entries(above_tokens, tracker)
            reading.sets_units(above_entries)
            reading.sets_feed_code(above_entries)
            motion = last_motion(above_entries, motion)
        # A selection that starts inside the parameter block of a Klartext cycle: the
        # `CYCL DEF` keyword stands above it, so `cycle_definition` below never sees it
        # and the cycle's Q feeds would go unlisted. The tracker knows which cycle is
        # open; take the entry from there instead.
        if state is not None and state.continuation and tracker.active_cycle is not None:
            entry = tracker.entry(tracker.active_cycle)
            if entry is not None and entry.get("params"):
                cycle = entry

    if not codes:
        findings.add(
            base_line,
            "warning",
            "This run had no code database, so tapping and threading blocks could not be "
            "recognised: check their feeds by hand.",
        )
    if primed:
        inherited = inherited_text(tracker, reading)
        if inherited is not None:
            findings.add(
                base_line,
                "info",
                "This run saw only the selection, from line %d, but the %d lines above it "
                "were read for the modal state: %s is in force here."
                % (base_line, len(preceding or ()), inherited),
            )
    elif fragment:
        findings.add(
            base_line,
            "warning",
            "This run saw only the selection, from line %d, so the feed mode and any "
            "cycle set above it are unknown: a thread pitch in a tapping or threading "
            "cycle that starts higher up cannot be recognised here and may have been "
            "scaled. Run the command on the whole program, or check these blocks by hand."
            % base_line,
        )

    # The feeds a tapping cycle written as a call may take as its lead. They can stand many
    # lines above the call, so they are found before the first word is scaled.
    carriers = lead_carriers(lines, cp, codes, params, preceding if primed else None, base_line)
    letters = code_letters(codes)

    for index, line in enumerate(lines):
        # A line continues the block above when that one ended in a marker (Klartext `~`)
        # or when it starts with one itself (Okuma `$`): the lead on the `$` line of a `G71`
        # block is still the lead of that thread cycle (G10 M8 NC finding 9).
        head = gedit_nc.continues_block(line, cp)
        continued = (state.continuation if state is not None else False) or head
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        tracker.update(tokens, continued=head)
        number = base_line + index

        # The block's codes: the one that makes a feed a thread lead is named by the
        # finding, and a run that compares values needs them for the number rules of §7.15
        # (a cycle parameter's declared unit, an `fNotFeed` block) and for `G20` / `G21`.
        entries = block_entries(tokens, tracker)
        reading.sets_feed_code(entries)
        if params.has_limits:
            reading.sets_units(entries)
        # The move in force before this block, and the one this block writes (M9): what a
        # move declares for its feed holds in the blocks it is in force for.
        motion = last_motion(entries, motion)
        in_force = codes_in_force(tracker, motion, entries)

        # A cycle definition runs from its keyword to the end of its continuation lines.
        if not continued:
            cycle = cycle_definition(tokens, tracker)
        if cycle is not None:
            list_cycle_feeds(cycle, tokens, number, findings, counts)

        unknown = unknown_code(tokens, tracker, letters)
        edits: List[Tuple[int, int, str]] = []
        for token in tokens:
            if other_feed_word(token, params):
                report_other_feed(token, number, findings, counts)
                continue
            if second_feed_word(token, tracker, entries):
                report_second_feed(token, number, findings, counts)
                continue
            if not feed_word(token, params):
                continue
            if tracker.f_not_feed:
                # A dwell block (`fNotFeed`: Okuma `G04 F2`, Sinumerik `G4 F2`): its F is a
                # time. It is not a feed rate, so it is not scaled and not counted as one,
                # and it leaves the feed in force as it was (AD-19 rule 6).
                counts.dwell += 1
                continue
            if tracker.data_code is not None:
                # `wordsAreData` (`G65 P9810 F3000.`, a `G10` block): an argument of the call
                # or a value the block writes somewhere, not a feed of this program.
                counts.data += 1
                findings.add(
                    number,
                    "info",
                    "%s is an argument or a data value of %s, not a feed rate of this "
                    "program, so it is left as written." % (token.text.strip(), tracker.data_code),
                )
                continue
            counts.total += 1
            carried = carriers.get((index, token.start))
            if carried is not None:
                report_carried(token, carried, number, findings, counts)
                continue
            edit = scale_token(
                token, tracker, params, reading, entries, number, findings, counts, unknown, in_force, tokens
            )
            if edit is not None:
                edits.append(edit)

        # A cycle written as a call: its feeds are arguments, listed and never scaled.
        for token in tokens:
            if token.kind != "call" or not token.address:
                continue
            entry = tracker.entry(token.address)
            if entry is None:
                continue
            list_call_feeds(entry, token, number, findings, counts)

        out.append(apply_edits(line, edits) if edits else line)

    if counts.whole:
        findings.add(
            counts.whole_line,
            "info",
            "%s without a decimal point: rounded whole rather than to %d decimals, "
            "because in this dialect the point changes the value."
            % (count_text(counts.whole, "feed rate"), params.decimals),
        )

    return "\n".join(out), counts, findings


def summary(counts: Counts, findings: Findings, params: Params, reading: Reading) -> str:
    """The one-line message the status bar shows."""
    percent = trim(params.percent)
    if counts.total == 0:
        base = "No feed rates found"
    elif counts.changed == 0:
        base = "No feed rate was changed"
    elif counts.changed == counts.total:
        base = "Scaled %s to %s %%" % (count_text(counts.changed, "feed rate"), percent)
    else:
        base = "Scaled %s of %s feed rates to %s %%" % (
            "{:,}".format(counts.changed),
            "{:,}".format(counts.total),
            percent,
        )

    parts: List[str] = []
    for reason, text in (
        ("pitch", "left as a thread pitch"),
        ("thread", "left in a thread block whose lead is written elsewhere"),
        ("range", "left because a profile-range cycle names no range and no machine confirms the dialect"),
        ("ambiguous", "left because the code means a threading cycle somewhere else"),
        ("unknown", "left under a code the database does not know"),
        ("unreadable", "left because the value cannot be read"),
        ("value", "left as a variable or an expression"),
        ("mode", "left in another feed mode"),
    ):
        count = counts.skipped_for(reason)
        if count:
            parts.append("%s %s" % ("{:,}".format(count), text))
    if counts.zero:
        parts.append("%s not scaled (would become zero)" % "{:,}".format(counts.zero))
    if counts.nonpositive:
        parts.append("%s left as written (zero or negative)" % "{:,}".format(counts.nonpositive))
    if counts.filtered:
        parts.append("%s left by the value filter" % "{:,}".format(counts.filtered))
    if counts.filter_unknown:
        parts.append(
            "%s left because the value filter cannot be compared with %s"
            % ("{:,}".format(counts.filter_unknown), "it" if counts.filter_unknown == 1 else "them")
        )
    if counts.same:
        parts.append("%s already written that way" % "{:,}".format(counts.same))
    if counts.clamped:
        parts.append("%s clamped to a limit" % "{:,}".format(counts.clamped))
    if counts.rounded:
        parts.append("%s rounded to the decimals it was written with" % "{:,}".format(counts.rounded))
    if counts.whole:
        parts.append("%s kept whole" % "{:,}".format(counts.whole))
    if counts.cycle:
        parts.append("%s left unchanged" % count_text(counts.cycle, "cycle feed"))
    if counts.carried:
        parts.append(
            "%s left as the possible lead of a tapping cycle" % "{:,}".format(counts.carried)
        )
    if counts.other:
        parts.append(
            "%s left as written (%s)"
            % (
                count_text(counts.other, "feed under an address of its own", "feeds under addresses of their own"),
                ", ".join(counts.other_addresses),
            )
        )
    if counts.dwell:
        parts.append("%s left as written" % count_text(counts.dwell, "dwell time"))
    if counts.data:
        parts.append("%s left as written" % count_text(counts.data, "argument or data word", "arguments and data words"))
    if counts.unresolved:
        parts.append(
            "%s scaled without a limit check" % "{:,}".format(counts.unresolved)
        )
    if counts.other_unit:
        parts.append(
            "%s scaled without the limits, which are for feeds %s"
            % ("{:,}".format(counts.other_unit), LIMIT_TEXT[params.limit_class])
        )

    # Which machine the run read the program with. Scaling is unit-free, so this changes no
    # number; the limits are not, so the run has to say whose reading of a written number it
    # compared them with (plan §7.15, AD-31). A run that found no feed at all read nothing,
    # and says nothing.
    message = base + ("; " + ", ".join(parts) if parts else "") + "."
    if counts.total:
        message += " " + reading.note()
    if findings.dropped:
        message += " %s further notes are not listed." % "{:,}".format(findings.dropped)
    return message


def main() -> int:
    """Reads the context and stdin, writes the envelope to stdout, and answers the exit code."""
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()

    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print(
            "Scale feed rates needs a dialect profile. Run it from gEdit, which puts the "
            "profile into the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("Scale feed rates cannot use this profile: %s" % err, file=sys.stderr)
        return 1
    try:
        params = Params(as_dict(context.get("params")), profile)
    except (ValueError, ArithmeticError) as err:
        print("Scale feed rates: %s" % err, file=sys.stderr)
        return 1

    codes = context.get("codes") if isinstance(context.get("codes"), list) else []
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    base_line = start if isinstance(start, int) and start >= 1 else 1
    # A selection is a fragment of a modal language; see `run`. A run that starts at
    # line 1 is the program from the top even when the user selected it by hand.
    fragment = scope.get("scope") == "selection" and base_line > 1
    # The lines above the selection, when the context carries them and they are all of
    # them; `gedit_nc.preceding_lines` is where that "all of them" is decided.
    preceding = gedit_nc.preceding_lines(context)

    reading = Reading(context, profile, codes)
    text, counts, findings = run(lines, cp, codes, params, reading, base_line, fragment, preceding)
    gedit_nc.envelope(text, summary(counts, findings, params, reading), findings.in_line_order())
    return 0


if __name__ == "__main__":
    sys.exit(main())

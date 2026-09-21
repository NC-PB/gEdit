#!/usr/bin/env python3
# /// gedit
# name = "Scale spindle speeds"
# description = "Multiplies S values by a percentage. Surface speeds, speed limits and speeds written as variables are left alone and reported."
# input = "selection-or-document"
# output = "replace"
# envelope = true
#
# [[params]]
# id = "percent"
# type = "number"
# label = "Percentage"
# help = "100 % leaves every speed as it is."
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
# help = "A spindle speed is a whole number of revolutions on nearly every control."
# default = "0"
# choices = [
#   { label = "0", value = "0" },
#   { label = "1", value = "1" },
#   { label = "2", value = "2" },
#   { label = "As written", value = "keep" }
# ]
#
# [[params]]
# id = "minSpeed"
# type = "number"
# label = "Smallest speed"
# help = "A scaled speed below this is raised to it. Empty means no limit."
# required = false
# min = 0
#
# [[params]]
# id = "maxSpeed"
# type = "number"
# label = "Largest speed"
# help = "A scaled speed above this is lowered to it. Empty means no limit."
# required = false
# min = 0
#
# [[params]]
# id = "onlyAbove"
# type = "number"
# label = "Only speeds above"
# help = "Speeds at or below this value are left as they are."
# required = false
#
# [[params]]
# id = "onlyBelow"
# type = "number"
# label = "Only speeds below"
# help = "Speeds at or above this value are left as they are."
# required = false
#
# [[params]]
# id = "surfaceSpeed"
# type = "bool"
# label = "Also scale constant surface speeds"
# help = "Under G96 the S word is a surface speed, not revolutions per minute."
# default = false
#
# [[params]]
# id = "speedLimits"
# type = "bool"
# label = "Also scale spindle speed limits"
# help = "The S of a G50 or G92 block clamps the top speed for constant surface speed."
# default = false
# ///
"""Scale spindle speeds (plan section 5, WP4.7; `nc-transformations.md`, "Scale spindle speeds").

Multiplies the spindle speed of every block by a percentage and hands the program back
through the `envelope` output, together with a summary and one finding per value it
refused to touch or wants looked at.

What it never does, and why
---------------------------
Everything is decided on the **tokens** of the block and on the profile's own code
database, never on a regex over the raw line, so an `S` inside a comment or a string is
not a speed and is never rewritten.

Constant surface speed
    between `G96` and `G97` the `S` word is a surface speed in metres or feet per minute,
    not revolutions. Scaling it is a different operation from scaling rpm, so it is
    skipped and listed unless the run asks for it.
Speed limits
    `G50 S` (and `G92 S` in the other G-code systems) clamps the top spindle speed for
    constant surface speed. It is a machine limit, not a cutting speed. Same rule, and
    the same pair of codes, as `tool_list.py`'s feed and speed ranges.
Variables and expressions
    `S#500`, `SQ5`, or an `S` with no value: there is no number to scale.
Tapping and threading
    the speed **is** scaled, and the block is reported as a warning: in tapping the feed
    follows from the speed and the thread pitch, and `scale_feed.py` will not touch that
    feed, so the pair has to be looked at by hand. Which codes carry a pitch comes from
    the code database's `pitchFeed` flag, not from a table in this file. The speed of a
    tapping block is usually set **before** it (`M29 S500` then `G84 … F625.`), so a
    thread block that starts while a scaled speed is in force is reported as well — the
    warning has to reach the block whose thread would come out wrong, not only the line
    that happens to carry the `S`.
Klartext
    the speed sits in the `TOOL CALL` line (`TOOL CALL 5 Z S5000`), which is an ordinary
    `S` word to the tokenizer and is scaled like any other.
Selections
    `G96` / `G97` and the cycles are modal, so a run over a selection starts in the middle
    of a sentence. When the context carries `input.precedingLines` the run is **primed**
    from the lines above it (`gedit_nc.prime_tracker`), so a `G96` that starts higher up is
    in force here as well; when it does not, the run starts from the top of a program and
    says so at its first line.

Numbers
-------
Arithmetic is `decimal.Decimal` through `gedit_nc.scale_decimal`, and the result is
written by `gedit_nc.format_number`. Speeds are whole numbers by default, because that is
what a control accepts; "As written" keeps the precision the value already had. Rounding
is half away from zero and nothing here ever sees a float.

Two rules protect the value itself:

* Where the profile says the decimal point is **significant** (`S100` is not `S100.`), a
  value written without a point is never given one, so asking for decimals rounds those
  values whole instead of rewriting what the control reads.
* A value that would round to **zero** is left as it was and reported. `S0` is not a slow
  spindle, it is a spindle that does not turn.
* A value that is **already** zero or negative is left exactly as written, before the
  limits are even looked at. A limit bounds a scaled speed; it must not invent one.
  `S0` with a smallest speed of 500 must not come back as `S500` and start a spindle the
  program had stopped.

Everything outside the values it scales — line endings, encoding, the trailing newline,
spacing, block numbers, skip marks and comments — is handed back byte for byte, because
the only edits made are the value spans of spindle word tokens.

`scale_feed.py` is the same script for `F` words, and deliberately stands on its own: a
bundled script is one file, so the two share `gedit_nc` and nothing else.
"""

from __future__ import annotations

import sys
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc

#: The ISO codes that write a spindle speed **limit** rather than a speed. A dialect
#: without G words never matches them. `tool_list.py` (WP4.6) spells the rule the same way.
SPEED_LIMIT_CODES = ("G50", "G92")

#: At most this many findings; the rest are counted in the message. A 100k-line program
#: under G96 would otherwise hand the results panel tens of thousands of rows.
MAX_FINDINGS = 200

#: How far the written value may sit from the exact scaled one before the run says so, as
#: a fraction of the exact value. The same rule, and the same reason, as `scale_feed.py`:
#: a speed asked to move by 10 % that rounding moves by 50 % is a number the user has to
#: be told about. It almost never fires on the default whole-number output, where speeds
#: are in the hundreds or thousands; it is "As written" on a small value that needs it.
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


def decimals_param(value: Any, default: Any) -> Any:
    """``'keep'`` or a decimal count. Anything else is an error."""
    if value is None or value == "":
        return default
    if value == "keep":
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


def count_text(count: int, singular: str, plural: Optional[str] = None) -> str:
    """``1 spindle speed`` / ``4 spindle speeds``."""
    return "%s %s" % ("{:,}".format(count), singular if count == 1 else (plural or singular + "s"))


class Params:
    """The run's parameters, turned into exact decimals and the profile's number format."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        self.percent_text = decimal_param(values, "percent", "Percentage", "100")
        self.percent = Decimal(self.percent_text)
        if self.percent <= 0:
            raise ValueError("Percentage must be greater than zero.")

        self.min_text = decimal_param(values, "minSpeed", "Smallest speed")
        self.max_text = decimal_param(values, "maxSpeed", "Largest speed")
        self.min_speed = None if self.min_text is None else Decimal(self.min_text)
        self.max_speed = None if self.max_text is None else Decimal(self.max_text)
        if self.min_speed is not None and self.max_speed is not None and self.min_speed > self.max_speed:
            raise ValueError("The smallest speed is larger than the largest speed.")

        above = decimal_param(values, "onlyAbove", "Only speeds above")
        below = decimal_param(values, "onlyBelow", "Only speeds below")
        self.only_above = None if above is None else Decimal(above)
        self.only_below = None if below is None else Decimal(below)

        self.fmt = gedit_nc.number_format_of(profile)
        # A spindle speed is a whole number of revolutions unless the run says otherwise.
        self.decimals = decimals_param(values.get("decimals"), 0)
        if self.decimals != "keep":
            self.fmt["decimals"] = self.decimals

        syntax = as_dict(profile.get("syntax"))
        self.decimal_point_significant = syntax.get("decimalPointSignificant") is True
        #: A fixed decimal count would give a point-less value a point; see the docstring.
        self.whole_fmt = dict(self.fmt)
        self.whole_fmt["decimals"] = 0

        addresses = as_dict(profile.get("addresses"))
        spindle = addresses.get("spindle")
        self.spindle_address = spindle if isinstance(spindle, str) and spindle != "" else "S"

        self.surface_speed = values.get("surfaceSpeed") is True
        self.speed_limits = values.get("speedLimits") is True

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
        #: Spindle words seen, whatever happened to them.
        self.total = 0
        self.changed = 0
        #: Scaled, but written exactly as it already stood.
        self.same = 0
        #: Left out by "only above" / "only below".
        self.filtered = 0
        self.clamped = 0
        #: Thread blocks to look at: a speed scaled inside one, or one that starts while a
        #: scaled speed is in force.
        self.thread = 0
        #: Written further from the exact scaled value than ROUNDING_NOTICE allows.
        self.rounded = 0
        #: Rounded whole because the dialect's decimal point is significant.
        self.whole = 0
        self.whole_line = 0
        #: Left alone because the run would have written a zero speed.
        self.zero = 0
        #: The value was already zero or negative: a limit bounds a speed, it does not
        #: invent one, so neither the scaling nor the limits touch such a block.
        self.nonpositive = 0
        self.skipped: Dict[str, int] = {}

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1


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


def speed_word(token: gedit_nc.Token, params: Params) -> bool:
    """True when this token is a spindle speed word of the active dialect."""
    return token.kind == "word" and token.address == params.spindle_address


def limit_code_of(tokens: Sequence[gedit_nc.Token]) -> Optional[str]:
    """The `G50` / `G92` of this block, which makes its `S` a limit — or ``None``."""
    for token in tokens:
        if token.kind != "word" or token.address is None:
            continue
        code = gedit_nc.normalize_code(token.address + (token.value_text or ""))
        if code in SPEED_LIMIT_CODES:
            return code
    return None


def scale_token(
    token: gedit_nc.Token,
    tracker: gedit_nc.FeedModeTracker,
    limit_code: Optional[str],
    params: Params,
    line: int,
    findings: Findings,
    counts: Counts,
) -> Optional[Tuple[int, int, str]]:
    """The edit this spindle word needs, or ``None`` — with a finding when it is left alone."""
    word = token.text.strip()

    if token.value is None or token.value_text is None:
        counts.skip("value")
        findings.add(line, "warning", "%s is not a plain number, so it is not scaled." % word)
        return None

    if limit_code is not None and not params.speed_limits:
        counts.skip("limit")
        findings.add(
            line,
            "info",
            "%s is a spindle speed limit (%s), so it is not scaled." % (word, limit_code),
        )
        return None

    if limit_code is None and tracker.css and not params.surface_speed:
        counts.skip("css")
        findings.add(line, "info", "%s is a surface speed (G96), so it is not scaled." % word)
        return None

    value = Decimal(token.value.raw)
    if params.only_above is not None and value <= params.only_above:
        counts.filtered += 1
        findings.add(
            line,
            "info",
            "%s is at or below the \"only speeds above\" value (%s), so it is left as it is."
            % (word, trim(params.only_above)),
        )
        return None
    if params.only_below is not None and value >= params.only_below:
        counts.filtered += 1
        findings.add(
            line,
            "info",
            "%s is at or above the \"only speeds below\" value (%s), so it is left as it is."
            % (word, trim(params.only_below)),
        )
        return None

    scaled = gedit_nc.scale_decimal(token.value.raw, params.percent_text)

    # The zero/negative guard comes **before** the limits. A limit bounds a scaled speed;
    # it must not invent one. `S0` with a smallest speed of 500 came back as `S500` and a
    # spindle the program had stopped started turning — the same defect G8 M4 finding 11
    # fixed in `scale_feed.py`, which was left standing here.
    if value <= 0:
        counts.nonpositive += 1
        what = (
            "a speed of zero, which is a spindle that does not turn"
            if value == 0
            else "negative, which is not a spindle speed"
        )
        limit = (
            " The smallest speed (%s) is not applied to it either: a limit bounds a "
            "scaled speed, it does not invent one." % params.min_text
            if params.min_speed is not None
            else ""
        )
        findings.add(
            line,
            "warning",
            "%s is %s, so it is left exactly as written and the percentage is not "
            "applied.%s" % (word, what, limit),
        )
        return None

    limited, limit_text, limit_label = clamp(scaled, params)
    new_text, whole = write(limited, token, params)

    # A spindle speed of zero is not a slow spindle, it is a spindle that does not turn.
    # The finding names which of the two ways the run got there: a value rounded away
    # needs more decimal places, a zero limit needs a different limit.
    if Decimal(new_text) == 0:
        counts.zero += 1
        if limit_text is not None:
            why = "the %s is %s" % (limit_label, limit_text)
            advice = ""
        else:
            why = "%s %% of %s is %s, which written with %s is %s" % (
                trim(params.percent),
                token.value_text,
                trim(Decimal(limited)),
                result_precision(token, params),
                new_text,
            )
            advice = " Ask for more decimal places to scale it."
        findings.add(
            line,
            "warning",
            "%s is not scaled: %s, and a speed of zero is a spindle that does not turn, "
            "not a slow one.%s" % (word, why, advice),
        )
        return None

    if new_text == token.value_text:
        counts.same += 1
        # Rounding swallowed a real change, and a count in the summary is not something a
        # user can find in a 20,000-line program; a row is. A value the run did not change
        # at all — 100 %, or a speed already at the limit — is not reported.
        if Decimal(limited) != value:
            findings.add(
                line,
                "info",
                "%s stays as it is: %s %% of %s is %s, which written with %s is %s. "
                "Ask for more decimal places to scale it."
                % (
                    word,
                    trim(params.percent),
                    token.value_text,
                    trim(Decimal(limited)),
                    result_precision(token, params),
                    new_text,
                ),
            )
        return None

    if limit_text is not None:
        counts.clamped += 1
        findings.add(
            line,
            "info",
            "%s would become %s; the %s (%s) was used instead."
            % (word, write(scaled, token, params)[0], limit_label, limit_text),
        )
    else:
        # The value moved, but rounding moved it further than was asked for.
        exact = Decimal(limited)
        written = Decimal(new_text)
        if exact != 0 and abs(written - exact) > ROUNDING_NOTICE * abs(exact):
            counts.rounded += 1
            findings.add(
                line,
                "warning",
                "%s becomes %s, not %s: the result was rounded to %s. Ask for more "
                "decimal places if that is too coarse."
                % (word, new_text, trim(exact), result_precision(token, params)),
            )
    if whole:
        counts.whole += 1
        counts.whole_line = counts.whole_line or line

    if tracker.pitch_feed:
        counts.thread += 1
        findings.add(
            line,
            "warning",
            "%s was scaled in a thread block (%s): the feed follows from the speed and the "
            "pitch, so check this block by hand." % (word, tracker.active_cycle),
        )
    elif tracker.pitch_feed_ambiguous:
        # The block's code is a threading cycle in another G-code system of this dialect
        # (`pitchFeedAmbiguous`: Fanuc G76 and G92). `scale_feed.py` refuses such a block's
        # F outright; here the S really is a spindle speed in either reading, so it is
        # scaled — but if this is the lathe reading, it is the speed a thread is cut at
        # and the pair has to be looked at together.
        counts.thread += 1
        findings.add(
            line,
            "warning",
            "%s was scaled in a %s block: that code is a threading cycle in another "
            "G-code system of this dialect, where this block cuts a thread at this speed "
            "and its F is the thread lead. Check the block by hand."
            % (word, tracker.ambiguous_code),
        )

    counts.changed += 1
    return (token.end - len(token.value_text), token.end, new_text)


def decimals_text(count: int) -> str:
    """``no decimals`` / ``1 decimal`` / ``3 decimals``."""
    if count <= 0:
        return "no decimals"
    return "1 decimal" if count == 1 else "%d decimals" % count


def written_precision(token: gedit_nc.Token) -> str:
    """How this value was written: ``no decimals``, ``1 decimal`` ..."""
    if token.value is None or not token.value.has_point:
        return "no decimals"
    return decimals_text(len(token.value.frac_part or ""))


def result_precision(token: gedit_nc.Token, params: Params) -> str:
    """How the **result** was written, which is what a finding has to name.

    With ``decimals = "keep"`` that is the precision the value already had; otherwise it is
    the run's count, unless the count had to be dropped to keep a point-less value
    point-less (:meth:`Params.format_for`). Naming the wrong one turns an honest warning
    into a wrong explanation of a right number.
    """
    _, whole = params.format_for(token)
    if whole:
        return "no decimals"
    if params.decimals == "keep":
        return written_precision(token)
    return decimals_text(params.decimals)


def clamp(scaled: str, params: Params) -> Tuple[str, Optional[str], str]:
    """``scaled`` inside the run's limits, plus the limit that was applied."""
    value = Decimal(scaled)
    if params.min_speed is not None and value < params.min_speed:
        return params.min_text, params.min_text, "smallest speed"
    if params.max_speed is not None and value > params.max_speed:
        return params.max_text, params.max_text, "largest speed"
    return scaled, None, ""


def write(value: str, token: gedit_nc.Token, params: Params) -> Tuple[str, bool]:
    """A decimal string written the way the profile and the original literal ask for.

    The second half of the answer says whether a fixed decimal count had to be dropped to
    keep a point-less value point-less.
    """
    fmt, whole = params.format_for(token)
    return gedit_nc.format_number(value, token.value, fmt, params.decimal_point_significant), whole


def inherited_text(tracker: gedit_nc.FeedModeTracker) -> Optional[str]:
    """What a primed run starts with, or ``None`` when that is the top-of-program state.

    Only the parts that change what this script does are named: constant surface speed
    decides whether an ``S`` is scaled at all, and a thread cycle decides whether the block
    has to be looked at by hand.
    """
    parts: List[str] = []
    if tracker.css:
        parts.append("constant surface speed (G96)")
    if tracker.pitch_feed and tracker.active_cycle is not None:
        parts.append("the thread-pitch cycle %s" % tracker.active_cycle)
    elif tracker.pitch_feed_ambiguous and tracker.ambiguous_code is not None:
        parts.append(
            "%s, which is a threading cycle in another G-code system of this dialect"
            % tracker.ambiguous_code
        )
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else "%s and %s" % (parts[0], parts[1])


def run(
    lines: Sequence[str],
    cp: gedit_nc.CompiledProfile,
    codes: Sequence[Dict[str, Any]],
    params: Params,
    base_line: int,
    fragment: bool = False,
    preceding: Optional[Sequence[str]] = None,
) -> Tuple[str, Counts, Findings]:
    """Walks the program once and returns the new text, the counts and the findings.

    ``fragment`` says that these lines are a **selection**, not the whole program.
    ``G96`` / ``G97`` and a threading cycle are modal, so a selection that starts below
    them reads an rpm as a surface speed or the other way round.

    ``preceding`` are the document lines above it (``gedit_nc.preceding_lines`` of the
    context). When they are there the run is **primed** with them and reads the selection
    in the state it is really written in; when they are not, it starts from the
    top-of-program state, cannot tell that a speed it changed is the one a thread further
    down is cut at (G8 M4 finding 6), and says so at its first line.
    """
    tracker = gedit_nc.FeedModeTracker(codes)
    findings = Findings()
    counts = Counts()
    out: List[str] = []
    state: Optional[gedit_nc.LineState] = None

    primed = fragment and bool(preceding)
    if primed:
        state = gedit_nc.prime_tracker(tracker, preceding or (), cp)

    if not codes:
        findings.add(
            base_line,
            "warning",
            "This run had no code database, so constant surface speed and thread blocks "
            "could not be recognised: check their speeds by hand.",
        )
    if primed:
        inherited = inherited_text(tracker)
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
            "This run saw only the selection, from line %d, so G96 / G97 and any cycle "
            "set above it are unknown: a surface speed may have been read as rpm, and a "
            "thread cut with one of these speeds cannot be recognised here. Run the "
            "command on the whole program, or check these blocks by hand." % base_line,
        )

    #: The last speed this run changed, which is the one a later thread block runs at.
    last_speed: Optional[Tuple[int, str]] = None
    #: True while a block that cuts a thread is in force, whichever way it is recognised.
    thread_block = primed and (tracker.pitch_feed or tracker.pitch_feed_ambiguous)

    for index, line in enumerate(lines):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        tracker.update(tokens)
        number = base_line + index
        limit_code = limit_code_of(tokens)

        # A thread block that starts while a changed speed is in force: the speed that
        # cuts the thread was set further up, so the warning has to point here.
        thread_now = tracker.pitch_feed or tracker.pitch_feed_ambiguous
        if thread_now and not thread_block and last_speed is not None:
            counts.thread += 1
            if tracker.pitch_feed:
                findings.add(
                    number,
                    "warning",
                    "This thread block (%s) runs at %s, which was scaled on line %d: the "
                    "feed follows from the speed and the pitch, so check this block by "
                    "hand." % (tracker.active_cycle, last_speed[1], last_speed[0]),
                )
            else:
                findings.add(
                    number,
                    "warning",
                    "This block runs at %s, which was scaled on line %d, and its code (%s) "
                    "is a threading cycle in another G-code system of this dialect: if "
                    "this is a lathe program the thread is cut at the changed speed, so "
                    "check the block by hand."
                    % (last_speed[1], last_speed[0], tracker.ambiguous_code),
                )
        thread_block = thread_now

        edits: List[Tuple[int, int, str]] = []
        for token in tokens:
            if not speed_word(token, params):
                continue
            counts.total += 1
            edit = scale_token(token, tracker, limit_code, params, number, findings, counts)
            if edit is not None:
                edits.append(edit)
                last_speed = (number, token.text.strip())

        out.append(apply_edits(line, edits) if edits else line)

    if counts.whole:
        findings.add(
            counts.whole_line,
            "info",
            "%s without a decimal point: rounded whole rather than to %d decimals, "
            "because in this dialect the point changes the value."
            % (count_text(counts.whole, "spindle speed"), params.decimals),
        )

    return "\n".join(out), counts, findings


def summary(counts: Counts, findings: Findings, params: Params) -> str:
    """The one-line message the status bar shows."""
    percent = trim(params.percent)
    if counts.total == 0:
        base = "No spindle speeds found"
    elif counts.changed == 0:
        base = "No spindle speed was changed"
    elif counts.changed == counts.total:
        base = "Scaled %s to %s %%" % (count_text(counts.changed, "spindle speed"), percent)
    else:
        base = "Scaled %s of %s spindle speeds to %s %%" % (
            "{:,}".format(counts.changed),
            "{:,}".format(counts.total),
            percent,
        )

    parts: List[str] = []
    for reason, text in (
        ("value", "left as a variable or an expression"),
        ("limit", "left as a speed limit"),
        ("css", "left as a surface speed"),
    ):
        count = counts.skipped.get(reason, 0)
        if count:
            parts.append("%s %s" % ("{:,}".format(count), text))
    if counts.zero:
        parts.append("%s not scaled (would become zero)" % "{:,}".format(counts.zero))
    if counts.nonpositive:
        parts.append("%s left as written (zero or negative)" % "{:,}".format(counts.nonpositive))
    if counts.filtered:
        parts.append("%s left by the value filter" % "{:,}".format(counts.filtered))
    if counts.same:
        parts.append("%s already written that way" % "{:,}".format(counts.same))
    if counts.clamped:
        parts.append("%s clamped to a limit" % "{:,}".format(counts.clamped))
    if counts.rounded:
        parts.append("%s rounded to the decimals the result is written with" % "{:,}".format(counts.rounded))
    if counts.whole:
        parts.append("%s kept whole" % "{:,}".format(counts.whole))
    if counts.thread:
        parts.append("%s to check by hand" % count_text(counts.thread, "thread block"))

    message = base + ("; " + ", ".join(parts) if parts else "") + "."
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
            "Scale spindle speeds needs a dialect profile. Run it from gEdit, which puts "
            "the profile into the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("Scale spindle speeds cannot use this profile: %s" % err, file=sys.stderr)
        return 1
    try:
        params = Params(as_dict(context.get("params")), profile)
    except (ValueError, ArithmeticError) as err:
        print("Scale spindle speeds: %s" % err, file=sys.stderr)
        return 1

    codes = context.get("codes") if isinstance(context.get("codes"), list) else []
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    base_line = start if isinstance(start, int) and start >= 1 else 1
    # A selection is a fragment of a modal language; see `run`.
    fragment = scope.get("scope") == "selection" and base_line > 1
    # The lines above the selection, when the context carries them and they are all of
    # them; `gedit_nc.preceding_lines` is where that "all of them" is decided.
    preceding = gedit_nc.preceding_lines(context)

    text, counts, findings = run(lines, cp, codes, params, base_line, fragment, preceding)
    gedit_nc.envelope(text, summary(counts, findings, params), findings.in_line_order())
    return 0


if __name__ == "__main__":
    sys.exit(main())

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
        #: Rounded whole because the dialect's decimal point is significant.
        self.whole = 0
        self.whole_line = 0
        #: Left alone because the run would have written a zero speed.
        self.zero = 0
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
        return None
    if params.only_below is not None and value >= params.only_below:
        counts.filtered += 1
        return None

    scaled = gedit_nc.scale_decimal(token.value.raw, params.percent_text)
    limited, limit_text, limit_label = clamp(scaled, params)
    new_text, whole = write(limited, token, params)

    # A spindle speed of zero is not a slow spindle, it is a spindle that does not turn.
    if value != 0 and Decimal(new_text) == 0:
        counts.zero += 1
        findings.add(
            line,
            "warning",
            "%s would become %s, so it is left as it is." % (word, new_text),
        )
        return None

    if new_text == token.value_text:
        counts.same += 1
        return None

    if limit_text is not None:
        counts.clamped += 1
        findings.add(
            line,
            "info",
            "%s would become %s; the %s (%s) was used instead."
            % (word, write(scaled, token, params)[0], limit_label, limit_text),
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

    counts.changed += 1
    return (token.end - len(token.value_text), token.end, new_text)


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


def run(
    lines: Sequence[str],
    cp: gedit_nc.CompiledProfile,
    codes: Sequence[Dict[str, Any]],
    params: Params,
    base_line: int,
    fragment: bool = False,
) -> Tuple[str, Counts, Findings]:
    """Walks the program once and returns the new text, the counts and the findings.

    ``fragment`` says that these lines are a **selection**, not the whole program.
    ``G96`` / ``G97`` and a threading cycle are modal, so a selection that starts below
    them reads an rpm as a surface speed or the other way round, and cannot tell that a
    speed it changed is the one a thread further down is cut at (G8 M4). The run says so
    at its first line.
    """
    tracker = gedit_nc.FeedModeTracker(codes)
    findings = Findings()
    counts = Counts()
    out: List[str] = []
    state: Optional[gedit_nc.LineState] = None

    if not codes:
        findings.add(
            base_line,
            "warning",
            "This run had no code database, so constant surface speed and thread blocks "
            "could not be recognised: check their speeds by hand.",
        )
    if fragment:
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
    thread_block = False

    for index, line in enumerate(lines):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        tracker.update(tokens)
        number = base_line + index
        limit_code = limit_code_of(tokens)

        # A thread block that starts while a changed speed is in force: the speed that
        # cuts the thread was set further up, so the warning has to point here.
        if tracker.pitch_feed and not thread_block and last_speed is not None:
            counts.thread += 1
            findings.add(
                number,
                "warning",
                "This thread block (%s) runs at %s, which was scaled on line %d: the feed "
                "follows from the speed and the pitch, so check this block by hand."
                % (tracker.active_cycle, last_speed[1], last_speed[0]),
            )
        thread_block = tracker.pitch_feed

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
    if counts.filtered:
        parts.append("%s left by the value filter" % "{:,}".format(counts.filtered))
    if counts.same:
        parts.append("%s already written that way" % "{:,}".format(counts.same))
    if counts.clamped:
        parts.append("%s clamped to a limit" % "{:,}".format(counts.clamped))
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

    text, counts, findings = run(lines, cp, codes, params, base_line, fragment)
    gedit_nc.envelope(text, summary(counts, findings, params), findings.in_line_order())
    return 0


if __name__ == "__main__":
    sys.exit(main())

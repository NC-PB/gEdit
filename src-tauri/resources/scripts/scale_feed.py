#!/usr/bin/env python3
# /// gedit
# name = "Scale feed rates"
# description = "Multiplies F values by a percentage. Thread pitches, rapid moves and feeds written as variables are left alone and reported."
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
# id = "perRevolution"
# type = "bool"
# label = "Also scale per-revolution feeds"
# help = "G95, and the Klartext FU and FZ feeds. They are not millimetres per minute, so they are skipped by default."
# default = false
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
    `G84`, `G74`, `G32`, `G33` and the Klartext tapping cycles carry a pitch. The database
    decides; this script has no table of its own.
Codes that mean two things
    `G76` is a fine boring cycle on the shipped mill dialect and a multi-pass threading
    cycle on a lathe in G-code system A; `G92` sets the coordinate system on the one and
    is the single-pass threading cycle on the other. Nothing in the block says which, and
    gEdit ships no lathe profile yet, so a lathe program is opened with the mill one. The
    database marks these entries ``pitchFeedAmbiguous`` and the script **refuses** them
    with a warning rather than multiplying what may be a thread lead. Refusing a real
    boring feed costs one manual edit; scaling a lead scraps the part.
Selections
    feed modes and cycles are modal, so a run over a selection cannot know what is in
    force above it and cannot recognise a thread pitch set further up. Such a run still
    happens — it is what the user asked for — but it opens with a warning that says so.
Rapid
    Klartext `FMAX` and `FAUTO` are keywords, not numbers, so they are never touched.
Feed modes
    per revolution (`G95`, and Klartext `FU` / `FZ`) and inverse time (`G93`) are a
    different unit from feed per minute. They are skipped and listed unless the run asks
    for them; scaling them is linear and correct, it is just rarely what was meant.
Variables and expressions
    `F#101`, `FQ50`, `F[#1+2.]`, or an `F` with no value at all: there is no number to
    scale. They are skipped and reported, never rewritten.
Cycle parameters
    a Klartext cycle definition carries its feeds as `Q` parameters (`Q206`). They are
    listed and left unchanged (plan section 5).

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
#: and the two addresses above.
MODE_TEXT = {
    "G95": "a feed per revolution (G95)",
    "G93": "an inverse-time feed (G93)",
    "FU": "a feed per revolution",
    "FZ": "a feed per tooth",
}

#: The modes each option covers.
PER_REVOLUTION_MODES = ("G95", "FU", "FZ")
INVERSE_TIME_MODES = ("G93",)

#: A cycle parameter whose code-database label names it a feed. The label is display text
#: out of the database we ship, and this only decides what is **listed**: a cycle
#: parameter is left unchanged either way, because it is not a feed word.
FEED_PARAM_LABEL = re.compile(r"\bfeed", re.IGNORECASE)

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

        self.per_revolution = values.get("perRevolution") is True
        self.inverse_time = values.get("inverseTime") is True

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
        #: Cycle parameters that are feeds, listed and left unchanged.
        self.cycle = 0
        #: Written further from the exact scaled value than ROUNDING_NOTICE allows.
        self.rounded = 0
        #: Rounded whole because the dialect's decimal point is significant.
        self.whole = 0
        self.whole_line = 0
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


def scale_token(
    token: gedit_nc.Token,
    tracker: gedit_nc.FeedModeTracker,
    params: Params,
    line: int,
    findings: Findings,
    counts: Counts,
) -> Optional[Tuple[int, int, str]]:
    """The edit this feed word needs, or ``None`` — with a finding when it is left alone."""
    word = token.text.strip()

    if token.value is None or token.value_text is None:
        counts.skip("value")
        findings.add(line, "warning", "%s is not a plain number, so it is not scaled." % word)
        return None

    if tracker.pitch_feed:
        counts.skip("pitch")
        findings.add(
            line,
            "warning",
            "%s is a thread pitch (%s), so it is not scaled." % (word, tracker.active_cycle),
        )
        return None

    # The same code number is a threading cycle in another G-code system of this dialect
    # (`pitchFeedAmbiguous`: Fanuc G76 and G92). Nothing in the block says which system
    # it was written for, and gEdit ships no lathe profile, so a lathe program is opened
    # with the mill one and its thread leads used to be multiplied in silence (G8 M4).
    # Refusing a real fine-boring feed costs one manual edit; scaling a lead scraps the
    # part.
    if tracker.pitch_feed_ambiguous:
        counts.skip("ambiguous")
        findings.add(
            line,
            "warning",
            "%s is not scaled: %s is a threading cycle in another G-code system of this "
            "dialect, where this F is the thread lead and not a feed rate. Check the "
            "block and scale it by hand if it really is a feed."
            % (word, tracker.ambiguous_code),
        )
        return None

    mode = feed_mode_of(token, tracker)
    if not params.scales(mode):
        counts.skip("mode:" + mode)
        findings.add(
            line,
            "info",
            "%s is %s, so it is not scaled." % (word, MODE_TEXT.get(mode, "in the feed mode " + mode)),
        )
        return None

    value = Decimal(token.value.raw)
    if params.only_above is not None and value <= params.only_above:
        counts.filtered += 1
        findings.add(
            line,
            "info",
            "%s is at or below the \"only feeds above\" value (%s), so it is left as it is."
            % (word, trim(params.only_above)),
        )
        return None
    if params.only_below is not None and value >= params.only_below:
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
        findings.add(
            line,
            "warning",
            "%s is not a feed this run can scale%s, so it is left as it is."
            % (word, " or raise to a limit" if params.min_feed is not None else ""),
        )
        return None

    limited, limit_text, limit_label = clamp(scaled, params)
    new_text, whole = write(limited, token, params)

    # A feed of zero is not a slow feed, it is a block that does not cut.
    if Decimal(new_text) == 0:
        counts.zero += 1
        findings.add(
            line,
            "warning",
            "%s would become %s, so it is left as it is." % (word, new_text),
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
        if Decimal(limited) != value:
            findings.add(
                line,
                "info",
                "%s stays as it is: %s %% of %s is %s, which is written %s with the "
                "decimals this value has. Ask for more decimal places to scale it."
                % (word, trim(params.percent), token.value_text, trim(Decimal(limited)), new_text),
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
        # The value moved, but rounding to the written precision moved it further than
        # asked. See ROUNDING_NOTICE.
        exact = Decimal(limited)
        written = Decimal(new_text)
        if exact != 0 and abs(written - exact) > ROUNDING_NOTICE * abs(exact):
            counts.rounded += 1
            findings.add(
                line,
                "warning",
                "%s becomes %s, not %s: this value is written with %s and the result was "
                "rounded to it. Ask for more decimal places if that is too coarse."
                % (
                    word,
                    new_text,
                    trim(exact),
                    written_precision(token),
                ),
            )
    if whole:
        counts.whole += 1
        counts.whole_line = counts.whole_line or line

    counts.changed += 1
    return (token.end - len(token.value_text), token.end, new_text)


def written_precision(token: gedit_nc.Token) -> str:
    """How this value was written, for a finding: ``no decimals``, ``1 decimal`` ..."""
    if token.value is None or not token.value.has_point:
        return "no decimals"
    count = len(token.value.frac_part or "")
    return "1 decimal" if count == 1 else "%d decimals" % count


def clamp(scaled: str, params: Params) -> Tuple[str, Optional[str], str]:
    """``scaled`` inside the run's limits, plus the limit that was applied."""
    value = Decimal(scaled)
    if params.min_feed is not None and value < params.min_feed:
        return params.min_text, params.min_text, "smallest feed"
    if params.max_feed is not None and value > params.max_feed:
        return params.max_text, params.max_text, "largest feed"
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

    ``fragment`` says that these lines are a **selection**, not the whole program. Feed
    modes and cycles are modal: ``G95`` and a ``G84`` tapping cycle set further up are
    still in force inside the selection, and this run cannot see them. It starts from the
    top-of-program state instead, and a thread pitch it would have recognised in a whole
    document is then scaled like an ordinary feed (G8 M4). The run says so, loudly, at
    its first line.
    """
    tracker = gedit_nc.FeedModeTracker(codes)
    findings = Findings()
    counts = Counts()
    out: List[str] = []
    state: Optional[gedit_nc.LineState] = None
    cycle: Optional[Dict[str, Any]] = None

    if not codes:
        findings.add(
            base_line,
            "warning",
            "This run had no code database, so tapping and threading blocks could not be "
            "recognised: check their feeds by hand.",
        )
    if fragment:
        findings.add(
            base_line,
            "warning",
            "This run saw only the selection, from line %d, so the feed mode and any "
            "cycle set above it are unknown: a thread pitch in a tapping or threading "
            "cycle that starts higher up cannot be recognised here and may have been "
            "scaled. Run the command on the whole program, or check these blocks by hand."
            % base_line,
        )

    for index, line in enumerate(lines):
        continued = state.continuation if state is not None else False
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        tracker.update(tokens)
        number = base_line + index

        # A cycle definition runs from its keyword to the end of its continuation lines.
        if not continued:
            cycle = cycle_definition(tokens, tracker)
        if cycle is not None:
            list_cycle_feeds(cycle, tokens, number, findings, counts)

        edits: List[Tuple[int, int, str]] = []
        for token in tokens:
            if not feed_word(token, params):
                continue
            counts.total += 1
            edit = scale_token(token, tracker, params, number, findings, counts)
            if edit is not None:
                edits.append(edit)

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


def summary(counts: Counts, findings: Findings, params: Params) -> str:
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
        ("ambiguous", "left because the code means a threading cycle in another G-code system"),
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

    text, counts, findings = run(lines, cp, codes, params, base_line, fragment)
    gedit_nc.envelope(text, summary(counts, findings, params), findings.in_line_order())
    return 0


if __name__ == "__main__":
    sys.exit(main())

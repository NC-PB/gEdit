#!/usr/bin/env python3
# /// gedit
# name = "Tool list"
# description = "Lists the tools in order of first use, with the description, the first call and the number of calls."
# input = "selection-or-document"
# output = "report"
#
# [[params]]
# id = "description"
# type = "choice"
# label = "Description from"
# help = "Where the comment that describes a tool call sits."
# default = "profile"
# choices = [
#   { label = "The profile's rule", value = "profile" },
#   { label = "Trailing, else above, else below", value = "auto" },
#   { label = "The lines above the call", value = "above" },
#   { label = "The lines below the call", value = "below" },
#   { label = "The end of the call line", value = "trailing" }
# ]
#
# [[params]]
# id = "dropLeadingZeros"
# type = "choice"
# label = "Tool numbers"
# help = "T01 and T1 are the same station; this decides how the list writes it."
# default = "profile"
# choices = [
#   { label = "The profile's rule", value = "profile" },
#   { label = "Without leading zeros (T1)", value = "yes" },
#   { label = "As written (T01)", value = "no" }
# ]
#
# [[params]]
# id = "feedSpeed"
# type = "bool"
# label = "Feed and speed range"
# help = "Adds the range of F and S values each tool is used with."
# default = true
# ///
"""The tool list of a program (plan section 5, WP4.6; `nc-transformations.md`, "Tool list").

One row per tool, in order of first use: the tool, the comment that describes it, the line
of its first call, how many times it is called, and — when the parameter asks for it — the
range of feeds and speeds it is used with.

Everything that decides what a tool call *is* comes out of the profile, never out of a
fixed Fanuc table:

``toolCall.trigger``
    the line changes the tool (`M6`, `TOOL CALL 1 …`). A bare `T2` that preselects the
    next tool is not a tool change.
``toolCall.tool``
    the tool itself, in the named group ``tool``. With ``toolFrom = "same-line-or-last"``
    a trigger without a `T` on its own line takes the last `T` seen before it, which is
    how `T1 M6` … `M06` reads on a mill.
``toolList.description``
    ``trailing``, ``above``, ``below`` or ``auto`` (trailing, then above, then below).
``toolList.commentFilter``
    a comment that matches is decoration (`-------`), not a description.
``toolList.dropLeadingZeros`` / ``collapseOffsetDigits``
    how a station is written and how a lathe's `T0101` collapses to tool 1.

The turret, and the offsets
---------------------------
On a lathe the `T` word carries two things: the station and the offset it runs with.
``toolCall.tool`` names the station in its ``tool`` group, and what is left inside the match
is the offset — `T0101` is station 1 with offset 01, `T0111` the same station with offset
11, and `T1` a station with no offset at all. The list has one row per **station**, with an
**Offsets** column that says which offsets it was called with. The column appears only when
a call carried one, so a milling program's report is what it always was.

A bare `T` word is also what changes the tool on a turret lathe: there is no `M6`. That is
the profile's business (``toolCall.trigger``), and ``toolCall.ignore`` keeps the offset
cancels out of the list — `G00 X100. Z100. T0100` retracts with the offset of station 1
cancelled and is not a tool change.

Two rules keep the answer honest:

* The trigger and tool patterns run over the **masked** line, so `(T1 M6)` inside a
  comment never becomes a tool change, and the feed and speed ranges are read off the
  **tokens**, so an `F` inside a comment or a string is not a feed.
* An `F` in a block whose cycle carries a thread pitch (`G84`, `CYCL DEF 207`) is a pitch,
  not a feed. So is the `F` of a block whose code is a threading cycle on another kind of
  machine or in another G-code system of this dialect (`pitchFeedAmbiguous`: Fanuc `G76`
  and `G92` on the **mill** profile, `G74` and `G78` on the **lathe**, where nothing in
  the block says which reading applies). Both are left out of the feed
  range and reported as findings, the same rule scale-feed follows: a number that may not be
  a feed must not be shown as one.
* A range only means something inside one unit, so each tool's range is in the unit the
  **control powers on in** — feed per minute and rpm on a milling control, feed per
  revolution on a turning one (`modal.initial`, plan AD-19 rule 8, and the document's
  machine may say otherwise) — and a value in another unit is left out and reported, never
  mixed in. A tool that has no value in that unit at all, a turning tool that only ever cuts
  at a constant surface speed, gets the unit it does have, and the column says which. A
  `G50` or `G92` clamp is not a cutting speed in any unit; which code clamps comes from the
  database (`sets.speedLimit`, `gedit_nc.speed_limit_of`), not from a list in this file
  (F24), because in G-code system A that same `G92` cuts a thread.

A run over a **selection** is primed from `input.precedingLines` when the context carries
them (`gedit_nc.prime_tracker`), so a `G95` or a `G96` that starts above the selection is
in force here too and its values stay out of the per-minute and rpm ranges. Without the
field the run starts from the top-of-program state, which is what it always did.

This script never changes the document.
"""

from __future__ import annotations

import re
import sys
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc

#: Between the tool and its description in the summary counts.
LOOK_ABOVE = 3
LOOK_BELOW = 2

#: `T5  D12 FLAT END MILL`, the line a CAM post prints in the header tool list.
TOOL_LIST_ENTRY = re.compile(r"^T0*(\d+)(?![\d.])[\s:\-\u2013\u2014]*", re.IGNORECASE)

LEADING_ZEROS = re.compile(r"^0+(?=\d)", re.ASCII)
ALL_DIGITS = re.compile(r"^\d+$", re.ASCII)

#: Klartext writes a feed per revolution and a feed per tooth with their own address
#: (plan section 7.10). They are feeds, but not in millimetres per minute.
PER_TOOTH_ADDRESSES = ("FU", "FZ")

#: A `FeedModeTracker.feed_mode` as the §7.1 feed unit. The tracker answers in Phase 1's
#: names — per revolution is `'G95'` whatever code the dialect writes for it — and a range
#: is a claim about a unit, not about a code.
UNIT_OF_MODE = {"G93": "inverse-time", "G94": "per-minute", "G95": "per-rev"}

#: What a unit is called in a finding.
UNIT_TEXT = {
    "per-minute": "per minute",
    "per-rev": "per revolution",
    "per-tooth": "per tooth",
    "inverse-time": "inverse time",
    "unknown": "an unknown unit",
}

#: What a range in that unit carries next to it. A range with no entry here is written bare:
#: feed per minute and rpm are what a reader assumes, and repeating them is noise. The rest
#: have to say what they are — 220 rpm and a surface speed of 220 are not the same number,
#: and a column that showed both as `220` would be read as the wrong one.
UNIT_TAG = {"per-rev": "/rev", "per-tooth": "/tooth", "surface": "surface"}

#: The units a feed range may be in. Inverse time is the reciprocal of a time and not a feed
#: rate, and an unknown unit is unknown: neither ever joins a range.
RANGE_UNITS = ("per-minute", "per-rev", "per-tooth")


def as_dict(value: Any) -> Dict[str, Any]:
    """``value`` when it is a dictionary, else an empty one — profiles arrive as JSON."""
    return value if isinstance(value, dict) else {}


class Spec:
    """The profile's tool-list rules, with the parameters applied."""

    def __init__(self, cp: gedit_nc.CompiledProfile, params: Dict[str, Any]) -> None:
        profile = cp.profile
        tool_list = as_dict(profile.get("toolList"))
        tool_call = as_dict(profile.get("toolCall"))
        addresses = as_dict(profile.get("addresses"))

        self.tool_from_last = tool_call.get("toolFrom") == "same-line-or-last"
        #: A turning profile changes tool with a bare `T` word and has no `M6` (plan §7.4).
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        #: Klartext `{'FU': 'per-rev'}`: a word that says what unit its own value is in.
        words = as_dict(addresses.get("feedUnitWords"))
        self.feed_unit_words = {
            key.upper(): value
            for key, value in words.items()
            if isinstance(key, str) and isinstance(value, str)
        }

        wanted = params.get("description")
        profile_mode = tool_list.get("description")
        if wanted in ("auto", "above", "below", "trailing"):
            self.description = wanted
        elif profile_mode in ("auto", "above", "below", "trailing"):
            self.description = profile_mode
        else:
            self.description = "auto"

        zeros = params.get("dropLeadingZeros")
        if zeros == "yes":
            self.drop_leading_zeros = True
        elif zeros == "no":
            self.drop_leading_zeros = False
        else:
            self.drop_leading_zeros = tool_list.get("dropLeadingZeros") is True

        self.collapse_offset_digits = tool_list.get("collapseOffsetDigits") is True
        self.comment_filter = cp.patterns.get("comment_filter")
        self.comments = [
            {"start": marker.get("start"), "end": marker.get("end")}
            for marker in as_dict(profile.get("syntax")).get("comments") or []
            if isinstance(marker, dict) and isinstance(marker.get("start"), str) and marker.get("start") != ""
        ]
        self.feed_address = addresses.get("feed") if isinstance(addresses.get("feed"), str) else "F"
        self.spindle_address = addresses.get("spindle") if isinstance(addresses.get("spindle"), str) else "S"
        self.feed_speed = params.get("feedSpeed") is not False
        #: The units the ranges are in unless a tool has no value in them; filled from the
        #: profile's power-on state in :func:`build`, where the tracker knows it.
        self.feed_unit = "per-minute"
        self.speed_unit = "rpm"


class Mark:
    """What one line contributes. Mirrors the outline index's per-line classification."""

    __slots__ = ("kind", "is_tool", "tool", "offset", "description")

    def __init__(
        self,
        kind: Optional[str],
        is_tool: bool,
        tool: Optional[str],
        description: Optional[str],
        offset: Optional[str] = None,
    ) -> None:
        self.kind = kind
        self.is_tool = is_tool
        self.tool = tool
        #: The digits the tool word carries after the station: `T0101` -> `01`.
        self.offset = offset
        self.description = description


class Row:
    """One tool of the list, filled as the walk passes its calls."""

    __slots__ = (
        "label",
        "number",
        "line",
        "calls",
        "description",
        "offsets",
        "by_mode",
        "by_speed",
        "first_line",
        "feeds",
        "feed_unit",
        "speeds",
        "speed_unit",
        "skipped",
    )

    def __init__(self, label: str, number: Optional[str], line: int) -> None:
        self.label = label
        self.number = number
        self.line = line
        self.calls = 0
        self.description: Optional[str] = None
        #: The offsets this station was called with, in order of first use.
        self.offsets: List[str] = []
        #: Every feed of this tool, by the mode it was written in (`'G94'`, `'FU'`); every
        #: speed, by its unit (`'rpm'`, `'surface'`). Which of them becomes the range is
        #: decided once the whole program has been walked (:func:`choose_ranges`), because
        #: a rule that follows the first value found would make the answer depend on where
        #: a tool happens to start.
        self.by_mode: Dict[str, List[Tuple[Decimal, str]]] = {}
        self.by_speed: Dict[str, List[Tuple[Decimal, str]]] = {}
        #: `'feed:<mode>'` / `'speed:<unit>'` -> the first line it was seen on.
        self.first_line: Dict[str, int] = {}
        #: The chosen range and its unit, filled by :func:`choose_ranges`.
        self.feeds: List[Tuple[Decimal, str]] = []
        self.feed_unit: Optional[str] = None
        self.speeds: List[Tuple[Decimal, str]] = []
        self.speed_unit: Optional[str] = None
        #: reason → (first line it happened on, how many blocks); see :func:`findings_of`.
        self.skipped: Dict[str, List[int]] = {}

    def add_offset(self, offset: Optional[str]) -> None:
        if offset is not None and offset not in self.offsets:
            self.offsets.append(offset)

    def add(self, kind: str, key: str, value: Tuple[Decimal, str], line: int) -> None:
        """Records one feed or speed under the mode or unit it was written in."""
        found = self.by_mode if kind == "feed" else self.by_speed
        found.setdefault(key, []).append(value)
        self.first_line.setdefault("%s:%s" % (kind, key), line)

    def skip(self, reason: str, line: int) -> None:
        """Records one block whose value was left out of a range, and why."""
        entry = self.skipped.get(reason)
        if entry is None:
            self.skipped[reason] = [line, 1]
        else:
            entry[1] += 1


def group_of(match: Any, name: str) -> Optional[str]:
    """A named group of ``match``, or ``None`` when the pattern does not have one."""
    if name not in (match.re.groupindex or {}):
        return None
    value = match.group(name)
    return value if isinstance(value, str) else None


def display_text(match: Any, line: str) -> str:
    """What an outline rule shows: its ``text`` group, else the whole match, else the line."""
    named = group_of(match, "text")
    if named is not None and named.strip() != "":
        return named.strip()
    whole = match.group(0).strip()
    return whole if whole != "" else line.strip()


def comment_text_of(line: str, masked: str) -> Optional[str]:
    """The comment text of a line, read off the mask.

    ``mask_comments`` blanks exactly the comment spans and keeps every offset, so a run of
    blanks in the mask that is not blank in the line is a comment. The last one wins: a
    trailing comment describes the code in front of it, which is what a tool call needs.
    """
    if masked == line:
        return None
    found: Optional[str] = None
    i = 0
    length = len(line)
    while i < length:
        if masked[i] != " ":
            i += 1
            continue
        j = i
        while j < length and masked[j] == " ":
            j += 1
        span = line[i:j].strip()
        if span != "":
            found = span
        i = j
    return found


def strip_markers(text: str, spec: Spec) -> str:
    """Drops the comment delimiters a span still carries (``(D8 DRILL)``, ``; D8 DRILL``)."""
    for marker in spec.comments:
        start = marker["start"]
        if not text.upper().startswith(start.upper()):
            continue
        inner = text[len(start) :]
        end = marker["end"]
        if isinstance(end, str) and end != "" and inner.upper().endswith(end.upper()):
            inner = inner[: len(inner) - len(end)]
        return inner.strip()
    return text.strip()


def classify(line: str, cp: gedit_nc.CompiledProfile, spec: Spec) -> Optional[Mark]:
    """Classifies one line on its own; ``None`` when it says nothing about a tool."""
    if line.strip() == "":
        return None

    masked = gedit_nc.mask_comments(line, cp)

    kind: Optional[str] = None
    text = ""
    for rule_kind, regex in cp.patterns["outline"]:
        raw = rule_kind in ("comment", "section")
        match = regex.search(line if raw else masked)
        if match is None:
            continue
        kind = rule_kind
        text = display_text(match, line)
        break

    # A trigger line that also matches `toolCall.ignore` is not a tool change: a Fanuc
    # lathe writes `T0100` to cancel the offset of station 1, and `G00 X100. Z100. T0100`
    # to retract with it (plan §7.1). Counting those would put a tool in the list for
    # every retract.
    ignore = cp.patterns.get("tool_ignore")
    is_tool = cp.patterns["tool_trigger"].search(masked) is not None and not (
        ignore is not None and ignore.search(masked) is not None
    )
    tool: Optional[str] = None
    offset: Optional[str] = None
    if is_tool or spec.tool_from_last:
        match = cp.patterns["tool"].search(masked)
        if match is not None:
            group = group_of(match, "tool")
            tool = (group if group is not None and group != "" else match.group(0)).strip()
            offset = offset_of(match, masked)

    description: Optional[str] = None
    if kind in ("comment", "section"):
        description = text
    else:
        span = comment_text_of(line, masked)
        if span is not None:
            description = strip_markers(span, spec)
    if description is not None and (
        description == "" or (spec.comment_filter is not None and spec.comment_filter.search(description) is not None)
    ):
        description = None

    if kind is None and not is_tool and tool is None and description is None:
        return None
    return Mark(kind=kind, is_tool=is_tool, tool=tool, description=description, offset=offset)


def offset_of(match: Any, subject: str) -> Optional[str]:
    """The offset digits a tool word carries after its station, or ``None``.

    `T0101` is station 1 with offset 01, `T0111` the same station with offset 11, `T1` a
    station with no offset. What counts as the station is the pattern's ``tool`` group, so
    this is the rest of the match — the profile decides, not a rule about four digits
    (plan §7.1). A profile whose pattern has no ``tool`` group names the whole match, and
    then there is nothing left over.
    """
    if "tool" not in (match.re.groupindex or {}):
        return None
    try:
        end = match.end("tool")
    except IndexError:  # pragma: no cover - a group that did not take part
        return None
    if end < 0:
        return None
    rest = subject[end : match.end()].strip()
    return rest if rest != "" and rest.isdigit() else None


def bare_tool(tool: str, spec: Spec) -> str:
    """The tool as it identifies a station: quotes gone, a lathe offset pair collapsed."""
    value = tool
    if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    if spec.collapse_offset_digits and ALL_DIGITS.match(value) and len(value) >= 4 and len(value) % 2 == 0:
        value = value[: len(value) // 2]
    return value


def tool_label(tool: str, spec: Spec) -> str:
    """``T01`` → ``T1``, ``T0101`` → ``T1`` on a lathe profile, ``"MILL_D10"`` → ``MILL_D10``."""
    value = bare_tool(tool, spec)
    if value == "" or not value[0].isdigit():
        return value
    if spec.drop_leading_zeros:
        value = LEADING_ZEROS.sub("", value)
    return "T" + value


def tool_number_of(tool: str, spec: Spec) -> Optional[str]:
    """The tool's number for comparing, or ``None`` for a name or a ``QS`` parameter.

    Always without leading zeros, whatever the profile does for display: ``T01`` and ``T1``
    are the same station, and the header tool list may write either.
    """
    value = bare_tool(tool, spec)
    return LEADING_ZEROS.sub("", value) if ALL_DIGITS.match(value) else None


def tool_list_entry(description: Optional[str]) -> Optional[Tuple[str, str]]:
    """``T5  D12 FLAT END MILL`` → ``('5', 'D12 FLAT END MILL')``, else ``None``."""
    if description is None:
        return None
    match = TOOL_LIST_ENTRY.match(description)
    if match is None:
        return None
    text = description[match.end() :].strip()
    return None if text == "" else (LEADING_ZEROS.sub("", match.group(1)), text)


def own_description(description: str, number: Optional[str]) -> Optional[str]:
    """The part of a comment that describes tool ``number``, or ``None`` for another tool.

    Without this the nearest comment wins whoever it belongs to, and a header tool list two
    lines up labels ``T5`` with the line that describes ``T6`` — the most damaging thing a
    tool list can say. A comment that names *this* tool loses the number, because the row
    already carries it.
    """
    if TOOL_LIST_ENTRY.match(description) is None:
        return description
    listed = tool_list_entry(description)
    if listed is None or listed[0] != number:
        return None
    return listed[1]


def scan_for(marks: Sequence[Optional[Mark]], line: int, step: int, count: int, number: Optional[str]) -> Optional[str]:
    """Walks ``count`` lines in ``step`` direction for a comment that describes this tool.

    It stops at a program header, whose comment is the program's title, and at another tool
    change, which owns the comments around it.
    """
    for i in range(1, count + 1):
        n = line + step * i
        if n < 1 or n > len(marks):
            return None
        mark = marks[n - 1]
        if mark is None:
            continue
        if mark.kind == "program" or mark.is_tool:
            return None
        if mark.description is None:
            continue
        found = own_description(mark.description, number)
        if found is not None:
            return found
    return None


def describe_tool(
    marks: Sequence[Optional[Mark]],
    line: int,
    number: Optional[str],
    from_list: Dict[str, str],
    spec: Spec,
) -> Optional[str]:
    """The description of the tool call on ``line`` (1-based into ``marks``)."""
    mode = spec.description

    if mode in ("trailing", "auto"):
        mark = marks[line - 1]
        own = mark.description if mark is not None else None
        found = None if own is None else own_description(own, number)
        if found is not None:
            return found
    if mode in ("auto", "above"):
        found = scan_for(marks, line, -1, LOOK_ABOVE, number)
        if found is not None:
            return found
    if mode in ("auto", "below"):
        found = scan_for(marks, line, 1, LOOK_BELOW, number)
        if found is not None:
            return found
    return from_list.get(number) if number is not None else None


def range_text(values: Sequence[Tuple[Any, str]], unit: Optional[str] = None) -> str:
    """``[(Decimal, '400.'), …]`` → ``'400.'`` or ``'400.-1500.'``, as the file wrote them.

    A range that is not in the unit a reader assumes — feed per minute, speed in rpm — says
    which it is in (``0.12-0.25 /rev``), because the same digits mean two very different
    things and the column would otherwise be read as the wrong one.
    """
    if not values:
        return ""
    low = min(values, key=lambda pair: pair[0])
    high = max(values, key=lambda pair: pair[0])
    text = low[1] if low[1] == high[1] else "%s-%s" % (low[1], high[1])
    tag = UNIT_TAG.get(unit or "")
    return "%s %s" % (text, tag) if tag else text


def numeric(token: gedit_nc.Token) -> Optional[Decimal]:
    """The token's value as a comparable decimal, or ``None`` when it is not a number."""
    if token.value is None or token.value_text is None:
        return None
    try:
        return Decimal(token.value.raw)
    except InvalidOperation:  # pragma: no cover - parse_number already rejected these
        return None


def build(
    lines: Sequence[str],
    cp: gedit_nc.CompiledProfile,
    spec: Spec,
    codes: Sequence[Dict[str, Any]],
    base_line: int,
    preceding: Optional[Sequence[str]] = None,
) -> Tuple[List[Row], List[Dict[str, Any]], int, int]:
    """Walks the program once.

    Returns the rows in order of first use, the findings, how many tool changes carried
    no tool number at all, and how many tool words were seen anywhere — the last of which
    is what tells an empty report apart from a program that really uses no tools.

    ``preceding`` are the document lines above a selection
    (``gedit_nc.preceding_lines`` of the context). They prime the feed-mode tracker, so a
    ``G95`` or ``G96`` set above the selection keeps its values out of the per-minute feed
    range and the rpm range instead of quietly widening them. They are **not** scanned for
    tool calls: a tool changed above the selection is not called inside it, and inventing a
    row for it would report a tool the user did not select.
    """
    marks: List[Optional[Mark]] = [classify(line, cp, spec) for line in lines]

    rows: List[Row] = []
    by_key: Dict[str, Row] = {}
    findings: List[Dict[str, Any]] = []
    from_list: Dict[str, str] = {}
    last_tool: Optional[str] = None
    current: Optional[Row] = None
    unnamed = 0
    #: Tool words seen anywhere, and the first line one stood on. A program full of them
    #: and empty of tool changes is the lathe case below.
    tool_words = 0
    first_tool_word = 0

    tracker = gedit_nc.FeedModeTracker(codes)
    power_on_state(tracker, cp)
    # What the ranges are in, before the program says anything: this control's own units.
    spec.feed_unit = unit_of(tracker.feed_mode, spec)
    spec.speed_unit = "surface" if tracker.css else "rpm"
    state: Optional[gedit_nc.LineState] = None
    if preceding:
        state = gedit_nc.prime_tracker(tracker, preceding, cp)

    for i, line in enumerate(lines):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        tracker.update(tokens)
        mark = marks[i]
        number_line = base_line + i

        if mark is not None:
            if mark.tool is not None:
                last_tool = mark.tool
                tool_words += 1
                if first_tool_word == 0:
                    first_tool_word = number_line

            # A comment line of the header tool list (`(T5  D12 FLAT END MILL)`). The first
            # one per number wins, and it is registered before the tool change that uses it,
            # because a post prints the list above the program.
            if mark.kind in ("comment", "section"):
                listed = tool_list_entry(mark.description)
                if listed is not None and listed[0] not in from_list:
                    from_list[listed[0]] = listed[1]

            if mark.is_tool:
                tool = mark.tool if mark.tool is not None else (last_tool if spec.tool_from_last else None)
                if tool is None:
                    findings.append(
                        {
                            "line": number_line,
                            "severity": "warning",
                            "message": "Tool change without a tool number.",
                        }
                    )
                    unnamed += 1
                    current = None
                else:
                    number = tool_number_of(tool, spec)
                    key = number if number is not None else "name:" + bare_tool(tool, spec)
                    row = by_key.get(key)
                    if row is None:
                        row = Row(label=tool_label(tool, spec), number=number, line=number_line)
                        by_key[key] = row
                        rows.append(row)
                    row.calls += 1
                    row.add_offset(mark.offset)
                    if row.description is None:
                        row.description = describe_tool(marks, i + 1, number, from_list, spec)
                    current = row

        if current is not None and spec.feed_speed:
            collect(current, tokens, tracker, spec, codes, number_line)

    # Nothing described the tool at its call, but the header tool list did.
    for row in rows:
        if row.description is None and row.number is not None:
            row.description = from_list.get(row.number)
        choose_ranges(row, spec)
        findings.extend(findings_of(row))

    # A program with tool words and no tool change at all. On a milling profile a tool
    # change is `M6`, which a turret lathe never writes: it changes tool with a bare
    # `T0101`, and such a program opened with the mill profile used to get "No tool changes
    # found." — which reads as "this program uses no tools" (G8 M4). Say what was actually
    # looked for, and where the program belongs.
    #
    # Only on a milling profile: on a turning one the bare `T` word **is** the tool change
    # (`toolCall.trigger`), so rows with no tool change and tool words left over would mean
    # something else entirely and this sentence would be wrong.
    if not rows and tool_words and not spec.lathe:
        findings.append(
            {
                "line": first_tool_word,
                "severity": "warning",
                "message": "%s here, but no tool change: this profile marks a tool change "
                "with a code of its own (M6 on the shipped Fanuc mill profile), and %s "
                "was written without one. A turret lathe changes tool with a bare T word, "
                "so open this program with a lathe profile."
                % (
                    "A tool word" if tool_words == 1 else "%d tool words" % tool_words,
                    "it" if tool_words == 1 else "each of them",
                ),
            }
        )

    findings.sort(key=lambda finding: finding["line"])
    return rows, findings, unnamed, tool_words


def power_on_state(tracker: gedit_nc.FeedModeTracker, cp: gedit_nc.CompiledProfile) -> None:
    """Puts the tracker into the state the control powers on in (plan AD-19 rule 8, AD-31).

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
        return
    tokens, _ = gedit_nc.tokenize_line(" ".join(codes), cp, None)
    tracker.update(tokens)


def feed_mode_of(token: gedit_nc.Token, tracker: gedit_nc.FeedModeTracker) -> str:
    """The mode a feed word is written in: its own address wins over the modal state."""
    if token.address in PER_TOOTH_ADDRESSES:
        return token.address or ""
    return tracker.feed_mode


def unit_of(mode: str, spec: Spec) -> str:
    """The §7.1 feed unit a `FeedModeTracker` mode name stands for, for this profile."""
    if mode in spec.feed_unit_words:
        return spec.feed_unit_words[mode]
    return UNIT_OF_MODE.get(mode, "unknown")


def collect(
    row: Row,
    tokens: Sequence[gedit_nc.Token],
    tracker: gedit_nc.FeedModeTracker,
    spec: Spec,
    codes: Sequence[Dict[str, Any]],
    line: int,
) -> None:
    """Adds this block's feed and speed to ``row`` — or records why they were left out.

    A range only means something inside one unit, so a value measured in another one is
    never silently mixed in. A tool's range is in the unit its **first** value was written
    in — per minute on a milling program, per revolution on a turning one — and everything
    else is counted per tool and comes back as one finding:

    * a thread pitch (``G84``, ``G76`` on a lathe, ``CYCL DEF 207``) is not a feed at all;
    * neither is the ``F`` of a block whose code is a threading cycle on another kind of
      machine or in another G-code system of this dialect (``pitchFeedAmbiguous``),
      because nothing in the block says which reading applies (G8 M4 finding 7);
    * an inverse-time ``F`` is the reciprocal of a time, so it joins no range;
    * a surface speed under ``G96`` is not a speed in rpm;
    * and the ``S`` of a speed-clamp block (``sets.speedLimit``: `G50` in Fanuc's G-code
      system A, `G92` in system B) is the top speed the spindle may reach, not a cutting
      speed. The database says which code that is, not this file (F24).

    A feed or speed written as a variable or an expression (``F#101``, ``FQ50``) carries no
    number at all, so it is in neither the range nor the findings.
    """
    pitch_reason: Optional[str] = None
    if tracker.pitch_feed:
        pitch_reason = "pitch"
    elif tracker.pitch_feed_ambiguous:
        pitch_reason = "ambiguous"

    limit_code = gedit_nc.speed_limit_of(codes, tokens)
    speed_unit = "surface" if tracker.css else "rpm"

    for token in tokens:
        if token.kind != "word" or token.address is None:
            continue
        value = numeric(token)
        if value is None:
            continue
        if token.address == spec.feed_address or token.address in PER_TOOTH_ADDRESSES:
            if pitch_reason is not None:
                row.skip(pitch_reason, line)
            else:
                row.add("feed", feed_mode_of(token, tracker), (value, token.value_text or ""), line)
        elif token.address == spec.spindle_address:
            if limit_code is not None:
                row.skip("limit", line)
            else:
                row.add("speed", speed_unit, (value, token.value_text or ""), line)


def choose_ranges(row: Row, spec: Spec) -> None:
    """Decides which unit each of this tool's two ranges is in, and skips the rest.

    **The machine's ordinary unit first.** A milling control powers on in feed per minute
    and in rpm, a turning one in feed per revolution (`G99` in G-code system A, `G95` in
    system B, and the machine may say otherwise — plan AD-19 rule 8, AD-31), so that is what
    a range is in and what a reader assumes. A tool that has no value in it at all — a
    turning tool that only ever cuts at a constant surface speed — gets the unit it does
    have, and the column says which. Everything else is left out and reported.

    Deciding it here rather than while walking keeps the answer independent of the order a
    tool's blocks happen to come in.
    """
    for kind, found, preferred in (
        ("feed", row.by_mode, spec.feed_unit),
        ("speed", row.by_speed, spec.speed_unit),
    ):
        # Mode -> unit, in the order the tool used them; a unit no range may be in
        # (inverse time, or a feed while the feed unit is unknown) is never chosen.
        units = [unit_of(key, spec) if kind == "feed" else key for key in found]
        usable = [unit for unit in units if kind == "speed" or unit in RANGE_UNITS]
        chosen = preferred if preferred in usable else (usable[0] if usable else None)
        values: List[Tuple[Decimal, str]] = []
        for key, unit in zip(found, units):
            if unit == chosen:
                values.extend(found[key])
            else:
                reason = "mode:" + key if kind == "feed" else ("css" if key == "surface" else "rpm")
                row.skipped[reason] = [row.first_line["%s:%s" % (kind, key)], len(found[key])]
        if kind == "feed":
            row.feeds, row.feed_unit = values, chosen
        else:
            row.speeds, row.speed_unit = values, chosen


def blocks(count: int) -> str:
    """``1 block`` / ``4 blocks``, for the findings."""
    return "1 block" if count == 1 else "%d blocks" % count


def findings_of(row: Row) -> List[Dict[str, Any]]:
    """One finding per tool and reason, anchored at the first block it happened on."""
    out: List[Dict[str, Any]] = []
    for reason, (line, count) in sorted(row.skipped.items()):
        if reason == "pitch":
            text = "the F of %s is a thread pitch, not a feed rate" % blocks(count)
        elif reason == "ambiguous":
            text = (
                "the F of %s may be a thread lead rather than a feed rate, because its "
                "code is a threading cycle on another kind of machine or in another "
                "G-code system"
                % blocks(count)
            )
        elif reason == "css":
            text = "the S of %s is a surface speed (G96), not a spindle speed" % blocks(count)
        elif reason == "rpm":
            text = (
                "the S of %s is a spindle speed in rpm, not a surface speed" % blocks(count)
            )
        elif reason == "limit":
            text = "the S of %s is a speed limit, not a spindle speed" % blocks(count)
        else:
            # The range's own unit, so that "not per minute" is never claimed of a turning
            # program whose range is per revolution. A tool with no range at all keeps the
            # unit a reader assumes.
            text = "the feed of %s is in %s, not %s" % (
                blocks(count),
                reason.split(":", 1)[1],
                UNIT_TEXT.get(row.feed_unit or "per-minute", "per minute"),
            )
        out.append(
            {
                "line": line,
                "severity": "info",
                "message": "%s: %s, so it is not in the range." % (row.label, text),
            }
        )
    return out


def summary(rows: Sequence[Row], unnamed: int, tool_words: int = 0, lathe: bool = False) -> str:
    """The one-line message above the table."""
    if not rows:
        if unnamed:
            return "No tool numbers found."
        if tool_words and not lathe:
            return (
                "No tool change found, but %s. This profile reads a tool change as a code "
                "of its own; a turning program that changes tool with a bare T word belongs "
                "to a lathe profile."
                % ("1 tool word was seen" if tool_words == 1 else "%d tool words were seen" % tool_words)
            )
        return "No tool changes found."
    without = sum(1 for row in rows if not row.description)
    count = "1 tool" if len(rows) == 1 else "%d tools" % len(rows)
    if without == 0:
        return count
    return "%s, %d without a description" % (count, without)


def main() -> int:
    """Reads the context and stdin, writes the report to stdout, and answers the exit code."""
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()

    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print(
            "Tool list needs a dialect profile. Run it from gEdit, which puts the profile "
            "into the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("Tool list cannot use this profile: %s" % err, file=sys.stderr)
        return 1

    params = as_dict(context.get("params"))
    codes = context.get("codes") if isinstance(context.get("codes"), list) else []
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    base_line = start if isinstance(start, int) and start >= 1 else 1

    spec = Spec(cp, params)
    # The lines above a selection, when the context carries all of them; they prime the
    # feed-mode tracker and are not scanned for tool calls. See `build`.
    preceding = gedit_nc.preceding_lines(context)
    rows, findings, unnamed, tool_words = build(lines, cp, spec, codes, base_line, preceding)

    # The offsets are a turret's, and a milling program has none: the column appears only
    # when a call carried one, so a mill report is exactly what it always was.
    offsets = any(row.offsets for row in rows)

    columns = [{"key": "tool", "label": "Tool"}]
    if offsets:
        columns.append({"key": "offsets", "label": "Offsets"})
    columns.append({"key": "description", "label": "Description"})
    columns.append({"key": "line", "label": "First call"})
    columns.append({"key": "calls", "label": "Calls"})
    if spec.feed_speed:
        columns.append({"key": "feed", "label": "Feed"})
        columns.append({"key": "speed", "label": "Speed"})

    table: List[Dict[str, Any]] = []
    for row in rows:
        entry: Dict[str, Any] = {"tool": row.label}
        if offsets:
            entry["offsets"] = ", ".join(row.offsets)
        entry["description"] = row.description or ""
        entry["line"] = row.line
        entry["calls"] = row.calls
        if spec.feed_speed:
            entry["feed"] = range_text(row.feeds, row.feed_unit)
            entry["speed"] = range_text(row.speeds, row.speed_unit)
        table.append(entry)

    gedit_nc.report(
        "Tool list", columns, table, summary(rows, unnamed, tool_words, spec.lathe), findings
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

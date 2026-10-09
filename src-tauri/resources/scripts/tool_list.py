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
  at a constant surface speed, gets the unit it does have, and the column says which — a
  surface speed with its unit and the code that put it in force (`220 m/min (G96)`,
  `150 m/min (G961)`, `600 ft/min (G96)` in an inch program; M9). A
  `G50` or `G92` clamp is not a cutting speed in any unit; which code clamps comes from the
  database (`sets.speedLimit`, `gedit_nc.speed_limit_of`), not from a list in this file
  (F24), because in G-code system A that same `G92` cuts a thread.
* A value belongs to the tool that cuts with it. A post may write the speed of the next
  operation before it indexes the turret (`G97 S1500 M03`, then `T0202`: the order the
  Okuma notes show), so a feed or speed written since the last block that moved an axis
  goes to the next tool when a tool change comes before the next move.
* Only the plain feed and spindle words are read (M8): the `F` and `S` of a dwell block
  (`fNotFeed`: `G04 F2`, `G4 S2`) are times, and a clamp word (`LIMS=`), a spindle named by
  its number (`S3=`) or a driven tool's speed (`SB=`) is not the main spindle's `S`. A word
  that names the **main** spindle by its number is (`S1=`, `S[1]=` where the profile's
  `addresses.mainSpindle` is 1; M10, the owner's reading of 2026-09-27).

A run over a **selection** is primed from `input.precedingLines` when the context carries
them (`gedit_nc.prime_tracker`), so a `G95` or a `G96` that starts above the selection is
in force here too and its values stay out of the per-minute and rpm ranges. Without the
field the run starts from the top-of-program state, which is what it always did.

This script never changes the document.
"""

from __future__ import annotations

import re
import sys
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

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
UNIT_OF_MODE = {"G93": "inverse-time", "G94": "per-minute", "G95": "per-rev", "G931": "travel-time"}

#: What a unit is called in a finding.
UNIT_TEXT = {
    "per-minute": "per minute",
    "per-rev": "per revolution",
    "per-tooth": "per tooth",
    "inverse-time": "inverse time",
    "travel-time": "a travel time",
    "unknown": "an unknown unit",
}

#: What a range in that unit carries next to it. A range with no entry here is written bare:
#: feed per minute and rpm are what a reader assumes, and repeating them is noise. The rest
#: have to say what they are — 220 rpm and a surface speed of 220 are not the same number,
#: and a column that showed both as `220` would be read as the wrong one.
UNIT_TAG = {"per-rev": "/rev", "per-tooth": "/tooth", "surface": "surface"}

#: M13 (NC-13): the tag of a range in the unit a reader assumes, written only where the
#: range is **not** in the program's own unit (a feed per minute under `G94` in a turning
#: program, whose other rows say `/rev`): there a bare `100` would be read as per revolution.
DEFAULT_UNIT_TAG = {"per-minute": "/min", "rpm": "rpm"}

#: M9 (WP9.5a): what a surface speed is measured in, by the program's units. A range of
#: surface speeds says this and the code that put it in force (`220 m/min (G96)`), because
#: "surface" alone named neither the unit nor the code, and a Sinumerik `G961` was reported
#: as `G96`.
SURFACE_UNIT = {"mm": "m/min", "inch": "ft/min"}

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
        #: `toolCall.tool` carries an `(?<axis>...)` group (Klartext's tool axis): a `TOOL
        #: CALL` with no tool argument is always a speed change, and one that repeats the
        #: tool already in the spindle is one too when it names no axis (syntax-heidenhain
        #: §5.1). False for every other profile's `tool` pattern, so :func:`is_speed_only`
        #: never runs there.
        self.axis_aware = "(?<axis>" in (tool_call.get("tool") or "")
        self.comment_filter = cp.patterns.get("comment_filter")
        self.comments = [
            {"start": marker.get("start"), "end": marker.get("end")}
            for marker in as_dict(profile.get("syntax")).get("comments") or []
            if isinstance(marker, dict) and isinstance(marker.get("start"), str) and marker.get("start") != ""
        ]
        self.feed_address = addresses.get("feed") if isinstance(addresses.get("feed"), str) else "F"
        self.spindle_address = addresses.get("spindle") if isinstance(addresses.get("spindle"), str) else "S"
        #: P10 (decision 3, the owner's reading of 2026-09-27): the main spindle's number,
        #: whose `S1=` / `S[1]=` is a tool's speed like the plain `S` (`addresses.mainSpindle`).
        main = addresses.get("mainSpindle")
        self.main_spindle = main.strip() if isinstance(main, str) and main.strip() != "" else None
        self.feed_speed = params.get("feedSpeed") is not False
        #: The addresses that move the machine: a block with one of them is where a tool cuts
        #: with the feed and speed in force (:class:`Pending`).
        axes = addresses.get("axes")
        twins = addresses.get("incremental")
        self.axes = frozenset(
            [str(axis).upper() for axis in (axes if isinstance(axes, list) else []) if isinstance(axis, str)]
            + [str(twin).upper() for twin in (twins if isinstance(twins, dict) else {}) if isinstance(twin, str)]
        )
        #: The units the ranges are in unless a tool has no value in them; filled from the
        #: profile's power-on state in :func:`build`, where the tracker knows it.
        self.feed_unit = "per-minute"
        self.speed_unit = "rpm"
        #: The program's units at the start (M9): the document's machine, set in `main`.
        self.units = "mm"


class Mark:
    """What one line contributes. Mirrors the outline index's per-line classification."""

    __slots__ = ("kind", "is_tool", "tool", "axis", "offset", "description", "unload")

    def __init__(
        self,
        kind: Optional[str],
        is_tool: bool,
        tool: Optional[str],
        description: Optional[str],
        offset: Optional[str] = None,
        axis: bool = False,
        unload: bool = False,
    ) -> None:
        self.kind = kind
        self.is_tool = is_tool
        self.tool = tool
        #: The digits the tool word carries after the station: `T0101` -> `01`.
        self.offset = offset
        #: The `tool` match's `axis` group took part (Klartext's tool axis, `spec.axis_aware`
        #: only). False on every other profile, and false when `tool` is `None`.
        self.axis = axis
        self.description = description
        #: `tool` is written the way `toolCall.ignore` says a tool is unloaded (`T0`): a
        #: tool change that takes its tool from this preselection (`T0`, then `M6` alone)
        #: unloads the spindle, exactly as `M6 T0` on one line does.
        self.unload = unload


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
        "surface",
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
        #: M9: (unit text, code) of every surface speed of this tool, in order of first use.
        self.surface: List[Tuple[str, str]] = []

    def add_offset(self, offset: Optional[str]) -> None:
        if offset is not None and offset not in self.offsets:
            self.offsets.append(offset)

    def add(
        self, kind: str, key: str, value: Tuple[Decimal, str], line: int, note: Optional[Tuple[str, str]] = None
    ) -> None:
        """Records one feed or speed under the mode or unit it was written in.

        ``note`` is the unit text and the code of a surface speed (M9), for its range's tag.
        """
        found = self.by_mode if kind == "feed" else self.by_speed
        found.setdefault(key, []).append(value)
        self.first_line.setdefault("%s:%s" % (kind, key), line)
        if note is not None and note not in self.surface:
            self.surface.append(note)

    def surface_tag(self) -> str:
        """``m/min (G96)``: the unit and the code of this tool's surface speeds."""
        units: List[str] = []
        codes: List[str] = []
        for unit, code in self.surface:
            if unit not in units:
                units.append(unit)
            if code and code not in codes:
                codes.append(code)
        text = " and ".join(units) if units else "surface"
        return "%s (%s)" % (text, ", ".join(codes)) if codes else text

    def skip(self, reason: str, line: int) -> None:
        """Records one block whose value was left out of a range, and why."""
        entry = self.skipped.get(reason)
        if entry is None:
            self.skipped[reason] = [line, 1]
        else:
            entry[1] += 1


class Pending:
    """The feeds and speeds written since the last block that moved an axis.

    A value belongs to the tool that cuts with it, and that is not always the tool in the
    turret when the value is written: a post may set the speed of the next operation before
    it indexes the turret (`G97 S1500 M03` then `T0202`, the order the Okuma notes show).
    So a value waits here until an axis moves, and goes to the tool in use then — or, when a
    tool change comes first, to the new tool.
    """

    def __init__(self) -> None:
        self.calls: List[Tuple[Any, ...]] = []

    def add(
        self, kind: str, key: str, value: Tuple[Decimal, str], line: int, note: Optional[Tuple[str, str]] = None
    ) -> None:
        self.calls.append(("add", kind, key, value, line, note))

    def skip(self, reason: str, line: int) -> None:
        self.calls.append(("skip", reason, line))

    def hand_to(self, row: Optional["Row"]) -> None:
        """Gives every waiting value to ``row``; with no tool in use, they are dropped."""
        if row is not None:
            for call in self.calls:
                if call[0] == "add":
                    row.add(call[1], call[2], call[3], call[4], call[5])
                else:
                    row.skip(call[1], call[2])
        self.calls = []


def moves_an_axis(tokens: Sequence[gedit_nc.Token], spec: "Spec") -> bool:
    """True when the block writes a position: an axis word, or its incremental twin, with a value."""
    for token in tokens:
        if token.kind == "word" and token.value_text is not None and (token.address or "").upper() in spec.axes:
            return True
    return False


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
    ignored = ignore is not None and ignore.search(masked) is not None
    is_tool = cp.patterns["tool_trigger"].search(masked) is not None and not ignored
    tool: Optional[str] = None
    offset: Optional[str] = None
    axis = False
    if is_tool or spec.tool_from_last:
        match = cp.patterns["tool"].search(masked)
        if match is not None:
            group = group_of(match, "tool")
            # A group that took no part in the match is one the pattern made optional
            # (Klartext's tool number, so an axis or an `S` alone can still be read): no
            # fallback to the whole match, which would turn "no tool" into a garbage one.
            tool = group.strip() if group is not None and group != "" else None
            if tool is not None:
                offset = offset_of(match, masked)
            axis_group = group_of(match, "axis")
            axis = axis_group is not None and axis_group != ""

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
    return Mark(
        kind=kind,
        is_tool=is_tool,
        tool=tool,
        description=description,
        offset=offset,
        axis=axis,
        unload=tool is not None and ignored,
    )


def offset_of(match: Any, subject: str) -> Optional[str]:
    """The offset digits a tool word carries after its station, or ``None``.

    `T0101` is station 1 with offset 01, `T0111` the same station with offset 11, `T1` a
    station with no offset. What counts as the station is the pattern's ``tool`` group, so
    the offset is the run of digits the word carries straight after it — the profile
    decides, not a rule about four digits (plan §7.1). A pattern may take those digits into
    its match (the Fanuc lathe's `T0111`) or only look at them (a six-digit `T010203`, where
    the station `02` stands between the nose-radius set `01` and the offset `03`); either
    way they are the same digits of the same word. A profile whose pattern has no ``tool``
    group names the whole match, and then there is nothing left over.
    """
    if "tool" not in (match.re.groupindex or {}):
        return None
    try:
        end = match.end("tool")
    except IndexError:  # pragma: no cover - a group that did not take part
        return None
    if end < 0:
        return None
    stop = end
    while stop < len(subject) and subject[stop].isdigit():
        stop += 1
    return subject[end:stop] if stop > end else None


def quoted(tool: str) -> bool:
    """True for a tool written as a name in quotation marks (`T="ROUGH_80"`, `T="007"`)."""
    return len(tool) >= 2 and tool.startswith('"') and tool.endswith('"')


def bare_tool(tool: str, spec: Spec) -> str:
    """The tool as it identifies a station: quotes gone, a lathe offset pair collapsed.

    A name in quotation marks is a name, whatever characters it holds: it is never collapsed
    like an offset pair, because on a control with tool management `T="007"` names a tool
    and `T7` a place in the magazine, and the name is compared exactly as written.
    """
    if quoted(tool):
        return tool[1:-1]
    value = tool
    if spec.collapse_offset_digits and ALL_DIGITS.match(value) and len(value) >= 4 and len(value) % 2 == 0:
        value = value[: len(value) // 2]
    return value


def tool_label(tool: str, spec: Spec) -> str:
    """``T01`` → ``T1``, ``T0101`` → ``T1`` on a lathe profile, ``"MILL_D10"`` → ``MILL_D10``.

    ``gedit_nc.tool_label`` with this run's rules (M13, NC-9: the extents name their tool
    scopes with the same function, so both reports call one tool by one name).
    """
    return gedit_nc.tool_label(tool, spec.drop_leading_zeros, spec.collapse_offset_digits)


def tool_number_of(tool: str, spec: Spec) -> Optional[str]:
    """The tool's number for comparing, or ``None`` for a name or a ``QS`` parameter.

    Always without leading zeros, whatever the profile does for display: ``T01`` and ``T1``
    are the same station, and the header tool list may write either. A name in quotation
    marks has no number, digits or not.
    """
    if quoted(tool):
        return None
    value = bare_tool(tool, spec)
    return LEADING_ZEROS.sub("", value) if ALL_DIGITS.match(value) else None


def same_tool(a: str, b: str, spec: Spec) -> bool:
    """Whether ``a`` and ``b`` name the same station — the test a row is keyed by.

    A Klartext ``TOOL CALL`` matches "the tool already in the spindle" exactly when it
    would land in the same row: numerically for a number, literally for a name or ``QS``.
    """
    a_number = tool_number_of(a, spec)
    b_number = tool_number_of(b, spec)
    if a_number is not None or b_number is not None:
        return a_number == b_number
    return bare_tool(a, spec) == bare_tool(b, spec)


def is_speed_only(mark: Mark, previous_tool: Optional[str], spec: Spec) -> bool:
    """A speed-only ``TOOL CALL`` on an axis-aware profile (§5.1).

    True with no tool argument at all, or with the same tool as ``previous_tool`` and no
    axis named. Always ``False`` off an axis-aware profile, so no other dialect's ``M6`` or
    bare ``T`` is ever downgraded by it.
    """
    if not spec.axis_aware:
        return False
    if mark.tool is None:
        return True
    return not mark.axis and previous_tool is not None and same_tool(mark.tool, previous_tool, spec)


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


def range_text(values: Sequence[Tuple[Any, str]], unit: Optional[str] = None, tag: Optional[str] = None) -> str:
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
    tag = tag if tag is not None else UNIT_TAG.get(unit or "")
    return "%s %s" % (text, tag) if tag else text


def numeric(token: gedit_nc.Token) -> Optional[Decimal]:
    """The token's value as a comparable decimal, or ``None`` when it is not a number."""
    if token.value is None or token.value_text is None:
        return None
    # Not `Decimal(token.value.raw)`: a Klartext decimal comma stays in `raw` (`S5000,5`),
    # and `Decimal` refuses it, which left the speed and feed columns blank.
    return gedit_nc.decimal_of(token.value)


class Surface:
    """The code that put the surface speed in force, and the program's units (M9).

    Both come from the code database (``sets.speedUnit: 'surface'``, ``sets.units``), so a
    Sinumerik `G961` names itself and a Fanuc `G20` program reads its surface speeds in feet
    per minute; the units start from the document's machine.
    """

    def __init__(self, units: str) -> None:
        self.units = units if units in SURFACE_UNIT else "mm"
        self.code: Optional[str] = None

    def read(self, written: Sequence[Tuple[Dict[str, Any], str]]) -> None:
        """Takes what the codes a line just wrote say about the two (``FeedModeTracker.written``)."""
        for entry, _ in written:
            sets = as_dict(entry.get("sets"))
            if sets.get("units") in SURFACE_UNIT:
                self.units = sets["units"]
            if sets.get("speedUnit") == "surface" and isinstance(entry.get("code"), str):
                self.code = entry["code"]

    def note(self) -> Tuple[str, str]:
        return (SURFACE_UNIT[self.units], self.code or "")


def build(
    lines: Sequence[str],
    cp: gedit_nc.CompiledProfile,
    spec: Spec,
    codes: Sequence[Dict[str, Any]],
    base_line: int,
    preceding: Optional[Sequence[str]] = None,
    line_numbers: Optional[Sequence[int]] = None,
    listed_in: Optional[Sequence[str]] = None,
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

    ``line_numbers`` (M12) are the document line numbers of ``lines`` when they are not
    consecutive: the lines of one channel of a ``single-file`` program, which may lie in
    several sections (``gedit_nc.channel_line_numbers``). Without them line ``i`` is
    ``base_line + i``. ``listed_in`` are lines whose ``(T5  D12 ...)`` comments describe
    tools without being walked, the header of a program whose tools are called in sections.
    """
    marks: List[Optional[Mark]] = [classify(line, cp, spec) for line in lines]

    rows: List[Row] = []
    by_key: Dict[str, Row] = {}
    findings: List[Dict[str, Any]] = []
    from_list: Dict[str, str] = {}
    for text in listed_in or ():
        header = classify(text, cp, spec)
        if header is not None and header.kind in ("comment", "section"):
            listed = tool_list_entry(header.description)
            if listed is not None and listed[0] not in from_list:
                from_list[listed[0]] = listed[1]
    last_tool: Optional[str] = None
    #: That `T` word unloads the spindle (`T0`, `Mark.unload`).
    last_unload = False
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
    #: M9: the code that put the surface speed in force, and the program's units, for the
    #: tag of a surface-speed range (`220 m/min (G96)`).
    surface = Surface(spec.units)
    surface.read(tracker.written)
    state: Optional[gedit_nc.LineState] = None
    #: M13 (NC-4): the program starts seen so far, those above a selection included, and
    #: the programs after the first one, each with the feeds and speeds it writes before
    #: its first tool call (:func:`called_finding`).
    programs = 0
    called: Optional[Row] = None
    called_rows: List[Row] = []
    if preceding:
        # The codes above a selection are read for the same two answers.
        above = gedit_nc.FeedModeTracker(codes)
        above_state: Optional[gedit_nc.LineState] = None
        for text in preceding:
            above_tokens, above_state = gedit_nc.tokenize_line(text, cp, above_state)
            above.update(above_tokens, continued=gedit_nc.continues_block(text, cp))
            surface.read(above.written)
            if gedit_nc.program_start_of(text, cp) is not None:
                programs += 1
        state = gedit_nc.prime_tracker(tracker, preceding, cp, lines[0] if lines else None)
    #: Values written since the last move; they go to the tool that moves next.
    pending = Pending()

    for i, line in enumerate(lines):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        # An Okuma `$` line belongs to the block above it.
        tracker.update(tokens, continued=gedit_nc.continues_block(line, cp))
        surface.read(tracker.written)
        mark = marks[i]
        number_line = line_numbers[i] if line_numbers is not None else base_line + i

        start = gedit_nc.program_start_of(line, cp)
        if start is not None:
            programs += 1
            if programs > 1:
                # M13 (NC-4): a program after the first, most often a subprogram behind the
                # main program's `M30`. It runs with the tool of whatever calls it, which the
                # file does not say, so the tool of the program above is not its tool: what
                # it cuts with before its own first tool call is charged to no tool.
                pending.hand_to(None)
                current = None
                last_tool = None
                last_unload = False
                called = Row(label=start, number=None, line=number_line)
                called_rows.append(called)

        if mark is not None:
            # The tool in the spindle before this line, for `is_speed_only` — a Klartext
            # `TOOL CALL` that repeats it without an axis is a speed change, not a new call.
            previous_tool = last_tool
            if mark.tool is not None:
                last_tool = mark.tool
                last_unload = mark.unload
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

            # `T0` preselected, then `M6` alone: the tool change loads the pending `T0`, so
            # it unloads the spindle and is no tool change, as `M6 T0` on one line is not.
            unloads = mark.tool is None and spec.tool_from_last and last_unload
            if mark.is_tool and not unloads and not is_speed_only(mark, previous_tool, spec):
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
                    called = None
                    pending.hand_to(None)
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
                    # What was written since the last move was written for this tool.
                    pending.hand_to(row)
                    current = row
                    called = None

        if spec.feed_speed:
            collect(pending, tokens, tracker, spec, codes, number_line, surface.note())
            if moves_an_axis(tokens, spec):
                pending.hand_to(current if current is not None else called)
    pending.hand_to(current if current is not None else called)
    for program in called_rows:
        finding = called_finding(program, spec)
        if finding is not None:
            findings.append(finding)

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


def called_finding(program: Row, spec: Spec) -> Optional[Dict[str, Any]]:
    """M13 (NC-4): the feeds and speeds a program after the first writes before its first
    tool call, as one ``info`` finding at its start, or ``None`` when it writes none.

    ``program`` is a :class:`Row` that stands for the program (its label is the program
    start as written, ``O2``) and collects what no tool of the list cuts with.
    """
    parts: List[str] = []
    count = 0
    for kind, found in (("feed", program.by_mode), ("speed", program.by_speed)):
        written: List[str] = []
        total = 0
        for key, values in found.items():
            if kind == "feed":
                address = key if key in PER_TOOTH_ADDRESSES else spec.feed_address
            else:
                address = spec.spindle_address
            total += len(values)
            for _, text in values:
                word = address + text
                if word not in written:
                    written.append(word)
        if total:
            shown = ", ".join(written[:3]) + (" and %d more" % (len(written) - 3) if len(written) > 3 else "")
            parts.append("%d %s (%s)" % (total, kind if total == 1 else kind + "s", shown))
            count += total
    if not parts:
        return None
    return {
        "line": program.line,
        "severity": "info",
        "message": "%s: %s before any tool call; %s with the tool of the program that calls "
        "it, which the tool list cannot follow, so %s in no tool's range."
        % (program.label, " and ".join(parts), "it runs" if count == 1 else "they run", "it is" if count == 1 else "they are"),
    }


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
    row: Union[Row, Pending],
    tokens: Sequence[gedit_nc.Token],
    tracker: gedit_nc.FeedModeTracker,
    spec: Spec,
    codes: Sequence[Dict[str, Any]],
    line: int,
    note: Optional[Tuple[str, str]] = None,
) -> None:
    """Adds this block's feed and speed to ``row`` — or records why they were left out.

    ``note`` is the unit and the code of the surface speed in force (M9, :class:`Surface`).

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

    A feed or speed written as a variable or an expression (``F#101``, ``FQ50``, ``F=R1``)
    carries no number at all, so it is in neither the range nor the findings. Neither is a
    dwell (``fNotFeed``), nor a word under an address of its own: a clamp word (`LIMS=`), a
    spindle named by its number (`S3=`, or `S[3]=` with its index) or a driven tool's speed (`SB=`) is not the main
    spindle's `S`, and only that word is read as the speed a tool runs at — together with the
    words that name the main spindle by its number (`S1=`, `S[1]=` where the profile's
    `addresses.mainSpindle` is 1; P10, the owner's reading of 2026-09-27).
    """
    # A dwell block (`fNotFeed`: Okuma `G04 F2`, Sinumerik `G4 F2` and `G4 S2`) holds a time,
    # not a feed and not a speed. It belongs to no range and needs no finding: nobody reads
    # a dwell as the feed a tool cuts with.
    if tracker.f_not_feed:
        return

    pitch_reason: Optional[str] = None
    if tracker.pitch_feed:
        pitch_reason = lead_elsewhere(tracker, spec) or "pitch"
    elif tracker.pitch_feed_ambiguous:
        pitch_reason = "ambiguous"

    limit_code = gedit_nc.speed_limit_of(codes, tokens)
    speed_unit = "surface" if tracker.css else "rpm"

    for token in tokens:
        if token.kind != "word" or token.address is None:
            continue
        main = gedit_nc.names_main_spindle(token, spec.spindle_address, spec.main_spindle)
        if token.index is not None and not main:
            # `S[2]=500`, `LIMS[2]=1800` (`syntax.assignmentIndex`): the index names another
            # spindle, as `S2=` names one in its address, so it is no tool's speed (F1).
            continue
        value = numeric(token)
        if value is None:
            continue
        if main:
            # P10 (decision 3): `S1=900` and `S[1]=900` where spindle 1 is the main spindle
            # are the main spindle's speed, read like a plain `S` (a clamp block included).
            if limit_code is not None:
                row.skip("limit", line)
            else:
                row.add(
                    "speed", speed_unit, (value, token.value_text or ""), line,
                    note if speed_unit == "surface" else None,
                )
        elif token.address == spec.feed_address or token.address in PER_TOOTH_ADDRESSES:
            if pitch_reason is not None:
                row.skip(pitch_reason, line)
            else:
                row.add("feed", feed_mode_of(token, tracker), (value, token.value_text or ""), line)
        elif token.address == spec.spindle_address:
            if limit_code is not None:
                row.skip("limit", line)
            else:
                row.add(
                    "speed", speed_unit, (value, token.value_text or ""), line,
                    note if speed_unit == "surface" else None,
                )


def lead_elsewhere(tracker: gedit_nc.FeedModeTracker, spec: Spec) -> Optional[str]:
    """M13 (NC-13): ``'lead:<code>:<addresses>'`` when the thread code of this block takes its
    lead from words other than the feed word (Sinumerik `G33 Z-30 K1.5 F0.15`: I, J or K),
    else ``None``.

    The database declares a lead as a parameter whose unit is a feed per revolution, the
    reading scale-feed uses (``lead_addresses`` there). Such a block's F is neither its lead
    nor a feed it cuts with, so it stays out of the range under a finding of its own.
    """
    entry: Optional[Dict[str, Any]] = next(
        (written for written, _ in tracker.written if written.get("pitchFeed") is True), None
    )
    if entry is None:
        code = tracker.active_cycle or tracker.pitch_mode
        entry = tracker.entry(code) if code else None
    if not isinstance(entry, dict):
        return None
    leads = [
        param.get("address")
        for param in entry.get("params") or []
        if isinstance(param, dict) and param.get("unit") == "feedPerRev" and isinstance(param.get("address"), str)
    ]
    if not leads or any(address.upper() == spec.feed_address.upper() for address in leads):
        return None
    return "lead:%s:%s" % (entry.get("code") or "", ",".join(leads))


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
        elif reason.startswith("lead:"):
            # NC-13: the lead is another word, and the thread is not cut with this F.
            _, code, leads = reason.split(":", 2)
            words = leads.split(",")
            text = "the F of %s is not %s lead and is not cut with (%s takes its lead from %s)" % (
                "1 thread block" if count == 1 else "%d thread blocks" % count,
                "its" if count == 1 else "their",
                code,
                words[0] if len(words) == 1 else "%s or %s" % (", ".join(words[:-1]), words[-1]),
            )
        elif reason == "ambiguous":
            text = (
                "the F of %s may be a thread lead rather than a feed rate, because its "
                "code is a threading cycle on another kind of machine or in another "
                "G-code system"
                % blocks(count)
            )
        elif reason == "css":
            text = "the S of %s is a surface speed in %s, not a spindle speed" % (blocks(count), row.surface_tag())
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


class Group:
    """The lines of one channel (or of the lines no channel owns), ready for :func:`build`."""

    __slots__ = ("channel", "name", "lines", "numbers", "preceding")

    def __init__(
        self,
        channel: Optional[str],
        name: str,
        lines: List[str],
        numbers: List[int],
        preceding: Optional[List[str]],
    ) -> None:
        #: The channel id; ``None`` for the lines outside every channel.
        self.channel = channel
        self.name = name
        self.lines = lines
        #: The document line number of each of ``lines``.
        self.numbers = numbers
        self.preceding = preceding


OUTSIDE_NAME = "Outside the channels"


def channel_groups(
    context: Dict[str, Any],
    lines: Sequence[str],
    base_line: int,
    preceding: Sequence[str],
) -> Optional[List[Group]]:
    """One :class:`Group` per channel of a ``single-file`` document, plus the outside lines.

    ``None`` when the context has no sections to group by (no ``channels`` member, or the
    ``multi-file`` layout, whose document is one channel already): the caller then walks the
    whole input as it always did. A channel with no line inside the input (a selection that
    does not touch it) is left out. Lines outside every channel are a group of their own,
    last, and are listed only if a tool is called there — a shared subprogram, say.
    """
    member = gedit_nc.channels(context)
    if member["layout"] != "single-file":
        return None
    # The lines above a selection, cut to each channel the same way as the input is.
    above_context = {"channels": context.get("channels"), "input": {"scope": "document", "startLine": 1, "endLine": 0}}
    groups: List[Group] = []
    for entry in member["list"]:
        channel_id = entry.get("id")
        if not isinstance(channel_id, str):
            continue
        numbers = gedit_nc.channel_line_numbers(context, lines, channel_id)
        if not numbers:
            continue
        name = entry.get("name") if isinstance(entry.get("name"), str) and entry.get("name") else channel_id
        primed = None
        if preceding:
            kept = gedit_nc.channel_line_numbers(above_context, preceding, channel_id)
            primed = [preceding[number - 1] for number in kept] or None
        groups.append(Group(channel_id, name, [lines[n - base_line] for n in numbers], numbers, primed))
    if not groups:
        return None
    numbers = gedit_nc.outside_line_numbers(context, lines)
    if numbers:
        groups.append(Group(None, OUTSIDE_NAME, [lines[n - base_line] for n in numbers], numbers, None))
    return groups


def own_channel(context: Dict[str, Any]) -> Optional[str]:
    """The name of the channel this document is, for a one-file-per-channel machine."""
    member = gedit_nc.channels(context)
    if member["layout"] != "multi-file" or not isinstance(member["self"], str):
        return None
    for entry in member["list"]:
        if entry.get("id") == member["self"]:
            name = entry.get("name")
            return name if isinstance(name, str) and name else member["self"]
    return member["self"]


def grouped_summary(
    grouped: Sequence[Tuple[Optional[Group], List[Row]]], unnamed: int, tool_words: int, lathe: bool
) -> str:
    """``Channel 1: 3 tools; Channel 2: 2 tools, 1 without a description`` for the table above."""
    if not any(rows for _, rows in grouped):
        return summary([], unnamed, tool_words, lathe)
    parts: List[str] = []
    for group, rows in grouped:
        if group is None:
            continue
        if group.channel is None and not rows:
            continue
        label = group.name
        parts.append("%s: %s" % (label, summary(rows, 0).rstrip(".").replace("No tool changes found", "no tool changes")))
    return "; ".join(parts)


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
    machine_units = as_dict(gedit_nc.machine_params(context).get("params")).get("units")
    spec.units = machine_units if machine_units in SURFACE_UNIT else "mm"
    # The lines above a selection, when the context carries all of them; they prime the
    # feed-mode tracker and are not scanned for tool calls. See `build`.
    preceding = gedit_nc.preceding_lines(context)

    # M12 (AD-32): a program whose channels are sections of one file is listed per channel,
    # because a turret's tools are that turret's. A program without channels, and the
    # document of a one-file-per-channel machine, walk the whole input exactly as before.
    groups = channel_groups(context, lines, base_line, preceding)
    grouped: List[Tuple[Optional[Group], List[Row]]] = []
    findings: List[Dict[str, Any]] = []
    unnamed = tool_words = 0
    if groups is None:
        rows, findings, unnamed, tool_words = build(lines, cp, spec, codes, base_line, preceding)
        grouped.append((None, rows))
    else:
        outside = gedit_nc.outside_lines(context, lines)
        for group in groups:
            g_rows, g_findings, g_unnamed, g_words = build(
                group.lines, cp, spec, codes, base_line, group.preceding, group.numbers,
                outside if group.channel is not None else None,
            )
            grouped.append((group, g_rows))
            prefix = "%s: " % group.name
            findings.extend(dict(f, message=prefix + f["message"]) for f in g_findings)
            unnamed += g_unnamed
            tool_words += g_words
        findings.sort(key=lambda finding: finding["line"])
    rows = [row for _, g_rows in grouped for row in g_rows]

    # The offsets are a turret's, and a milling program has none: the column appears only
    # when a call carried one, so a mill report is exactly what it always was.
    offsets = any(row.offsets for row in rows)

    columns: List[Dict[str, str]] = []
    if groups is not None:
        columns.append({"key": "channel", "label": "Channel"})
    columns.append({"key": "tool", "label": "Tool"})
    if offsets:
        columns.append({"key": "offsets", "label": "Offsets"})
    columns.append({"key": "description", "label": "Description"})
    columns.append({"key": "line", "label": "First call"})
    columns.append({"key": "calls", "label": "Calls"})
    if spec.feed_speed:
        columns.append({"key": "feed", "label": "Feed"})
        columns.append({"key": "speed", "label": "Speed"})

    table: List[Dict[str, Any]] = []
    for group, g_rows in grouped:
        for row in g_rows:
            entry: Dict[str, Any] = {}
            if group is not None:
                entry["channel"] = group.name
            entry["tool"] = row.label
            if offsets:
                entry["offsets"] = ", ".join(row.offsets)
            entry["description"] = row.description or ""
            entry["line"] = row.line
            entry["calls"] = row.calls
            if spec.feed_speed:
                # NC-13: a range in another unit than the program's own says which.
                entry["feed"] = range_text(
                    row.feeds, row.feed_unit,
                    DEFAULT_UNIT_TAG.get(row.feed_unit or "") if row.feed_unit != spec.feed_unit else None,
                )
                entry["speed"] = range_text(
                    row.speeds, row.speed_unit,
                    row.surface_tag() if row.speed_unit == "surface"
                    else DEFAULT_UNIT_TAG.get(row.speed_unit or "") if row.speed_unit != spec.speed_unit else None,
                )
            table.append(entry)

    if groups is None:
        message = summary(rows, unnamed, tool_words, spec.lathe)
        own = own_channel(context)
        if own is not None:
            message = "%s. This document is %s; the other channels are separate runs." % (
                message.rstrip("."),
                own,
            )
    else:
        message = grouped_summary(grouped, unnamed, tool_words, spec.lathe)

    gedit_nc.report("Tool list", columns, table, message, findings)
    return 0


if __name__ == "__main__":
    sys.exit(main())

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

Two rules keep the answer honest:

* The trigger and tool patterns run over the **masked** line, so `(T1 M6)` inside a
  comment never becomes a tool change, and the feed and speed ranges are read off the
  **tokens**, so an `F` inside a comment or a string is not a feed.
* An `F` in a block whose cycle carries a thread pitch (`G84`, `CYCL DEF 207`) is a pitch,
  not a feed. Those blocks are left out of the feed range and reported as findings, the
  same rule scale-feed follows: a number that is not a feed must not be shown as one.

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

#: The feed mode a feed range is measured in; `FeedModeTracker` starts here.
PER_MINUTE = "G94"

#: Klartext writes a feed per revolution and a feed per tooth with their own address
#: (plan section 7.10). They are feeds, but not in millimetres per minute.
PER_TOOTH_ADDRESSES = ("FU", "FZ")

#: The ISO codes that write a spindle speed **limit** rather than a speed. A dialect
#: without G words never matches them, and scale-speed (WP4.7) has the same rule.
SPEED_LIMIT_CODES = ("G50", "G92")


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


class Mark:
    """What one line contributes. Mirrors the outline index's per-line classification."""

    __slots__ = ("kind", "is_tool", "tool", "description")

    def __init__(self, kind: Optional[str], is_tool: bool, tool: Optional[str], description: Optional[str]) -> None:
        self.kind = kind
        self.is_tool = is_tool
        self.tool = tool
        self.description = description


class Row:
    """One tool of the list, filled as the walk passes its calls."""

    __slots__ = ("label", "number", "line", "calls", "description", "feeds", "speeds", "skipped")

    def __init__(self, label: str, number: Optional[str], line: int) -> None:
        self.label = label
        self.number = number
        self.line = line
        self.calls = 0
        self.description: Optional[str] = None
        self.feeds: List[Tuple[Decimal, str]] = []
        self.speeds: List[Tuple[Decimal, str]] = []
        #: reason → (first line it happened on, how many blocks); see :func:`findings_of`.
        self.skipped: Dict[str, List[int]] = {}

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

    is_tool = cp.patterns["tool_trigger"].search(masked) is not None
    tool: Optional[str] = None
    if is_tool or spec.tool_from_last:
        match = cp.patterns["tool"].search(masked)
        if match is not None:
            group = group_of(match, "tool")
            tool = (group if group is not None and group != "" else match.group(0)).strip()

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
    return Mark(kind=kind, is_tool=is_tool, tool=tool, description=description)


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


def range_text(values: Sequence[Tuple[Any, str]]) -> str:
    """``[(Decimal, '400.'), …]`` → ``'400.'`` or ``'400.-1500.'``, as the file wrote them."""
    if not values:
        return ""
    low = min(values, key=lambda pair: pair[0])
    high = max(values, key=lambda pair: pair[0])
    return low[1] if low[1] == high[1] else "%s-%s" % (low[1], high[1])


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
) -> Tuple[List[Row], List[Dict[str, Any]], int, int]:
    """Walks the program once.

    Returns the rows in order of first use, the findings, how many tool changes carried
    no tool number at all, and how many tool words were seen anywhere — the last of which
    is what tells an empty report apart from a program that really uses no tools.
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
    state: Optional[gedit_nc.LineState] = None

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
                    if row.description is None:
                        row.description = describe_tool(marks, i + 1, number, from_list, spec)
                    current = row

        if current is not None and spec.feed_speed:
            collect(current, tokens, tracker, spec, number_line)

    # Nothing described the tool at its call, but the header tool list did.
    for row in rows:
        if row.description is None and row.number is not None:
            row.description = from_list.get(row.number)
        findings.extend(findings_of(row))

    # A program with tool words and no tool change at all. On the shipped Fanuc profile a
    # tool change is `M6`, which a turret lathe never writes: it changes tool with a bare
    # `T0101`. There is no lathe profile yet, so such a program is opened with the mill
    # one and used to get "No tool changes found." — which reads as "this program uses no
    # tools" (G8 M4). Say what was actually looked for instead.
    if not rows and tool_words:
        findings.append(
            {
                "line": first_tool_word,
                "severity": "warning",
                "message": "%s here, but no tool change: this dialect marks a tool change "
                "with a code of its own (M6 on the shipped Fanuc mill profile), and %s "
                "was written without one. A turret lathe changes tool with a bare T word "
                "and needs a lathe profile, which gEdit does not ship yet."
                % (
                    "A tool word" if tool_words == 1 else "%d tool words" % tool_words,
                    "it" if tool_words == 1 else "each of them",
                ),
            }
        )

    findings.sort(key=lambda finding: finding["line"])
    return rows, findings, unnamed, tool_words


def collect(
    row: Row,
    tokens: Sequence[gedit_nc.Token],
    tracker: gedit_nc.FeedModeTracker,
    spec: Spec,
    line: int,
) -> None:
    """Adds this block's feed and speed to ``row`` — or records why they were left out.

    A range only means something inside one mode, so a value that is measured in something
    else is not silently mixed in: a thread pitch (``G84``, ``CYCL DEF 207``) is not a
    feed, a per-revolution, inverse-time, per-tooth or per-revolution-Klartext feed is not
    a per-minute feed, a surface speed under ``G96`` is not a spindle speed and a
    ``G50``/``G92`` clamp is a limit and not a speed. Each of those is counted per tool and
    comes back as one finding.

    A feed or speed written as a variable or an expression (``F#101``, ``FQ50``) carries no
    number at all, so it is in neither the range nor the findings.
    """
    feed_reason: Optional[str] = None
    if tracker.pitch_feed:
        feed_reason = "pitch"
    elif tracker.feed_mode != PER_MINUTE:
        feed_reason = "mode:" + tracker.feed_mode

    speed_reason: Optional[str] = None
    if tracker.css:
        speed_reason = "css"
    elif any(
        token.kind == "word"
        and token.address is not None
        and gedit_nc.normalize_code(token.address + (token.value_text or "")) in SPEED_LIMIT_CODES
        for token in tokens
    ):
        speed_reason = "limit"

    for token in tokens:
        if token.kind != "word" or token.address is None:
            continue
        value = numeric(token)
        if value is None:
            continue
        if token.address == spec.feed_address or token.address in PER_TOOTH_ADDRESSES:
            if feed_reason is None and token.address == spec.feed_address:
                row.feeds.append((value, token.value_text or ""))
            else:
                row.skip(feed_reason or ("mode:" + token.address), line)
        elif token.address == spec.spindle_address:
            if speed_reason is None:
                row.speeds.append((value, token.value_text or ""))
            else:
                row.skip(speed_reason, line)


def blocks(count: int) -> str:
    """``1 block`` / ``4 blocks``, for the findings."""
    return "1 block" if count == 1 else "%d blocks" % count


def findings_of(row: Row) -> List[Dict[str, Any]]:
    """One finding per tool and reason, anchored at the first block it happened on."""
    out: List[Dict[str, Any]] = []
    for reason, (line, count) in sorted(row.skipped.items()):
        if reason == "pitch":
            text = "the F of %s is a thread pitch, not a feed rate" % blocks(count)
        elif reason == "css":
            text = "the S of %s is a surface speed (G96), not a spindle speed" % blocks(count)
        elif reason == "limit":
            text = "the S of %s is a speed limit, not a spindle speed" % blocks(count)
        else:
            text = "the feed of %s is in %s, not per minute" % (blocks(count), reason.split(":", 1)[1])
        out.append(
            {
                "line": line,
                "severity": "info",
                "message": "%s: %s, so it is not in the range." % (row.label, text),
            }
        )
    return out


def summary(rows: Sequence[Row], unnamed: int, tool_words: int = 0) -> str:
    """The one-line message above the table."""
    if not rows:
        if unnamed:
            return "No tool numbers found."
        if tool_words:
            return (
                "No tool change found, but %s. This profile reads a tool change as a code "
                "of its own; a lathe program that changes tool with a bare T word needs a "
                "lathe profile."
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
    rows, findings, unnamed, tool_words = build(lines, cp, spec, codes, base_line)

    columns = [
        {"key": "tool", "label": "Tool"},
        {"key": "description", "label": "Description"},
        {"key": "line", "label": "First call"},
        {"key": "calls", "label": "Calls"},
    ]
    if spec.feed_speed:
        columns.append({"key": "feed", "label": "Feed"})
        columns.append({"key": "speed", "label": "Speed"})

    table: List[Dict[str, Any]] = []
    for row in rows:
        entry: Dict[str, Any] = {
            "tool": row.label,
            "description": row.description or "",
            "line": row.line,
            "calls": row.calls,
        }
        if spec.feed_speed:
            entry["feed"] = range_text(row.feeds)
            entry["speed"] = range_text(row.speeds)
        table.append(entry)

    gedit_nc.report("Tool list", columns, table, summary(rows, unnamed, tool_words), findings)
    return 0


if __name__ == "__main__":
    sys.exit(main())

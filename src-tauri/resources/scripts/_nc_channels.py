"""The channels of a document, as a script sees them (plan §7.17, AD-32), the Python half.

``gedit_nc`` re-exports every public name below; a script must not import this module
directly.

Python never resolves channels itself: the app resolves them in TypeScript (sections,
marks, the channel a file is) and hands the result over as ``context["channels"]``
(``ScriptContextV2.channels``). This module only *reads* that member:

``layout``
    ``"single-file"`` (one document, several channels in sections) or ``"multi-file"``
    (one document per channel).
``self``
    the id of the channel this document is (``multi-file``); ``None`` in ``single-file``.
``list``
    one entry per declared channel: ``id``, ``name`` and, in ``single-file``, ``ranges``
    (``{"startLine", "endLine"}``, 1-based, inclusive, in document order, a channel may have
    several); in ``multi-file`` ``file``, ``path`` and ``open``.
``outside``
    ``single-file``: the ranges that belong to no channel (header, between sections, after
    the last section).
``marks``
    the blocking (and non-blocking) marks of **this** document: ``id``, ``line``,
    ``channel`` (``""`` outside every section), ``partners`` and ``blocking``.

The member is **absent** for a document without channels (no machine, a machine without
channel settings, a program no section start matches), and every function here answers an
empty result then, so a script written before M12 keeps working and a script written for
M12 runs on a single-channel document.

Lines: ``lines`` is what the script read from stdin. For a whole-document run line ``i`` of
the list is document line ``i + 1``; for a selection the first line is
``input.startLine``. The functions below follow that, so a selection run reads the part of
each channel inside the selection and never a line it was not given.

Standard library only, Python 3.9 syntax.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional, Sequence, Tuple

#: The layouts a context carries a ``channels`` member for.
LAYOUTS = ("single-file", "multi-file")

Range = Tuple[int, int]


def _empty() -> Dict[str, Any]:
    return {"layout": "none", "self": None, "list": [], "outside": [], "marks": []}


def _int(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _ranges_of(value: Any) -> List[Range]:
    """``[{"startLine", "endLine"}, ...]`` as ``(start, end)`` pairs; a malformed one is dropped."""
    out: List[Range] = []
    if not isinstance(value, list):
        return out
    for item in value:
        if not isinstance(item, dict):
            continue
        start, end = _int(item.get("startLine")), _int(item.get("endLine"))
        if start is None or end is None or start < 1 or end < start:
            continue
        out.append((start, end))
    return out


def _member(ctx: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(ctx, dict):
        return None
    member = ctx.get("channels")
    if not isinstance(member, dict) or member.get("layout") not in LAYOUTS:
        return None
    return member


def channels(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """``ctx["channels"]``, or ``{"layout": "none", "self": None, "list": [], "outside": [], "marks": []}``.

    The answer always has ``layout``, ``self``, ``list``, ``outside`` and ``marks`` (the
    last three empty lists when there is nothing), also for a document without channels, so
    a script can read any of them without checking. The answer is a copy.
    """
    member = _member(ctx)
    if member is None:
        return _empty()

    def dicts(key: str) -> List[Dict[str, Any]]:
        value = member.get(key)
        return [copy.deepcopy(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []

    return {
        "layout": member["layout"],
        "self": member.get("self") if isinstance(member.get("self"), str) else None,
        "list": dicts("list"),
        "outside": dicts("outside"),
        "marks": dicts("marks"),
    }


def _base_line(ctx: Dict[str, Any]) -> int:
    """The document line of ``lines[0]``: the selection's first line, else 1."""
    scope = ctx.get("input") if isinstance(ctx, dict) else None
    if isinstance(scope, dict) and scope.get("scope") == "selection":
        start = _int(scope.get("startLine"))
        if start is not None and start >= 1:
            return start
    return 1


def _channel_ranges(member: Dict[str, Any], channel_id: str) -> Optional[List[Range]]:
    """The ranges of a ``single-file`` channel, or None for an unknown id / another layout."""
    if member["layout"] != "single-file" or not isinstance(member.get("list"), list):
        return None
    for entry in member["list"]:
        if isinstance(entry, dict) and entry.get("id") == channel_id:
            return _ranges_of(entry.get("ranges"))
    return None


def channel_of(ctx: Dict[str, Any], line: int) -> Optional[str]:
    """The channel id that holds the 1-based document ``line``, or ``None``.

    ``single-file``: the first channel (declared order) one of whose ranges holds the line;
    ``None`` for a line in ``outside``. A section several channels share belongs to each of
    them and this answers the first. ``multi-file``: the whole document is one channel, so
    every line answers ``self``.
    """
    member = _member(ctx)
    number = _int(line)
    if member is None or number is None or number < 1:
        return None
    if member["layout"] == "multi-file":
        own = member.get("self")
        return own if isinstance(own, str) else None
    for entry in member.get("list", []) if isinstance(member.get("list"), list) else []:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
            continue
        for start, end in _ranges_of(entry.get("ranges")):
            if start <= number <= end:
                return entry["id"]
    return None


def _clip(ranges: Sequence[Range], count: int, base: int) -> List[int]:
    """The document line numbers of ``ranges`` that fall inside ``lines`` (``count`` of them
    starting at document line ``base``), in range order."""
    first, last = base, base + count - 1
    out: List[int] = []
    for start, end in ranges:
        lo, hi = max(start, first), min(end, last)
        if lo <= hi:
            out.extend(range(lo, hi + 1))
    return out


def channel_line_numbers(ctx: Dict[str, Any], lines: Sequence[str], channel_id: str) -> List[int]:
    """The document line numbers :func:`channel_lines` returns, one per line, same order.

    A script that reports a finding on a line of a channel needs the *document* line, not the
    index in the concatenation; this is the map.
    """
    member = _member(ctx)
    if member is None or not lines:
        return []
    base = _base_line(ctx)
    if member["layout"] == "multi-file":
        if member.get("self") != channel_id:
            return []
        return list(range(base, base + len(lines)))
    ranges = _channel_ranges(member, channel_id)
    if not ranges:
        return []
    return _clip(ranges, len(lines), base)


def channel_lines(ctx: Dict[str, Any], lines: Sequence[str], channel_id: str) -> List[str]:
    """Every range of one channel, concatenated in document order; never a line of ``outside``.

    This is what the control itself does when it separates a program into one program per
    turret: a channel with four sections reads as one continuous program. ``lines`` are the
    script's input (see the module text for a selection). An unknown channel, a context
    without channels, or in ``multi-file`` another channel than ``self`` answers ``[]``;
    in ``multi-file`` the channel that is ``self`` is the whole input.
    """
    member = _member(ctx)
    if member is None:
        return []
    if member["layout"] == "multi-file":
        return list(lines) if member.get("self") == channel_id else []
    base = _base_line(ctx)
    return [lines[number - base] for number in channel_line_numbers(ctx, lines, channel_id)]


def outside_lines(ctx: Dict[str, Any], lines: Sequence[str]) -> List[str]:
    """The lines no channel owns (header, between sections, trailing), in document order.

    ``single-file`` only; a ``multi-file`` document is one channel and has none.
    """
    member = _member(ctx)
    if member is None or member["layout"] != "single-file":
        return []
    base = _base_line(ctx)
    return [lines[number - base] for number in outside_line_numbers(ctx, lines)]


def outside_line_numbers(ctx: Dict[str, Any], lines: Sequence[str]) -> List[int]:
    """The document line numbers :func:`outside_lines` returns."""
    member = _member(ctx)
    if member is None or member["layout"] != "single-file" or not lines:
        return []
    return _clip(_ranges_of(member.get("outside")), len(lines), _base_line(ctx))


def sync_marks(ctx: Dict[str, Any], channel_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """The marks of this document, optionally of one channel only, in line order.

    Each is ``{"id", "line", "channel", "partners", "blocking"}`` (copies). Marks found
    outside every section have ``channel == ""`` and are listed only without ``channel_id``.
    """
    member = _member(ctx)
    if member is None or not isinstance(member.get("marks"), list):
        return []
    found = [
        dict(mark, partners=list(mark.get("partners") or []))
        for mark in member["marks"]
        if isinstance(mark, dict) and _int(mark.get("line")) is not None
        and (channel_id is None or mark.get("channel") == channel_id)
    ]
    found.sort(key=lambda mark: mark["line"])
    return found

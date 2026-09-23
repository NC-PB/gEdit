"""The modal half of :mod:`gedit_nc`: what is in force, block by block.

Split out of ``gedit_nc.py`` by the M6 prelude (P6); ``gedit_nc`` re-exports every public
name below, so a script keeps calling ``gedit_nc.FeedModeTracker`` and nothing it may call
has moved. This file is an implementation detail and a script must not import it directly.

NC is a modal language: ``G95``, a tapping cycle or ``G96`` stays in force until something
cancels it. A script that reads a block without that state reads it wrong — it scales a
thread lead it did not recognise, or a feed per revolution as a feed per minute.

**What is here.** :class:`ModalInterpreter` (plan §7.4, AD-19) is the one interpreter both
languages run; WP6.4 implemented it. It is driven entirely by the code database's ``sets``
members and by the profile, and **no rule in this file names a dialect**: a control is
described in ``src/lib/data``, never here. :class:`FeedModeTracker` is Phase 1's API and is
now a thin wrapper over the interpreter with its P1 attribute values (``'G94'``, ``'FU'``,
…), so every P1 script keeps working.

The rules, in one place, are AD-19; each is named in the code where it is applied.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from _nc_lex import CompiledProfile, LineState, Token, normalize_code, tokenize_line

#: The feed modes plan §7.10 names, for a run **without** a code database. With one, the
#: database decides (``sets.feedUnit``) and these are never consulted: on a lathe in G-code
#: system A, ``G94`` is a facing cycle and reading it as a feed mode would be wrong (F24).
_FEED_MODE_CODES = ("G93", "G94", "G95")
#: Constant surface speed on and off, again only for a run without a database.
_CSS_ON = "G96"
_CSS_OFF = "G97"
#: Klartext's feed per revolution and feed per tooth, which are addresses, not codes. The
#: profile carries them in ``addresses.feedUnitWords``; these are the P1 fallback names.
_KLARTEXT_FEED_MODES = ("FU", "FZ")
#: The address a plain feed is written with unless the profile says otherwise.
_FEED_ADDRESS = "F"

#: A feed unit -> the Phase 1 name for it. :class:`FeedModeTracker` answers in P1 names;
#: the interpreter thinks in units (plan §7.1 ``FeedUnit``).
_MODE_OF_UNIT = {"inverse-time": "G93", "per-minute": "G94", "per-rev": "G95", "per-tooth": "FZ"}

#: What a group value, a unit or a mode reads as while nothing has said anything.
UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# The code database, indexed
# ---------------------------------------------------------------------------

#: ``id(codes)`` -> (the list itself, its index). A script walks 100k lines and asks for the
#: same database on every one of them, so the index is built once per list. The list is kept
#: alive by the cache, which is what makes the ``id`` key safe: an id is only reused after
#: the object it named is gone, and this reference keeps it from going. A script process is
#: short-lived, so nothing is evicted.
_ENTRY_CACHE: Dict[int, Tuple[Any, Dict[str, Dict[str, Any]]]] = {}


def _build_index(codes: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Written code (normalized) -> database entry, aliases included, first one wins."""
    index: Dict[str, Dict[str, Any]] = {}
    for entry in codes or []:
        if not isinstance(entry, dict):
            continue
        code = entry.get("code")
        if not isinstance(code, str) or code == "":
            continue
        index.setdefault(normalize_code(code), entry)
        for alias in entry.get("aliases") or []:
            if isinstance(alias, str) and alias != "":
                index.setdefault(normalize_code(alias), entry)
    return index


def _entry_index(codes: Optional[Sequence[Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    """The index of ``codes``, built once per list object."""
    if not codes:
        return {}
    key = id(codes)
    cached = _ENTRY_CACHE.get(key)
    if cached is not None and cached[0] is codes:
        return cached[1]
    index = _build_index(codes)
    _ENTRY_CACHE[key] = (codes, index)
    return index


def _sets_of(entry: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The entry's ``sets`` member (plan §7.2), or an empty one."""
    if entry is None:
        return {}
    sets = entry.get("sets")
    return sets if isinstance(sets, dict) else {}


def speed_limit_of(
    codes: Optional[Sequence[Dict[str, Any]]], tokens: Sequence[Token]
) -> Optional[str]:
    """The code in ``tokens`` that makes **this block's** speed word a clamp, or ``None``.

    AD-19 rule 4: a ``sets.speedLimit`` entry (Fanuc system A ``G50``, system B ``G92``,
    Sinumerik ``G26``) says the ``S`` of its own block is a spindle-speed limit, not a
    speed. Which code that is belongs in the database, so a script asks here instead of
    carrying a list of its own (F24).

    The answer is the entry's **canonical** code, so ``G050`` and ``G50`` give ``'G50'``.
    """
    index = _entry_index(codes)
    if not index:
        return None
    for code in _codes_in(tokens, index):
        entry = index.get(normalize_code(code))
        if _sets_of(entry).get("speedLimit") is True:
            written = entry.get("code") if entry is not None else None
            return written if isinstance(written, str) and written != "" else code
    return None


def _next_code_token(tokens: Sequence[Token], start: int, count: int) -> Optional[Token]:
    """The next token that is not whitespace, or ``None``."""
    for i in range(start, count):
        if tokens[i].kind != "whitespace":
            return tokens[i]
    return None


def _codes_in(tokens: Sequence[Token], index: Dict[str, Dict[str, Any]]) -> List[str]:
    """Every code this block writes, in the order it wrote them.

    An ISO dialect writes a code as an address word (``G95`` is ``G`` + ``95``); Klartext
    writes it as a keyword, and a multi-word code carries its number in the next token
    (``CYCL DEF`` + ``207``), while a packed dialect already has it on the keyword itself
    (``GOTO100``). Both spellings end up as one written code here.
    """
    out: List[str] = []
    count = len(tokens)
    for i, token in enumerate(tokens):
        if token.kind == "word":
            address = token.address or ""
            if address != "":
                out.append(address + (token.value_text or ""))
        elif token.kind == "keyword":
            name = token.address or token.text
            number = token.value_text
            if number is None:
                nxt = _next_code_token(tokens, i + 1, count)
                if nxt is not None and nxt.address is None and nxt.value_text is not None:
                    number = nxt.value_text
            joined = "%s %s" % (name, number) if number is not None else None
            if joined is not None and normalize_code(joined) in index:
                out.append(joined)
            else:
                out.append(name)
    return out


# ---------------------------------------------------------------------------
# The modal interpreter (plan §7.4, AD-19)
# ---------------------------------------------------------------------------


def _word_seen(token: Token, line: int) -> Dict[str, Any]:
    """A ``WordSeen`` (§7.4): the value **as written**, its line, and whether it is one.

    ``variable`` is true for ``F#101`` and Klartext ``FQ50``: the word has a value text but
    no numeric literal behind it, so nothing may convert or compare it.
    """
    return {
        "valueText": token.value_text or "",
        "line": line,
        "variable": token.value is None,
    }


class ModalInterpreter:
    """What is in force after each block, read from the code database and the profile.

    Feed a line's tokens to :meth:`update` in program order and read :attr:`state`. The
    rules are AD-19 and they are rules about *data*:

    1. a ``modal`` entry becomes the active code of its ``group``; its ``sets`` (§7.2)
       update the derived units;
    2. ``sets.cycle: 'start'`` on a ``modal`` entry makes it the active cycle; on a
       **non-modal** entry (the Fanuc lathe ``G70``–``G76``) it applies to its own block
       only, so it shows up in ``block`` and never in ``activeCycle``. ``'cancel'`` clears
       the active cycle;
    3. a ``motion`` entry without ``sets.cycle`` clears the active cycle, unless it carries
       ``pitchFeed`` — then it becomes the active cycle with a pitch feed until the next
       motion code;
    4. ``sets.speedLimit`` makes **this block's** speed word a clamp, not a speed;
    5. ``addresses.feedUnitWords`` switch the feed unit by word (Klartext ``FU`` / ``FZ``);
       a plain feed word returns to the unit the modal group gives;
    6. ``fNotFeed`` makes the block's feed word a time, not a feed (M8);
    7. a tool line (``toolCall.trigger``, not ``toolCall.ignore``) sets the tool;
    8. :meth:`reset` applies the **effective** profile's power-on state — ``modal.initial``,
       ``modal.units`` and ``modal.diameter`` — each assumed, at line 0, with the source
       ``modal.sources`` gives. Nothing else is assumed: a group stays unknown until it is
       set, with the one exception that a database declaring **no** ``sets.distance``
       anywhere gives ``distance: 'absolute'`` — not assumed, it is the only reading that
       database allows;
    9. an unknown code changes nothing;
    10. whether a word of ``addresses.diameter`` is a diameter or a radius follows the
        diameter mode **and** the distance mode (:meth:`diameter_reading`); a consumer asks
        for that answer, never for the mode alone.

    It never reads a machine configuration: everything machine-specific arrives in the
    **effective** profile it is given (AD-31), which is why a golden pins a behaviour by
    naming the machine parameters it runs with (§7.4).

    **A block, not a line.** :meth:`update` takes one line, but a Klartext block runs over
    several of them with ``~`` continuations. A continued line belongs to the block above
    it: ``block`` is not cleared, and a one-shot cycle of rule 2 stays in force to the end
    of its parameter list.
    """

    def __init__(self, cp: CompiledProfile, codes: "Sequence[Dict[str, Any]]") -> None:
        self.cp = cp
        self.codes = list(codes or [])
        #: Written code (normalized) -> database entry, aliases included.
        self._entries: Dict[str, Dict[str, Any]] = _build_index(self.codes)

        profile = getattr(cp, "profile", None)
        self._profile: Dict[str, Any] = profile if isinstance(profile, dict) else {}
        self._patterns: Dict[str, Any] = getattr(cp, "patterns", None) or {}

        addresses = self._profile.get("addresses")
        addresses = addresses if isinstance(addresses, dict) else {}
        feed = addresses.get("feed")
        self._feed_address = feed.upper() if isinstance(feed, str) and feed != "" else _FEED_ADDRESS
        spindle = addresses.get("spindle")
        self._speed_address = spindle.upper() if isinstance(spindle, str) and spindle != "" else "S"
        words = addresses.get("feedUnitWords")
        self._feed_unit_words: Dict[str, str] = (
            {str(k).upper(): str(v) for k, v in words.items() if isinstance(k, str)}
            if isinstance(words, dict)
            else {}
        )
        limits = addresses.get("speedLimitWords")
        self._speed_limit_words = (
            frozenset(str(w).upper() for w in limits if isinstance(w, str))
            if isinstance(limits, list)
            else frozenset()
        )
        self._diameter_words = diameter_axes(self._profile)

        tool_call = self._profile.get("toolCall")
        tool_call = tool_call if isinstance(tool_call, dict) else {}
        self._tool_from_last = tool_call.get("toolFrom") == "same-line-or-last"

        #: A database with no ``sets.distance`` anywhere allows only one reading (rule 8).
        self._has_distance = any(
            _sets_of(entry).get("distance") in ("absolute", "incremental") for entry in self.codes
        )
        self.reset()

    # -- the power-on state -------------------------------------------------

    def reset(self) -> None:
        """Back to the power-on state of the effective profile (rule 8)."""
        modal = self._profile.get("modal")
        modal = modal if isinstance(modal, dict) else {}
        sources = modal.get("sources")
        sources = sources if isinstance(sources, dict) else {}

        self._groups: Dict[str, Dict[str, Any]] = {}
        self._feed_unit_group = UNKNOWN
        self._feed_unit_word: Optional[str] = None
        self._speed_unit = UNKNOWN
        self._plane = UNKNOWN
        # Rule 8: a database that declares no distance code at all leaves one reading, and
        # that is not an assumption — it is the only thing the database allows.
        self._distance = UNKNOWN if self._has_distance else "absolute"

        self._tool: Optional[Dict[str, Any]] = None
        self._last_tool: Optional[Dict[str, Any]] = None
        self._feed: Optional[Dict[str, Any]] = None
        self._speed: Optional[Dict[str, Any]] = None
        self._speed_limit: Optional[Dict[str, Any]] = None
        self._active_cycle: Optional[Dict[str, Any]] = None
        self._modal_ambiguous: Optional[str] = None
        self._block_ambiguous: Optional[str] = None
        # Before the power-on codes below, which are applied through `_apply_sets` and may
        # touch the block's flags.
        self._block = _empty_block()
        #: True while the line just applied ends in a continuation: the next one is the
        #: same block (a Klartext ``~`` parameter list).
        self._continued = False

        # Nothing said anything yet, so nothing is assumed either; a profile without the
        # diameter parameter (a mill) has no diameter mode at all.
        self._units: Dict[str, Any] = {"value": UNKNOWN, "line": 0, "assumed": False, "from": None}
        self._diameter: Optional[Dict[str, Any]] = None

        initial = modal.get("initial")
        if isinstance(initial, dict):
            for group in sorted(initial):
                code = initial[group]
                if not isinstance(group, str) or group == "" or not isinstance(code, str):
                    continue
                source = sources.get(group)
                self._groups[group] = {
                    "code": code,
                    "line": 0,
                    "assumed": True,
                    "from": source if isinstance(source, str) else None,
                }
                # The power-on code carries its own meaning: a lathe that powers on in
                # `G99` powers on in feed per revolution, and the derived units have to say
                # so from line 0 on.
                self._apply_sets(_sets_of(self._entries.get(normalize_code(code))), 0, assumed=True)

        # `modal.units` and `modal.diameter` are what `applyMachine` wrote (AD-31), so they
        # are the authority and they carry their own source.
        units = modal.get("units")
        if units in ("mm", "inch"):
            source = sources.get("units")
            self._units = {
                "value": units,
                "line": 0,
                "assumed": True,
                "from": source if isinstance(source, str) else None,
            }
        diameter = modal.get("diameter")
        if diameter in ("on", "off", "absolute-only"):
            source = sources.get("diameter")
            self._diameter = {
                "mode": diameter,
                "line": 0,
                "assumed": True,
                "from": source if isinstance(source, str) else None,
            }

    # -- one block ----------------------------------------------------------

    def update(self, tokens: "Sequence[Token]", line: int, masked: str = "") -> None:
        """Applies one line. ``masked`` is the line with its comments masked, for rule 7.

        Without ``masked`` the tool rule is not applied — a caller that does not need the
        tool (:class:`FeedModeTracker`) does not have to mask every line to use the rest.
        """
        continued = self._continued
        self._continued = any(token.kind == "continuation" for token in tokens)
        if not continued:
            # The flags of a block belong to that block. A continued line is the same
            # block, so they are kept and added to instead.
            self._block = _empty_block()
            self._block_ambiguous = None

        # Two passes, because a block is not a sentence: `G50 S2500` and `S2500 G50` mean
        # the same thing, so every code of the block is applied before a single address
        # word is read (rules 4 and 6 both depend on it).
        for code in _codes_in(tokens, self._entries):
            self._apply_code(code, line)
        self._apply_words(tokens, line)
        if masked:
            self._apply_tool(masked, line)

    def _apply_code(self, code: str, line: int) -> None:
        entry = self._entries.get(normalize_code(code))
        if entry is None:
            return  # rule 9: an unknown code changes nothing
        canonical = entry.get("code")
        canonical = canonical if isinstance(canonical, str) and canonical != "" else code
        group = entry.get("group")
        group = group if isinstance(group, str) and group != "" else None
        sets = _sets_of(entry)
        modal = entry.get("modal") is True
        ambiguous = entry.get("pitchFeedAmbiguous") is True
        pitch = entry.get("pitchFeed") is True

        # Rule 1: a modal entry becomes the active code of its group.
        if modal and group is not None:
            self._groups[group] = {"code": canonical, "line": line, "assumed": False, "from": None}

        self._apply_sets(sets, line, assumed=False)

        # Rule 6: the block's feed word is a time here, not a feed.
        if entry.get("fNotFeed") is True:
            self._block["fNotFeed"] = True

        cycle = sets.get("cycle")
        if cycle == "cancel":
            # Rule 2: the cycle is off, and with it the ambiguity it was carrying.
            self._active_cycle = None
            self._modal_ambiguous = None
            return
        if cycle == "start":
            # Rule 2. A non-modal start is a flag of this block and nothing more: it does
            # not become the active cycle, and it does not cancel one either — a one-shot
            # cycle and a modal one are different groups on the control as well.
            self._block["cycle"] = canonical
            if pitch:
                self._block["pitchFeed"] = True
            if modal:
                self._active_cycle = {"code": canonical, "line": line, "pitchFeed": pitch}
                self._modal_ambiguous = canonical if ambiguous else None
            elif ambiguous:
                self._block_ambiguous = canonical
            return
        if group == "motion":
            # Rule 3. A threading pass is a move whose feed is a lead, so it does not
            # cancel — it becomes the cycle. A move whose meaning is ambiguous
            # (`pitchFeedAmbiguous`) is treated the same way rather than as a plain move,
            # because reading a thread lead as a feed is the mistake that scraps a part.
            if pitch or ambiguous:
                self._block["cycle"] = canonical
                if pitch:
                    self._block["pitchFeed"] = True
                self._active_cycle = {"code": canonical, "line": line, "pitchFeed": pitch}
                self._modal_ambiguous = canonical if ambiguous else None
            else:
                self._active_cycle = None
                self._modal_ambiguous = None
            return
        if ambiguous:
            # A code that is neither a cycle nor a move (Fanuc `G92` on a mill): its
            # meaning, and with it the meaning of the block's feed word, belongs to this
            # block alone.
            self._block_ambiguous = canonical

    def _apply_sets(self, sets: Dict[str, Any], line: int, assumed: bool) -> None:
        """What a code switches on (§7.2): the derived units of the state."""
        if not sets:
            return
        feed_unit = sets.get("feedUnit")
        if isinstance(feed_unit, str) and feed_unit != "":
            self._feed_unit_group = feed_unit
            # A modal feed mode ends a feed set by word: the two answer the same question.
            self._feed_unit_word = None
        speed_unit = sets.get("speedUnit")
        if speed_unit in ("rpm", "surface"):
            self._speed_unit = speed_unit
        distance = sets.get("distance")
        if distance in ("absolute", "incremental"):
            self._distance = distance
        plane = sets.get("plane")
        if plane in ("XY", "ZX", "YZ"):
            self._plane = plane
        units = sets.get("units")
        if units in ("mm", "inch"):
            self._units = {"value": units, "line": line, "assumed": assumed, "from": None}
        diameter = sets.get("diameter")
        if diameter in ("on", "off", "absolute-only"):
            self._diameter = {"mode": diameter, "line": line, "assumed": assumed, "from": None}
        if sets.get("speedLimit") is True:
            # Rule 4: of this block, whatever order the words are written in.
            self._block["speedLimit"] = True

    def _apply_words(self, tokens: "Sequence[Token]", line: int) -> None:
        """The address words of the block: the feed, the speed and the clamp."""
        for token in tokens:
            if token.kind != "word":
                continue
            address = (token.address or "").upper()
            if address == "":
                continue
            if address in self._feed_unit_words:
                # Rule 5: the word says which unit its own value is in.
                self._feed_unit_word = address
                self._feed = _word_seen(token, line)
            elif address == self._feed_address:
                # Rule 5: a plain feed word returns to the unit the modal group gives.
                self._feed_unit_word = None
                # Rule 6: in an `fNotFeed` block this word is a dwell, not a feed, so the
                # last feed the program set stays what it was.
                if not self._block["fNotFeed"]:
                    self._feed = _word_seen(token, line)
            elif address in self._speed_limit_words:
                self._speed_limit = _word_seen(token, line)
            elif address == self._speed_address:
                if self._block["speedLimit"]:
                    self._speed_limit = _word_seen(token, line)
                else:
                    self._speed = _word_seen(token, line)

    def _apply_tool(self, masked: str, line: int) -> None:
        """Rule 7: the tool of a tool line, as the profile's patterns read it."""
        trigger = self._patterns.get("tool_trigger")
        if trigger is None:
            return
        ignore = self._patterns.get("tool_ignore")
        is_tool = trigger.search(masked) is not None and not (
            ignore is not None and ignore.search(masked) is not None
        )
        found: Optional[Dict[str, Any]] = None
        pattern = self._patterns.get("tool")
        if pattern is not None and (is_tool or self._tool_from_last):
            match = pattern.search(masked)
            if match is not None:
                # `groupdict` rather than `group('tool')`: a profile whose `toolCall.tool`
                # has no named group is legal (the whole match is then the tool).
                station = match.groupdict().get("tool")
                written = match.group(0).strip()
                if station is None or station.strip() == "":
                    station = written
                found = {"station": station.strip(), "written": written, "line": line}
        if found is not None:
            self._last_tool = found
        if not is_tool:
            return
        self._block["toolChange"] = True
        if found is not None:
            self._tool = found
        elif self._tool_from_last and self._last_tool is not None:
            # `toolFrom: same-line-or-last`: the station was written on an earlier line
            # (`T5` / `M6`), so the tool line names it by standing after it.
            self._tool = {
                "station": self._last_tool["station"],
                "written": self._last_tool["written"],
                "line": line,
            }

    # -- what is in force ---------------------------------------------------

    @property
    def state(self) -> Dict[str, Any]:
        """The ``ModalState`` of §7.4, in the same camelCase keys TypeScript uses.

        A copy: nothing a caller does to the answer reaches the interpreter.
        """
        return {
            "groups": {group: dict(value) for group, value in self._groups.items()},
            "feedUnit": self.feed_unit,
            "speedUnit": self._speed_unit,
            "distance": self._distance,
            "units": dict(self._units),
            "plane": self._plane,
            "diameter": dict(self._diameter) if self._diameter is not None else None,
            "tool": dict(self._tool) if self._tool is not None else None,
            "feed": dict(self._feed) if self._feed is not None else None,
            "speed": dict(self._speed) if self._speed is not None else None,
            "speedLimit": dict(self._speed_limit) if self._speed_limit is not None else None,
            "activeCycle": dict(self._active_cycle) if self._active_cycle is not None else None,
            "pitchFeedAmbiguous": self.pitch_feed_ambiguous,
            "block": dict(self._block),
        }

    @property
    def feed_unit(self) -> str:
        """``'per-minute'``, ``'per-rev'``, ``'per-tooth'``, ``'inverse-time'`` or unknown.

        A word (Klartext ``FU`` / ``FZ``) wins over the modal group while it is in force
        (rule 5).
        """
        if self._feed_unit_word is not None:
            return self._feed_unit_words.get(self._feed_unit_word, UNKNOWN)
        return self._feed_unit_group

    @property
    def speed_unit(self) -> str:
        """``'rpm'``, ``'surface'`` or unknown."""
        return self._speed_unit

    @property
    def tool(self) -> Optional[Dict[str, Any]]:
        """The tool of the last tool line, or ``None``."""
        return dict(self._tool) if self._tool is not None else None

    @property
    def active_cycle(self) -> Optional[str]:
        """The modally active cycle's code, or ``None``.

        A one-shot cycle (rule 2) is **not** here: it is in ``block['cycle']``, because it
        is over when its block is.
        """
        return self._active_cycle["code"] if self._active_cycle is not None else None

    @property
    def pitch_feed(self) -> bool:
        """The feed word of this block is a thread lead, not a feed rate."""
        if self._block["pitchFeed"]:
            return True
        return self._active_cycle is not None and bool(self._active_cycle["pitchFeed"])

    @property
    def pitch_feed_ambiguous(self) -> Optional[str]:
        """The code that makes this block's feed word ambiguous, or ``None``.

        A code of this block names itself; a modal cycle names itself only while no code in
        this block already did.
        """
        return self._block_ambiguous or self._modal_ambiguous

    @property
    def block_speed_limit(self) -> bool:
        """This block's speed word is a clamp, not a speed (rule 4)."""
        return bool(self._block["speedLimit"])

    @property
    def block_f_not_feed(self) -> bool:
        """This block's feed word is a time, not a feed (rule 6)."""
        return bool(self._block["fNotFeed"])

    def entry(self, code: str) -> Optional[Dict[str, Any]]:
        """The database entry for a written code, following aliases, or ``None``."""
        return self._entries.get(normalize_code(code)) if code else None

    def diameter_reading(self, address: Optional[str] = None) -> str:
        """AD-19 rule 11: is such a word a ``'diameter'``, a ``'radius'`` or unknown?

        The mode alone does not answer it. ``'absolute-only'`` (Sinumerik ``DIAM90``) is a
        diameter while the distance mode is absolute and a radius while it is incremental,
        so a program that switches ``G90`` / ``G91`` switches this with it. Every consumer
        that compares, converts or explains such a value asks here.

        With an ``address``, a word the profile does not list under ``addresses.diameter``
        is always a ``'radius'`` — it was never a diameter to begin with.
        """
        if address is not None and address.upper() not in self._diameter_words:
            return "radius"
        if self._diameter is None:
            # A profile without the parameter: every coordinate is what it says it is.
            return "radius"
        mode = self._diameter["mode"]
        if mode == "on":
            return "diameter"
        if mode == "off":
            return "radius"
        if self._distance == "absolute":
            return "diameter"
        if self._distance == "incremental":
            return "radius"
        return UNKNOWN


def _empty_block() -> Dict[str, Any]:
    """The per-block flags of §7.4, as a block that has said nothing yet."""
    return {
        "cycle": None,
        "pitchFeed": False,
        "speedLimit": False,
        "fNotFeed": False,
        "toolChange": False,
    }


# ---------------------------------------------------------------------------
# Phase 1's tracker, on top of the interpreter
# ---------------------------------------------------------------------------


class FeedModeTracker:
    """Which feed and speed modes are active, block by block.

    Feed a line's tokens to :meth:`update` in program order and read the attributes
    afterwards. A run over a **selection** does not start at the top of the program:
    prime the tracker with :func:`prime_tracker` before the first :meth:`update`, or the
    state above the selection is read as the state at the top of a program. What it
    tracks:

    * ``feed_mode`` — ``'G94'`` (units per minute, the default), ``'G95'`` (per
      revolution), ``'G93'`` (inverse time), or Klartext's ``'FU'`` / ``'FZ'``. A plain
      ``F`` word ends an ``FU`` / ``FZ`` mode and leaves an ISO mode alone.
    * ``css`` — ``True`` between ``G96`` and ``G97``: ``S`` is a surface speed, not rpm.
    * ``active_cycle`` — the cycle code that is active in this block, or ``None``.
    * ``pitch_feed`` — ``True`` while the block's ``F`` word is a thread pitch (tapping,
      ``G84``). Scaling such an ``F`` would change the thread, so scale-feed skips these
      blocks and reports them.
    * ``pitch_feed_ambiguous`` — ``True`` while a code is in force whose database entry
      says the same number is a **threading cycle somewhere else** — on another kind of
      machine, or in another G-code system of this dialect (``pitchFeedAmbiguous``: Fanuc
      ``G76`` and ``G92`` on the mill, ``G74`` and ``G78`` on the lathe, ``G92`` in
      G-code system B). The ``F`` of such a block is a boring feed on a mill and a thread
      lead on a lathe, and nothing in the block says which — so a scaling script refuses
      it and says why. ``ambiguous_code`` names the code that raised it.

    **M6: this is a wrapper.** The rules live in :class:`ModalInterpreter` and come out of
    the code database (plan AD-19), so a lathe in G-code system A — where ``G98`` / ``G99``
    are the feed modes and ``G94`` is a facing cycle — is read correctly without a script
    changing a line (F24). The attribute **values** are Phase 1's, so every script written
    against §7.10 keeps working:

    * ``feed_mode`` is the P1 name of the feed unit in force (per revolution is ``'G95'``
      whether the program wrote ``G95`` or a lathe's ``G99``), or the feed word itself
      while one is in force (``'FU'``, ``'FZ'``), and ``'G94'`` while nothing is known —
      which is where Phase 1 started;
    * ``active_cycle`` and ``pitch_feed`` cover a one-shot cycle for the length of its own
      block, Klartext's ``~`` parameter lists included, which is what P1 reported;
    * without a code database the P1 names ``G93`` / ``G94`` / ``G95`` and ``G96`` /
      ``G97`` are still read, so an unknown dialect degrades the way it did rather than
      going silent. With a database, the database alone decides.
    """

    feed_mode: str
    css: bool
    active_cycle: Optional[str]
    pitch_feed: bool
    pitch_feed_ambiguous: bool
    ambiguous_code: Optional[str]

    def __init__(self, codes: Optional[Sequence[Dict[str, Any]]] = None) -> None:
        """``codes`` is the context's code database (``CodeEntry`` dictionaries)."""
        # The tracker is constructed from a database alone — a P1 signature, and one every
        # bundled script uses — so the interpreter gets an empty compiled profile. It then
        # assumes nothing at all, which is exactly what P1 did.
        self._interp = ModalInterpreter(CompiledProfile(profile={}), codes or ())
        self._entries = self._interp._entries
        self._line = 0
        self.reset()

    def reset(self) -> None:
        """Back to the state at the top of a program."""
        self._interp.reset()
        self._line = 0
        self._fallback_feed_mode: Optional[str] = None
        self._fallback_css = False
        self._old_cycle: Optional[str] = None
        self._old_pitch = False
        self._old_ambiguous: Optional[str] = None
        self._publish()

    def entry(self, code: str) -> Optional[Dict[str, Any]]:
        """The database entry for a written code, following aliases, or ``None``."""
        return self._interp.entry(code)

    def update(self, tokens: Sequence[Token]) -> None:
        """Applies one block's tokens. Call it for every line, in order."""
        self._line += 1
        self._interp.update(tokens, self._line)
        self._apply_fallbacks(tokens)
        self._publish()

    def _apply_fallbacks(self, tokens: Sequence[Token]) -> None:
        """Phase 1's own rules, for the parts of a database that predate ``sets``.

        Two of them, and both only where Phase 2's data says nothing:

        * **codes the database does not have.** A context without a code database (a
          dialect gEdit does not ship, or a v1 script run) still has to read ``G95`` and
          ``G96``, because plan §7.10 names them. A code the database *does* know is left
          to the database: that is what makes a lathe's ``G94`` a facing cycle rather than
          a feed mode (F24).
        * **cycle entries written without a ``sets`` member.** ``sets`` is new in Phase 2
          (§7.2); an entry without one is a Phase 1 entry — a hand-written database in a
          user script, or a context built before M6 — and the only reading that can be
          right for it is Phase 1's: a ``cycle`` entry that declares parameters, a pitch
          feed or an ambiguity **starts** a cycle, one that declares none of them cancels
          it, and a ``motion`` entry cancels it unless it carries a pitch of its own. An
          entry that *has* a ``sets`` member says what it does and nothing is inferred
          from it, so the shipped databases never reach this path.
        """
        for code in _codes_in(tokens, self._entries):
            key = normalize_code(code)
            entry = self._entries.get(key)
            if entry is None:
                if key in _FEED_MODE_CODES:
                    self._fallback_feed_mode = key
                elif key in (_CSS_ON, _CSS_OFF):
                    self._fallback_css = key == _CSS_ON
                continue
            self._apply_old_cycle_rules(entry, key)
        for token in tokens:
            if token.kind != "word":
                continue
            address = (token.address or "").upper()
            if address in _KLARTEXT_FEED_MODES and address not in self._interp._feed_unit_words:
                self._fallback_feed_mode = address
            elif address == self._interp._feed_address and self._fallback_feed_mode in _KLARTEXT_FEED_MODES:
                self._fallback_feed_mode = "G94"

    def _apply_old_cycle_rules(self, entry: Dict[str, Any], key: str) -> None:
        """Phase 1's cycle inference, for an entry that carries no ``sets`` member."""
        group = entry.get("group")
        has_sets = isinstance(entry.get("sets"), dict)
        pitch = entry.get("pitchFeed") is True
        ambiguous = entry.get("pitchFeedAmbiguous") is True
        if group not in ("cycle", "motion"):
            return
        if has_sets:
            # The entry says what it does, so the interpreter owns the cycle state from
            # here on and the Phase 1 one is dropped. Dropping it on a *start* as well as
            # on a cancel is what keeps a mixed database honest: a `G32` read the Phase 1
            # way must not still stand once a `G76` that carries `sets` has taken over.
            self._clear_old_cycle()
            return
        if group == "cycle":
            starts = bool(entry.get("params")) or pitch or ambiguous
        else:
            starts = pitch or ambiguous
        if starts:
            self._old_cycle, self._old_pitch = key, pitch
            self._old_ambiguous = key if ambiguous else None
        else:
            self._clear_old_cycle()

    def _clear_old_cycle(self) -> None:
        self._old_cycle = None
        self._old_pitch = False
        self._old_ambiguous = None

    def _publish(self) -> None:
        """The interpreter's state, in Phase 1's attribute values."""
        interp = self._interp
        unit = interp.feed_unit
        word = interp._feed_unit_word
        if word is not None:
            # A feed unit set by a word is named by that word (`FU`, `FZ`), as in P1.
            self.feed_mode = word
        elif unit != UNKNOWN:
            self.feed_mode = _MODE_OF_UNIT.get(unit, "G94")
        elif self._fallback_feed_mode is not None:
            self.feed_mode = self._fallback_feed_mode
        else:
            self.feed_mode = "G94"

        speed_unit = interp.speed_unit
        self.css = speed_unit == "surface" if speed_unit != UNKNOWN else self._fallback_css

        # P1's `active_cycle` covers a one-shot cycle for the length of its own block; the
        # interpreter keeps the two apart (rule 2), so they are put back together here.
        # `_old_cycle` is only ever set by a database entry without a `sets` member.
        self.active_cycle = interp.active_cycle or interp._block["cycle"] or self._old_cycle
        self.pitch_feed = interp.pitch_feed or (self._old_cycle is not None and self._old_pitch)
        self.ambiguous_code = interp.pitch_feed_ambiguous or self._old_ambiguous
        self.pitch_feed_ambiguous = self.ambiguous_code is not None


def prime_tracker(
    tracker: FeedModeTracker,
    lines: Sequence[str],
    cp: CompiledProfile,
) -> Optional[LineState]:
    """Runs ``lines`` through ``tracker`` and answers the state the next line begins in.

    ``lines`` are the lines above a selection — :func:`preceding_lines` of the context.
    Afterwards ``tracker`` holds the feed mode, the constant-surface-speed flag, the active
    cycle and the thread-pitch flags that are in force at the first selected block, exactly
    as a run over the whole document would have had them there.

    The answer is the :class:`LineState` to pass to the first :func:`tokenize_line` of the
    selection, so a Klartext ``~`` continuation that begins above the selection is still a
    continuation inside it. ``None`` when there was nothing to walk, which
    :func:`tokenize_line` reads as "the top of a program" — the same thing.

    It produces no output and no findings: what a script *says* about the state it
    inherited is the script's own decision, because it is the script that knows whether the
    state changes what it does.

    Nothing here resets the tracker first. Prime a tracker once, before its first
    :meth:`FeedModeTracker.update`; priming one that has already walked a program would
    layer two programs on top of each other.
    """
    state: Optional[LineState] = None
    for line in lines:
        tokens, state = tokenize_line(line, cp, state)
        tracker.update(tokens)
    # What a block says applies to that block and to no other: a one-shot cycle (AD-19
    # rule 2) and a non-modal ambiguity (Fanuc `G92`) are over when their block is. If the
    # last line above the selection was such a block, what it raised must not still be
    # standing when the caller looks at what it inherited — the selection's first line is a
    # different block. `update()` clears the flags for every block it walks; the last
    # primed block has no successor here, so they are cleared on the way out.
    #
    # A block that is still **open** (a Klartext `~` parameter list that runs into the
    # selection) is left alone: the selection continues it, so its cycle is still in force
    # at the first selected line.
    if state is None or not state.continuation:
        tracker._interp._block = _empty_block()
        tracker._interp._block_ambiguous = None
        tracker._interp._continued = False
        tracker._publish()
    return state


# ---------------------------------------------------------------------------
# What kind of machine the profile describes (plan §7.4)
# ---------------------------------------------------------------------------


def machine_type_of(profile: Dict[str, Any]) -> str:
    """``'lathe'`` or ``'mill'`` (the default) — the kind of machine the profile describes.

    Not the machine configuration: that is :func:`gedit_nc.machine_params` (§7.15). This
    one decides wording and the "auto" options of the bundled scripts (feed per revolution
    on a lathe, diameter instead of radius).
    """
    value = (profile or {}).get("machineType")
    return "lathe" if value == "lathe" else "mill"


def incremental_axes(profile: Dict[str, Any]) -> Dict[str, str]:
    """``{'U': 'X', 'W': 'Z'}``: incremental address -> the axis it moves."""
    addresses = (profile or {}).get("addresses") or {}
    found = addresses.get("incremental")
    if not isinstance(found, dict):
        return {}
    return {
        str(word).upper(): str(axis).upper()
        for word, axis in found.items()
        if isinstance(word, str) and isinstance(axis, str)
    }


def diameter_axes(profile: Dict[str, Any]) -> List[str]:
    """``['X', 'U']``: the words written as a diameter while the diameter mode is on."""
    addresses = (profile or {}).get("addresses") or {}
    found = addresses.get("diameter")
    if not isinstance(found, list):
        return []
    return [str(word).upper() for word in found if isinstance(word, str)]

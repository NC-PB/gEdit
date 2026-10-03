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

**What a code is (M8, WP8.7).** The turning dialects write things the ISO dialects never
do, and three readings follow from the token contract (plan §7.5, AD-24) rather than from
any dialect:

* a ``call`` token names a code by its identifier, the way a keyword does: ``CYCLE84(…)``
  is the code ``CYCLE84``, so its ``sets.cycle`` and ``pitchFeed`` reach the block;
* an address written with ``=`` is a value, never a code: ``M3=3`` is neither the code
  ``M33`` nor the master spindle's ``M3`` (it switches spindle 3, which this state does not
  track), and ``S3=``, ``T1=``, ``SB=``, ``LIMS=`` and ``F=R1`` are values of their own;
* a dwell block (``fNotFeed``) is a dwell as a whole: its feed word is a time (rule 6), and
  its speed word, where a control writes one (Sinumerik ``G4 S2``, two revolutions), is not
  a spindle speed either, so neither changes the feed or the speed in force.

**The defined cycle (M9, WP9.5b; plan §7.4, AD-19).** Klartext **defines** a cycle
(``CYCL DEF 200``) and runs it later, as often as it is called (``CYCL CALL``, ``M99``, and
after every positioning block while ``M89`` is in force); only the next definition replaces
it. The interpreter carries that as ``definedCycle`` and ``modalCall`` beside Fanuc's
``activeCycle``, driven by the database's ``sets.cycle`` values ``'define'``, ``'call'`` and
``'call-modal'`` and by no dialect name; a database without them reads exactly as before.

**Taps, modes and data (2026-09).** :class:`FeedModeTracker` also answers whether a block
taps (``CodeEntry.tapping``), whether a modal **mode** outside the cycle and motion groups
makes the feed a lead (a ``pitchFeed`` entry such as Fanuc ``G63``, read off the groups of
rule 1), and whether the block's words are data (``wordsAreData``). None of this is in the
interpreter's state, which TypeScript mirrors; it is the scripts' reading of the same data.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from _nc_lex import CompiledProfile, LineState, Token, continues_block, normalize_code, tokenize_line

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
#: ``'travel-time'`` (M9 review F8) is Sinumerik ``G931``: its F is the time a move takes.
#: Its Phase 1 name is the code, a mode no script scales, so a script leaves such an F alone.
_MODE_OF_UNIT = {
    "inverse-time": "G93",
    "per-minute": "G94",
    "per-rev": "G95",
    "per-tooth": "FZ",
    "travel-time": "G931",
}

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


# -- P9 (roadmap R3, TODO "Ahead"; plan section 7.2): how one entry's flags read -----------
#
# The TypeScript twins are `axisWordsOf`, `frameOf` and `speedLimitBoundOf` in
# `src/lib/core/codes/lookup.ts`; both are held to the same cases. A context's `codes` come
# from the app's loader, which has already dropped every value it does not know, so these
# only have to say what an absent member means.


def axis_words_of(entry: Optional[Dict[str, Any]]) -> Optional[str]:
    """What the axis words of a block with this code are: ``'data'``, ``'machine'`` or ``None``.

    ``None`` is the ordinary case, positions in the program's own frame. ``'data'``: values,
    not a position (a coordinate set, a local shift, a rotation centre, a frame origin).
    ``'machine'``: a position outside the program's frame (machine coordinates, a reference
    point). ``wordsAreData`` makes every word of the block data, its axis words included, so
    it answers ``'data'`` whatever ``axisWords`` says.
    """
    if not isinstance(entry, dict):
        return None
    if entry.get("wordsAreData") is True:
        return "data"
    value = entry.get("axisWords")
    return value if value in ("data", "machine") else None


def frame_of(entry: Optional[Dict[str, Any]]) -> Optional[str]:
    """``'open'`` or ``'close'`` for a code that opens or closes a coordinate frame, else ``None``."""
    if not isinstance(entry, dict):
        return None
    value = entry.get("frame")
    return value if value in ("open", "close") else None


def speed_limit_bound_of(entry: Optional[Dict[str, Any]]) -> Optional[str]:
    """Which side of the speed range this code's ``S`` bounds: ``'upper'``, ``'lower'`` or ``None``.

    ``None`` when the code sets no speed limit at all. A limit without a bound is the clamp
    every entry meant before M9, ``'upper'``; Sinumerik ``G25`` is a ``'lower'`` one, a
    minimum that is neither a speed nor a clamp.
    """
    sets = _sets_of(entry)
    if sets.get("speedLimit") is not True:
        return None
    return "lower" if sets.get("speedLimitBound") == "lower" else "upper"


def _next_code_token(tokens: Sequence[Token], start: int, count: int) -> Optional[Token]:
    """The next token that is not whitespace, or ``None``."""
    for i in range(start, count):
        if tokens[i].kind != "whitespace":
            return tokens[i]
    return None


def _is_assignment(token: Token) -> bool:
    """True for an address written with ``=`` (plan §7.5, AD-24 ``syntax.assignment``).

    ``SB=1200``, ``S3=2500``, ``M3=3``, ``LIMS=3000``, ``F=R1``: the token is a ``word`` whose
    text carries an ``=`` straight after its address. Such a word is a **value** and never
    a code; its address is exactly what stands in front of the ``=``, so ``S3`` is not
    ``S`` while ``F=R1`` is the feed word with a value that is not a number. A profile
    without ``syntax.assignment`` has no such token, so nothing changes for it.

    An **indexed** assignment (``syntax.assignmentIndex``: ``S[2]=500``, ``M[2]=3``,
    ``LIMS[2]=1800``, ``FA[X]=100``) is one too: its text in front of the ``=`` is the
    address plus the bracket, and the word carries the bracket text in ``index``. It names
    the spindle or axis in the index, like ``S2=`` names one in its address, so it is
    neither the main spindle's ``S`` nor a code ``M3`` (M9 review F1).
    """
    if token.kind != "word" or not token.address:
        return False
    if token.index is not None:
        return True
    head, sep, _ = token.text.partition("=")
    return sep == "=" and head.strip().upper() == token.address.upper()


def _codes_in(tokens: Sequence[Token], index: Dict[str, Dict[str, Any]]) -> List[str]:
    """Every code this block writes, in the order it wrote them (:func:`_written_codes`)."""
    return [code for code, _ in _written_codes(tokens, index)]


def _written_codes(tokens: Sequence[Token], index: Dict[str, Dict[str, Any]]) -> List[Tuple[str, str]]:
    """Every code this block writes, with the kind of token that wrote it, in written order.

    An ISO dialect writes a code as an address word (``G95`` is ``G`` + ``95``); Klartext
    writes it as a keyword, and a multi-word code carries its number in the next token
    (``CYCL DEF`` + ``207``), while a packed dialect already has it on the keyword itself
    (``GOTO100``). Both spellings end up as one written code here.

    Two more come with the turning dialects (M8). A ``call`` token is the code of its
    identifier (``CYCLE84(…)`` is ``CYCLE84``); an assignment word (:func:`_is_assignment`)
    is a value and never a code, so ``M3=3`` does not become the code ``M33``.

    The kind (``'word'``, ``'call'``, ``'keyword'``) is what tells a cycle **defined** by a
    keyword (Klartext ``CYCL DEF 207``, run later by a call) from one written as a call that
    runs where it stands (``CYCLE84(…)``).
    """
    out: List[Tuple[str, str]] = []
    count = len(tokens)
    for i, token in enumerate(tokens):
        if token.kind == "word":
            address = token.address or ""
            if address != "" and not _is_assignment(token):
                out.append((address + (token.value_text or ""), "word"))
        elif token.kind == "call":
            name = token.address or ""
            if name != "":
                out.append((name, "call"))
        elif token.kind == "keyword":
            name = token.address or token.text
            number = token.value_text
            if number is None:
                nxt = _next_code_token(tokens, i + 1, count)
                if nxt is not None and nxt.address is None and nxt.value_text is not None:
                    number = nxt.value_text
            joined = _joined_code(name, number, index)
            out.append((joined if joined is not None else name, "keyword"))
    return out


def _joined_code(name: str, number: Optional[str], index: Dict[str, Dict[str, Any]]) -> Optional[str]:
    """A keyword and the number behind it as one code, when the database knows the pair.

    ``CYCL DEF 200`` is the entry of that cycle. A **sub-block** of one of the older cycles,
    written with a decimal part (``CYCL DEF 19.1``, ``CYCL DEF 7.0``), is the cycle it belongs
    to (``CYCL DEF 19``) when the database has no entry for the sub-block itself (M9, I9 and
    WP9.5b; the TypeScript twin is the hover's join in ``core/codes/hoverText.ts``). Without
    it the sub-blocks of the coordinate cycles fell through to the generic ``CYCL DEF``,
    and their flags (``axisWords``, ``frame``) were reached by no program line. ``None`` when
    neither form is known, so ``LBL 1`` stays ``LBL`` and the generic entry applies.
    """
    if number is None:
        return None
    joined = "%s %s" % (name, number)
    if normalize_code(joined) in index:
        return joined
    whole, dot, part = number.partition(".")
    if dot == "." and whole.isdigit() and part.isdigit():
        joined = "%s %s" % (name, whole)
        if normalize_code(joined) in index:
            return joined
    return None


# ---------------------------------------------------------------------------
# The modal interpreter (plan §7.4, AD-19)
# ---------------------------------------------------------------------------


def _head_of(code: str) -> str:
    """The letters a normalized code starts with: ``G`` of ``G84.2``, ``CYCL`` of ``CYCL DEF 207``."""
    end = 0
    while end < len(code) and code[end].isalpha():
        end += 1
    return code[:end]


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
    4. ``sets.speedLimit`` makes **this block's** speed word a clamp, not a speed; so does an
       address the profile lists in ``addresses.speedLimitWords`` (Sinumerik ``LIMS=``),
       wherever it stands;
    5. ``addresses.feedUnitWords`` switch the feed unit by word (Klartext ``FU`` / ``FZ``);
       a plain feed word returns to the unit the modal group gives;
    6. ``fNotFeed`` makes the block's feed word a time, not a feed (M8). The block is a
       dwell, so its speed word is not a speed either (Sinumerik ``G4 S2`` waits two
       revolutions);
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
        for that answer, never for the mode alone;
    11. **the defined cycle** (M9, WP9.5b; plan §7.4 rules 1–6). A ``'define'`` entry
        (Klartext ``CYCL DEF 200``) stores its cycle as ``definedCycle`` and replaces the
        one before it; it runs nothing. A ``'call'`` entry (``CYCL CALL``, ``M99``) runs the
        defined cycle once (``block.cycle``) and ends a modal call. A ``'call-modal'``
        entry (``M89``) runs it in its own block and switches ``modalCall`` on; from then on
        every **positioning block** (an axis word of ``addresses.axes`` with a value, in a
        block whose codes do not make the axis words data) runs it as well, and
        ``activeCycle`` is the defined cycle, until a ``'call'`` or the next ``'define'``.
        Nothing else ends a definition — no call, no tool change. A cycle that takes effect
        where it is defined carries none of the three values and touches none of this;
    12. a speed limit whose ``sets.speedLimitBound`` is ``'lower'`` (Sinumerik ``G25``)
        marks the block's speed word as no speed (``block.speedLimit``) but is not the
        clamp: ``speedLimit`` is the **upper** limit in force (plan §7.4).

    A defined cycle never makes a block's feed word a lead (``block.pitchFeed``,
    :attr:`pitch_feed`): it takes its values from its own parameters (``Q206``, ``Q239``),
    never from the ``F`` of the block that calls it, which is that block's positioning feed.
    Its ``pitchFeed`` flag is in ``definedCycle`` for whoever needs to know that it cuts a
    thread.

    It never reads a machine configuration: everything machine-specific arrives in the
    **effective** profile it is given (AD-31), which is why a golden pins a behaviour by
    naming the machine parameters it runs with (§7.4).

    **A block, not a line.** :meth:`update` takes one line, but a Klartext block runs over
    several of them with ``~`` continuations, and an Okuma block over several with lines that
    start with ``$`` (``syntax.continuationStart``, M8). A continued line belongs to the
    block above it: ``block`` is not cleared, and a one-shot cycle of rule 2 stays in force
    to the end of its parameter list — so the lead written on the ``$`` line of a ``G71``
    block is still that thread cycle's lead.
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
        axes = addresses.get("axes")
        #: Rule 11: the words that make a block a positioning block.
        self._axes = (
            frozenset(str(a).upper() for a in axes if isinstance(a, str) and a != "")
            if isinstance(axes, list)
            else frozenset()
        )

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
        # Rule 11 (plan section 7.4, the Klartext "defined cycle"): the cycle the last
        # `sets.cycle: 'define'` entry stored, and the modal call (`'call-modal'`, M89) in
        # force. A database without these values never sets either, so every ISO reading
        # is unchanged.
        self._defined_cycle: Optional[Dict[str, Any]] = None
        self._modal_call: Optional[Dict[str, Any]] = None
        self._modal_ambiguous: Optional[str] = None
        # Before the power-on codes below, which are applied through `_apply_sets` and may
        # touch the block's flags.
        self._clear_block()
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

    def update(
        self,
        tokens: "Sequence[Token]",
        line: int,
        masked: str = "",
        continued: Optional[bool] = None,
    ) -> None:
        """Applies one line. ``masked`` is the line with its comments masked, for rule 7.

        Without ``masked`` the tool rule is not applied — a caller that does not need the
        tool (:class:`FeedModeTracker`) does not have to mask every line to use the rest.

        ``continued`` says whether the line belongs to the block above it by a marker at its
        **start** (:func:`continues_block`, Okuma ``$``). Left out, the interpreter asks its
        own profile; a trailing marker (Klartext ``~``) needs neither, because the line above
        carried it.
        """
        if continued is None:
            # The tokens cover the line, so they give it back; only a profile that declares
            # the marker pays for the join.
            continued = self._patterns.get("continuation_start") is not None and continues_block(
                "".join(token.text for token in tokens), self.cp
            )
        same_block = self._continued or continued
        self._continued = any(token.kind == "continuation" for token in tokens)
        if not same_block:
            # The flags of a block belong to that block. A continued line is the same
            # block, so they are kept and added to instead.
            self._clear_block()

        # Two passes, because a block is not a sentence: `G50 S2500` and `S2500 G50` mean
        # the same thing, so every code of the block is applied before a single address
        # word is read (rules 4 and 6 both depend on it).
        for code in _codes_in(tokens, self._entries):
            self._apply_code(code, line)
        self._apply_modal_call(tokens)
        self._apply_words(tokens, line)
        if masked:
            self._apply_tool(masked, line)

    def _clear_block(self) -> None:
        """Forgets what the block just applied said about itself (the §7.4 ``block`` flags)."""
        self._block = _empty_block()
        self._block_ambiguous: Optional[str] = None
        #: The code that made this block a dwell (rule 6), for a finding that names it.
        self._block_dwell: Optional[str] = None
        #: Rule 11: the defined cycle this block runs (a call, or a positioning block under a
        #: modal call), and the cycle this block defined. Kept apart from ``_block``, whose
        #: flags are the ones :class:`FeedModeTracker` publishes in Phase 1's terms.
        self._block_run: Optional[Dict[str, Any]] = None
        self._block_defined: Optional[Dict[str, Any]] = None
        #: Rule 12: the block's speed limits, by bound.
        self._block_upper_limit = False
        self._block_lower_limit = False

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
            self._block_dwell = self._block_dwell or canonical

        cycle = sets.get("cycle")
        if cycle in ("define", "call", "call-modal"):
            self._apply_defined(cycle, canonical, line, pitch)
            return
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

    def _apply_defined(self, cycle: str, code: str, line: int, pitch: bool) -> None:
        """Rule 11: a cycle defined once and run where it is called (plan §7.4 rules 1–4)."""
        if cycle == "define":
            # Rule 1: it replaces any earlier definition and runs nothing; a modal call of
            # the old definition is over (rule 4).
            self._defined_cycle = {"code": code, "line": line, "pitchFeed": pitch}
            self._block_defined = dict(self._defined_cycle)
            self._modal_call = None
            return
        if cycle == "call":
            # Rule 3: runs the definition once, and ends a modal call. With nothing defined
            # it runs nothing.
            self._modal_call = None
        else:
            # Rule 4. The manual's own words: the **first** call of a modal call is written
            # with M89, so its block runs the cycle like an M99 would, and every positioning
            # block after it does too.
            self._modal_call = {"code": code, "line": line}
        if self._defined_cycle is not None:
            self._block_run = dict(self._defined_cycle)

    def _apply_modal_call(self, tokens: "Sequence[Token]") -> None:
        """Rule 11: a positioning block under a modal call runs the defined cycle."""
        if self._modal_call is None or self._defined_cycle is None or self._block_run is not None:
            return
        if not self._positions(tokens):
            return
        self._block_run = dict(self._defined_cycle)

    def _positions(self, tokens: "Sequence[Token]") -> bool:
        """Whether the line moves to a position: an axis word with a value, and no code of
        the block that makes its axis words data (a datum shift, ``CYCL DEF 7.1 X+5``)."""
        axes = self._axes
        if not axes:
            return False
        found = False
        for token in tokens:
            if token.kind == "word" and (token.address or "").upper() in axes and (token.value_text or "") != "":
                if not _is_assignment(token):
                    found = True
                    break
        if not found:
            return False
        for code in _codes_in(tokens, self._entries):
            if axis_words_of(self._entries.get(normalize_code(code))) == "data":
                return False
        return True

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
            # Rule 12: which side of the range it bounds.
            if sets.get("speedLimitBound") == "lower":
                self._block_lower_limit = True
            else:
                self._block_upper_limit = True

    def _apply_words(self, tokens: "Sequence[Token]", line: int) -> None:
        """The address words of the block: the feed, the speed and the clamp."""
        for token in tokens:
            if token.kind != "word":
                continue
            address = (token.address or "").upper()
            if address == "":
                continue
            if token.index is not None:
                # `S[2]=500`, `LIMS[2]=1800`: the spindle (or axis) is the index's, the way
                # `S2=` and `SB=` name theirs in the address, so this is neither the speed
                # in force nor the main clamp (M9 review F1).
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
                if self._block["fNotFeed"]:
                    # Rule 6 again: a dwell block is a dwell, and a speed word in it
                    # counts spindle revolutions (Sinumerik `G4 S2`). It is neither the
                    # speed in force nor a clamp.
                    continue
                if self._block["speedLimit"]:
                    # Rule 12: a lower limit alone is neither the speed nor the clamp. A
                    # block that also writes an upper one keeps the reading it had.
                    if self._block_upper_limit or not self._block_lower_limit:
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
            "activeCycle": self._active_cycle_state(),
            "definedCycle": dict(self._defined_cycle) if self._defined_cycle is not None else None,
            "modalCall": dict(self._modal_call) if self._modal_call is not None else None,
            "pitchFeedAmbiguous": self.pitch_feed_ambiguous,
            "block": self._block_state(),
        }

    def _active_cycle_state(self) -> Optional[Dict[str, Any]]:
        """§7.4 ``activeCycle``: the modal cycle, or the defined cycle while a modal call is on."""
        if self._active_cycle is not None:
            return dict(self._active_cycle)
        if self._modal_call is not None and self._defined_cycle is not None:
            return dict(self._defined_cycle)
        return None

    def _block_state(self) -> Dict[str, Any]:
        """§7.4 ``block``: ``cycle`` is the cycle that runs here, the defined one included."""
        block = dict(self._block)
        if block["cycle"] is None and self._block_run is not None:
            block["cycle"] = self._block_run["code"]
        return block

    @property
    def feed_unit(self) -> str:
        """``'per-minute'``, ``'per-rev'``, ``'per-tooth'``, ``'inverse-time'``, ``'travel-time'`` (Sinumerik ``G931``) or unknown.

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
        """The modally active cycle's code, or ``None`` (``state['activeCycle']``).

        A one-shot cycle (rule 2) is **not** here: it is in ``block['cycle']``, because it
        is over when its block is. A defined cycle is here while a modal call runs it after
        every positioning block (rule 11).
        """
        cycle = self._active_cycle_state()
        return cycle["code"] if cycle is not None else None

    @property
    def defined_cycle(self) -> Optional[str]:
        """The code of the cycle the last ``'define'`` entry stored, or ``None`` (rule 11)."""
        return self._defined_cycle["code"] if self._defined_cycle is not None else None

    @property
    def modal_call(self) -> Optional[str]:
        """The code that switched the modal call on (``M89``), or ``None`` (rule 11)."""
        return self._modal_call["code"] if self._modal_call is not None else None

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

    @property
    def f_not_feed_code(self) -> Optional[str]:
        """The code that makes this block a dwell (``G4``), or ``None`` (rule 6)."""
        return self._block_dwell

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
    * ``f_not_feed`` — ``True`` while the block is a **dwell** (``fNotFeed``, M8: Okuma
      ``G04 F``, Sinumerik ``G4 F`` / ``G4 S``): its ``F`` word is a time, not a feed rate,
      and a speed word in it counts spindle revolutions, not rpm. Neither may be scaled or
      reported as a feed or a speed. ``f_not_feed_code`` names the code (``G4``).
    * ``tapping`` — ``True`` while the block taps a thread (``CodeEntry.tapping``, owner
      decision of 2026-09-27): a code of the block itself (``M29``, ``G63``, ``CYCLE84``),
      the modally active cycle (``G84``, ``G331``) or a tapping **mode** in force (Fanuc
      ``G63`` until ``G64``). ``tapping_code`` names the code. The spindle speed of such a
      block is tied to its feed by the pitch.
    * ``pitch_mode`` — the modal code **outside** the cycle and motion groups whose entry
      carries ``pitchFeed`` and which is the active code of its group (Fanuc ``G63``, the
      tapping mode, is in force until ``G61``, ``G62`` or ``G64``), or ``None``. While it is
      set, ``pitch_feed`` is ``True`` as well. The interpreter's own state does not carry it
      (AD-19 rule 3 is about cycles and moves); this wrapper reads it off the groups.
    * ``data_code`` — the code of this block whose words are its arguments or its data
      (``CodeEntry.wordsAreData``: ``G65``, ``G66``, ``G10``), or ``None``.
    * ``written`` — ``(entry, token kind)`` for every code of the database the line just
      applied wrote, in written order (``'word'``, ``'call'`` or ``'keyword'``).

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
    f_not_feed: bool
    f_not_feed_code: Optional[str]
    tapping: bool
    tapping_code: Optional[str]
    pitch_mode: Optional[str]
    data_code: Optional[str]
    written: List[Tuple[Dict[str, Any], str]]

    def __init__(self, codes: Optional[Sequence[Dict[str, Any]]] = None) -> None:
        """``codes`` is the context's code database (``CodeEntry`` dictionaries)."""
        # The tracker is constructed from a database alone — a P1 signature, and one every
        # bundled script uses — so the interpreter gets an empty compiled profile. It then
        # assumes nothing at all, which is exactly what P1 did.
        self._interp = ModalInterpreter(CompiledProfile(profile={}), codes or ())
        self._entries = self._interp._entries
        self._line = 0
        # 2026-09: what `update` reads for the tapping and data flags, prepared once. A
        # 100,000-line program asks on every line, so the lookups are kept cheap: only a
        # word under a letter some code of the database starts with can be a code, and a
        # written code is normalized once.
        self._heads = frozenset(_head_of(key) for key in self._entries)
        self._memo: Dict[str, Optional[Dict[str, Any]]] = {}
        #: group -> canonical code -> entry, for the modes `_mode_with` looks for.
        self._mode_groups: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for entry in self._interp.codes:
            if not isinstance(entry, dict) or entry.get("modal") is not True:
                continue
            group, code = entry.get("group"), entry.get("code")
            if not isinstance(group, str) or group in ("cycle", "motion") or not isinstance(code, str):
                continue
            if entry.get("pitchFeed") is True or entry.get("tapping") is True:
                self._mode_groups.setdefault(group, {})[code] = entry
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
        self._clear_block_flags()
        self.written = []
        self._publish()

    def _clear_block_flags(self) -> None:
        """Forgets what the last block said about itself: its tapping code and its data code."""
        self._block_tapping: Optional[str] = None
        self._block_data: Optional[str] = None

    def entry(self, code: str) -> Optional[Dict[str, Any]]:
        """The database entry for a written code, following aliases, or ``None``."""
        return self._interp.entry(code)

    def _lookup(self, code: str) -> Optional[Dict[str, Any]]:
        """:meth:`entry`, remembered per written spelling."""
        if code in self._memo:
            return self._memo[code]
        found = self._entries.get(normalize_code(code)) if code else None
        self._memo[code] = found
        return found

    def _written(self, tokens: Sequence[Token]) -> List[Tuple[Dict[str, Any], str]]:
        """The entries of the codes a line writes, with the token kind (:func:`_written_codes`)."""
        out: List[Tuple[Dict[str, Any], str]] = []
        for i, token in enumerate(tokens):
            kind = token.kind
            if kind == "word":
                address = token.address
                if not address or address.upper() not in self._heads or _is_assignment(token):
                    continue
                entry = self._lookup(address + (token.value_text or ""))
            elif kind == "call":
                entry = self._lookup(token.address or "")
            elif kind == "keyword":
                code = _written_codes(tokens[i:], self._entries)[0][0]
                entry = self._lookup(code)
            else:
                continue
            if entry is not None:
                out.append((entry, kind))
        return out

    def update(self, tokens: Sequence[Token], continued: bool = False) -> None:
        """Applies one block's tokens. Call it for every line, in order.

        ``continued`` is True for a line that belongs to the block above it by a marker at
        its start — pass ``continues_block(line, cp)`` (M8: Okuma ``$`` lines). The tracker
        is built from the code database alone and cannot tell by itself; left out, every
        line that does not follow a trailing ``~`` starts a block of its own, as in P1.
        """
        self._line += 1
        # The same test the interpreter makes: a line continues the block above it by a
        # trailing marker on that one or a leading marker on this one.
        if not (self._interp._continued or continued is True):
            self._clear_block_flags()
        self._interp.update(tokens, self._line, continued=continued is True)
        self.written = self._written(tokens)
        for entry, _ in self.written:
            canonical = entry.get("code")
            if entry.get("tapping") is True and self._block_tapping is None:
                self._block_tapping = canonical
            if entry.get("wordsAreData") is True and self._block_data is None:
                self._block_data = canonical
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

    def _mode_with(self, flag: str) -> Optional[str]:
        """The active modal code outside the cycle and motion groups whose entry has ``flag``.

        A tapping **mode** (Fanuc ``G63``) is neither a cycle nor a move: it is the active
        code of its own group (AD-19 rule 1) until another code of that group replaces it,
        and while it is, the feed is a lead and the speed a tap's. The cycle and motion
        groups are left out because their codes are read through the active cycle, which a
        move can end while the group still names the cycle (rule 3).
        """
        for group, modes in self._mode_groups.items():
            value = self._interp._groups.get(group)
            entry = modes.get(value.get("code")) if value is not None else None
            if entry is not None and entry.get(flag) is True:
                return entry.get("code")
        return None

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
        #
        # M9 (rule 11): a definition (`CYCL DEF 207`) is what P1 read as a one-shot cycle of
        # its own block, and that is what this wrapper still says; a call (`CYCL CALL`,
        # `M99`, `M89`) is what P1 read as no cycle at all. The scripts written against
        # these attributes keep their reading; the defined-cycle state is in
        # `ModalInterpreter.state` for whoever reads it.
        iso_cycle = interp._active_cycle
        defined = interp._block_defined
        self.active_cycle = (
            (iso_cycle["code"] if iso_cycle is not None else None)
            or interp._block["cycle"]
            or (defined["code"] if defined is not None else None)
            or self._old_cycle
        )
        self.pitch_mode = self._mode_with("pitchFeed")
        self.pitch_feed = (
            interp.pitch_feed
            or (defined is not None and bool(defined["pitchFeed"]))
            or (self._old_cycle is not None and self._old_pitch)
            or self.pitch_mode is not None
        )
        # Tapping: the block's own code first, then the cycle in force, then a mode.
        cycle_entry = self._lookup(self.active_cycle) if self.active_cycle else None
        self.tapping_code = (
            self._block_tapping
            or (self.active_cycle if cycle_entry is not None and cycle_entry.get("tapping") is True else None)
            or self._mode_with("tapping")
        )
        self.tapping = self.tapping_code is not None
        self.data_code = self._block_data
        self.ambiguous_code = interp.pitch_feed_ambiguous or self._old_ambiguous
        self.pitch_feed_ambiguous = self.ambiguous_code is not None
        # M8: a dwell block. The flag is the database's (`fNotFeed`); the code is for the
        # finding that says why a word was left alone.
        self.f_not_feed = interp.block_f_not_feed
        self.f_not_feed_code = interp.f_not_feed_code


def prime_tracker(
    tracker: FeedModeTracker,
    lines: Sequence[str],
    cp: CompiledProfile,
    first: Optional[str] = None,
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

    ``first`` is the first line of the selection, when the caller has it (M8). A selection
    that starts on a line continuing the block above it by a leading marker (Okuma ``$``)
    starts **inside** that block, so what the block raised is still standing there.
    """
    state: Optional[LineState] = None
    for line in lines:
        tokens, state = tokenize_line(line, cp, state)
        tracker.update(tokens, continued=continues_block(line, cp))
    # What a block says applies to that block and to no other: a one-shot cycle (AD-19
    # rule 2) and a non-modal ambiguity (Fanuc `G92`) are over when their block is. If the
    # last line above the selection was such a block, what it raised must not still be
    # standing when the caller looks at what it inherited — the selection's first line is a
    # different block. `update()` clears the flags for every block it walks; the last
    # primed block has no successor here, so they are cleared on the way out.
    #
    # A block that is still **open** (a Klartext `~` parameter list that runs into the
    # selection, or an Okuma block whose `$` line is the first one selected) is left alone:
    # the selection continues it, so its cycle is still in force at the first selected line.
    still_open = state is not None and state.continuation
    if not still_open and first is not None and continues_block(first, cp):
        still_open = True
    if not still_open:
        tracker._interp._clear_block()
        tracker._interp._continued = False
        tracker._clear_block_flags()
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

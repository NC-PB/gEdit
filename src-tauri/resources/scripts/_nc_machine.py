"""How the control reads numbers (plan §7.15, AD-31), the Python half.

Written as a stub by the M6 prelude (P6) and implemented by **WP6.9** against the golden
set ``tests/fixtures/machines/numbers.json``, which this module and
``src/lib/core/machines/numbers.ts`` both pass. ``gedit_nc`` re-exports every
public name below; a script must not import this module directly.

**The problem.** ``X50`` is 50 mm on one control and 0.050 mm on the next, and the
difference is a machine parameter, not a property of the dialect. A script that divides by
a thousand on the wrong machine scraps the part. So gEdit never guesses:

* with a machine chosen, the machine's reading decides;
* without one, a literal has a value **only when every preset the profile declares reads
  it the same way** (AD-31 "No machine, no guess"). A word written with a decimal point
  usually survives that test; a point-less length, angle or dwell word usually does not.
  :func:`resolve_value` then answers with no value and the readings to report, and the
  caller leaves the word alone and says why.

A script that only *scales* needs none of this: scaling is unit-free in all three readings
(the literal is multiplied, and the value is the literal times a constant), and the
effective ``syntax.decimalPointSignificant`` already follows the machine.

Decimal strings only, never floats (``Decimal``, as the rest of ``gedit_nc``), and
rounding is half away from zero on both sides.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from typing import Any, Dict, List, Optional, Sequence, Tuple

from _nc_lex import format_number, parse_number

#: Every value that comes from the profile rather than from a machine (§7.15 ParamSource).
_PROFILE = "profile"


def _presets_of(decl: Dict[str, Any]) -> List[Dict[str, Any]]:
    number_input = decl.get("numberInput")
    if not isinstance(number_input, dict):
        return []
    presets = number_input.get("presets")
    return [preset for preset in presets if isinstance(preset, dict)] if isinstance(presets, list) else []


def _default_number_input(decl: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The ``NumberInput`` of the declaration's default preset, or ``None``."""
    presets = _presets_of(decl)
    if not presets:
        return None
    number_input = decl.get("numberInput")
    wanted = number_input.get("default") if isinstance(number_input, dict) else None
    for preset in presets:
        if preset.get("id") == wanted and isinstance(preset.get("value"), dict):
            return dict(preset["value"])
    first = presets[0].get("value")
    return dict(first) if isinstance(first, dict) else None


def _variants_of(decl: Dict[str, Any]) -> List[Dict[str, Any]]:
    variants = decl.get("variants")
    return [v for v in variants if isinstance(v, dict)] if isinstance(variants, list) else []


def _defaults_of(profile: Dict[str, Any]) -> Dict[str, Any]:
    """The §7.15 script member for a document with no machine: the profile's own defaults.

    Mirrors ``defaultParams`` and ``effectiveMachine(p, None, 'none', {})`` in
    ``src/lib/core/machines/effective.ts``. Python never merges a machine into a profile
    (that is the app's job, and doing it twice is how the two sides drift apart) — it only
    describes what "no machine" means.
    """
    profile = profile if isinstance(profile, dict) else {}
    decl = profile.get("machineParams")
    decl = decl if isinstance(decl, dict) else {}
    modal = profile.get("modal")
    modal = modal if isinstance(modal, dict) else {}

    variants: Dict[str, str] = {}
    variant_sources: Dict[str, str] = {}
    for variant in _variants_of(decl):
        name = variant.get("id")
        value = variant.get("default")
        if isinstance(name, str) and name != "" and isinstance(value, str):
            variants[name] = value
            variant_sources[name] = _PROFILE

    units = decl.get("units")
    if units not in ("mm", "inch"):
        units = modal.get("units") if modal.get("units") in ("mm", "inch") else "mm"
    diameter = decl.get("diameter") if decl.get("diameter") in ("on", "off") else None

    initial = modal.get("initial")
    modal_sources: Dict[str, str] = {}
    if isinstance(initial, dict):
        for group in initial:
            if isinstance(group, str):
                modal_sources[group] = _PROFILE
    # A variant that is in force through its default carries its overlay's power-on codes,
    # and their source is the profile's too while nothing else chose that variant.
    for variant in _variants_of(decl):
        name = variant.get("id")
        chosen = variants.get(name) if isinstance(name, str) else None
        for choice in variant.get("choices") or []:
            if not isinstance(choice, dict) or choice.get("value") != chosen:
                continue
            overlay = choice.get("overlay")
            overlay_modal = overlay.get("modal") if isinstance(overlay, dict) else None
            overlay_initial = overlay_modal.get("initial") if isinstance(overlay_modal, dict) else None
            if isinstance(overlay_initial, dict):
                for group in overlay_initial:
                    if isinstance(group, str):
                        modal_sources.setdefault(group, _PROFILE)

    return {
        "id": None,
        "name": None,
        "choice": "none",
        "params": {
            "numberInput": _default_number_input(decl),
            "units": units,
            "diameter": diameter,
            "variants": variants,
            "modalInitial": {},
        },
        "source": {
            "numberInput": _PROFILE,
            "units": _PROFILE,
            "diameter": _PROFILE,
            "variants": variant_sources,
            "modalInitial": modal_sources,
        },
    }


def machine_params(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """The document's effective machine, as the context carries it (§7.15).

    ``ctx["machine"]`` when it is there; otherwise the defaults derived from the profile's
    ``machineParams`` (or, for a profile that declares none, from the profile itself), with
    every source ``"profile"`` and ``choice`` ``"none"``.

    That fallback is what keeps an M5 script working unchanged: a context written before
    M6 has no ``machine`` member, and the answer it gets here describes exactly the
    behaviour it had.
    """
    ctx = ctx if isinstance(ctx, dict) else {}
    machine = ctx.get("machine")
    if isinstance(machine, dict) and isinstance(machine.get("params"), dict):
        defaults = _defaults_of(ctx.get("profile") or {})
        params = dict(defaults["params"])
        params.update({k: v for k, v in machine["params"].items() if v is not None or k in params})
        source = dict(defaults["source"])
        if isinstance(machine.get("source"), dict):
            source.update(machine["source"])
        return {
            "id": machine.get("id"),
            "name": machine.get("name"),
            "choice": machine.get("choice") or "none",
            "params": params,
            "source": source,
        }
    return _defaults_of(ctx.get("profile") or {})


# ---------------------------------------------------------------------------
# The number rules (§7.15), implemented by WP6.9 against
# ``tests/fixtures/machines/numbers.json``, which ``src/lib/core/machines/numbers.ts``
# passes as well. The two implementations agree case by case or one of them is wrong.
#
# The class order of `number_class_of` is fixed by AD-31 and the first match wins:
#   1. the `unit` of a `CodeParam` of a code in this block (`increment`, `count`, or a
#      class named outright) — the table in §8.2 is the one place these are written down;
#   2. the feed word of an `fNotFeed` block -> `dwell`;
#   3. the feed word in a block that carries a pitch feed, or under an active pitch cycle
#      -> `feedPerRev`: a thread lead is always per revolution, whatever the modal feed
#      mode says;
#   4. `addresses.angular` -> `angle`;
#   5. the feed word -> `feedPerMin` / `feedPerRev` from the modal feed unit;
#   6. axes, incremental twins, arc centres, `R` and cycle depths -> `length`;
#   7. nothing else has a class: `S`, `T`, `D`, `H`, `N`, `O`, `G`, `M` and every
#      `unit: 'count'` word are never converted.
#
# `None` is also the answer where the class cannot be told — a feed while the feed unit is
# unknown, or the feed of a block whose code is a threading cycle somewhere else
# (`pitchFeedAmbiguous`). A word without a class gets no value, and every consumer leaves
# it alone and reports it, which is the whole point.
# ---------------------------------------------------------------------------

#: Why :func:`write_back` refused. The TypeScript twin answers the same three cases with
#: an i18n key (`machines.numbers.*`) and carries the increment as a message parameter;
#: here the text is the message, because a script reports it as it stands.
WRITE_BACK_ERRORS = {
    "rounded": "the value does not fit the form this word is written in; it would have to be rounded",
    "noReading": "this word has no value on this machine, so nothing can be written back into it",
    "notANumber": "not a decimal number",
}

#: Addresses that are lengths although no profile field lists them. ``R`` is an arc
#: radius, a cycle return plane and a lathe taper, and it is a length in all three; a
#: cycle that reads its ``R`` differently says so with ``CodeParam.unit``, which wins.
_EXTRA_LENGTH_ADDRESSES = ("R",)

#: The classes whose unit follows the program's mm/inch state. Angles and dwell do not:
#: an IS-B control reads ``C90000`` as 90 degrees in a metric and in an inch program.
_UNIT_CLASSES = ("length", "feedPerMin", "feedPerRev")

#: Decimals the division in :func:`write_back` is carried to before the format rounds it.
_DIVISION_SCALE = 24

_ZERO = Decimal(0)


def _dict(value: Any) -> Dict[str, Any]:
    """``value`` when it is a dictionary, an empty one otherwise."""
    return value if isinstance(value, dict) else {}


def _first_present(*candidates: Any) -> Any:
    """The first candidate that is not ``None``; a wrong type is rejected downstream."""
    for candidate in candidates:
        if candidate is not None:
            return candidate
    return None


# --- exact decimal arithmetic ------------------------------------------------


def _decimal(text: Any) -> Optional[Decimal]:
    """A written number as an exact :class:`~decimal.Decimal`, or ``None``.

    It goes through :func:`gedit_nc.parse_number`, so exactly the NC number grammar is
    accepted: no exponent, no thousands separator, nothing around it.
    """
    parsed = parse_number(text.strip()) if isinstance(text, str) else None
    return Decimal(parsed.raw) if parsed is not None else None


def _dec_text(value: Decimal) -> str:
    """The canonical text of a value: no trailing zeros, no exponent, and zero is ``'0'``.

    Canonical because :func:`resolve_value` decides whether two presets agree by comparing
    these strings, and because the golden set pins one spelling per value for both
    languages.
    """
    if value == _ZERO:
        return "0"
    return format(value.normalize(), "f")


def _multiply(left: Decimal, right: Decimal) -> Decimal:
    """``left * right``, with room for every digit of both."""
    with localcontext() as context:
        context.prec = 80
        return left * right


def _divide(left: Decimal, right: Decimal) -> Decimal:
    """``left / right``, rounded half away from zero, with guard digits to spare.

    A quotient that terminates is exact; one that does not (an increment that is not a
    power of ten) is carried far past anything a written word can hold, and the rounding
    that matters is the one :func:`gedit_nc.format_number` does afterwards.
    """
    with localcontext() as context:
        context.prec = 80
        context.rounding = ROUND_HALF_UP
        quotient = left / right
        try:
            return quotient.quantize(Decimal(1).scaleb(-_DIVISION_SCALE), rounding=ROUND_HALF_UP)
        except InvalidOperation:  # pragma: no cover - only for absurd magnitudes
            return quotient


def _tenth_of(text: Any) -> Optional[str]:
    """``text`` divided by ten, exactly: the digits stay, the point moves."""
    value = _decimal(text)
    return None if value is None else _dec_text(value.scaleb(-1))


# --- the literal -------------------------------------------------------------


def _literal_raw(literal: Any) -> Optional[str]:
    """The text of a :class:`gedit_nc.NumericLiteral`, or of the same thing as a dict."""
    raw = literal.get("raw") if isinstance(literal, dict) else getattr(literal, "raw", None)
    return raw if isinstance(raw, str) else None


def _literal_has_point(literal: Any) -> bool:
    """Whether the literal was written with a decimal point."""
    if isinstance(literal, dict):
        return bool(_first_present(literal.get("has_point"), literal.get("hasPoint"), False))
    return bool(getattr(literal, "has_point", False))


# --- the class of a word -----------------------------------------------------


def _feed_unit_words(addresses: Dict[str, Any]) -> Dict[str, str]:
    """``addresses.feedUnitWords`` with upper-case keys (Klartext ``FU``, Okuma ``E``)."""
    out: Dict[str, str] = {}
    for word, unit in _dict(addresses.get("feedUnitWords")).items():
        if isinstance(word, str) and isinstance(unit, str):
            out[word.upper()] = unit
    return out


def _feed_words(addresses: Dict[str, Any], unit_words: Dict[str, str]) -> set:
    """Every word that carries a feed: the profile's feed address and the unit words."""
    words = set(unit_words)
    feed = addresses.get("feed")
    if isinstance(feed, str) and feed != "":
        words.add(feed.upper())
    return words


def _feed_class_of(unit: Any) -> Optional[str]:
    """The feed class of a feed unit, or ``None`` while the unit says nothing about it.

    ``per-tooth`` has no class of its own, ``inverse-time`` is not a length per time at
    all, and ``unknown`` is the honest answer of a tracker that has not seen a feed mode
    yet. All three get no value rather than the wrong one.
    """
    if unit == "per-minute":
        return "feedPerMin"
    if unit == "per-rev":
        return "feedPerRev"
    return None


def _has_upper(entries: Any, word: str) -> bool:
    return isinstance(entries, list) and any(isinstance(e, str) and e.upper() == word for e in entries)


def number_class_of(
    address: str,
    profile: Dict[str, Any],
    feed_unit: str,
    block_codes: "Sequence[Dict[str, Any]]",
    pitch_feed: bool = False,
) -> Optional[str]:
    """The number class of one address in one block, or ``None`` when it has none.

    ``profile`` is the **effective** profile of the document (the context carries it),
    ``feed_unit`` what the modal state says is in force (``'per-minute'``, ``'per-rev'``,
    ``'per-tooth'``, ``'inverse-time'`` or ``'unknown'``), ``block_codes`` the database
    entries of the codes in this block, and ``pitch_feed`` whether this block or the cycle
    that is active cuts a thread.

    The answer is a class, ``'increment'`` or ``'count'`` (both from ``CodeParam.unit``),
    or ``None``. The order is the one in the header of this section, and the first match
    wins.
    """
    word = address.upper() if isinstance(address, str) else ""
    if word == "":
        return None
    codes = [entry for entry in (block_codes or []) if isinstance(entry, dict)]

    # 1. what the code database says about this parameter of this code
    for entry in codes:
        params = entry.get("params")
        for param in params if isinstance(params, list) else []:
            if not isinstance(param, dict):
                continue
            param_address = param.get("address")
            if isinstance(param_address, str) and param_address.upper() == word and param.get("unit") is not None:
                return param["unit"]

    addresses = _dict(_dict(profile).get("addresses"))
    unit_words = _feed_unit_words(addresses)
    feed_words = _feed_words(addresses, unit_words)

    if word in feed_words:
        # 2. a block where the feed word is a time
        if any(entry.get("fNotFeed") is True for entry in codes):
            return "dwell"
        # 3. a thread lead, whatever the modal feed mode says
        if pitch_feed is True or any(entry.get("pitchFeed") is True for entry in codes):
            return "feedPerRev"
        # …and a code that may be a threading cycle somewhere else tells us nothing
        if any(entry.get("pitchFeedAmbiguous") is True for entry in codes):
            return None

    # 4. rotary axes
    if _has_upper(addresses.get("angular"), word):
        return "angle"

    # 5. the feed word, by the unit in force
    if word in feed_words:
        return _feed_class_of(_first_present(unit_words.get(word), feed_unit))

    # 6. positions
    if _has_upper(addresses.get("axes"), word):
        return "length"
    for twin in _dict(addresses.get("incremental")):
        if isinstance(twin, str) and twin.upper() == word:
            return "length"
    if _has_upper(addresses.get("arcCenter"), word):
        return "length"
    if word in _EXTRA_LENGTH_ADDRESSES:
        return "length"

    # 7. no class
    return None


# --- reading a literal -------------------------------------------------------


def _params_of(machine: Any) -> Dict[str, Any]:
    """The ``MachineParams`` of whatever the caller passed.

    A script has its machine from :func:`machine_params`, which answers the whole
    effective machine (``id``, ``choice``, ``params``, ``source``); the functions below
    need its ``params``. Both are accepted, so calling
    ``value_of(lit, cls, machine_params(ctx), 'mm')`` does the right thing.
    """
    machine = _dict(machine)
    inner = machine.get("params")
    return _dict(inner) if isinstance(inner, dict) else machine


def _number_input_of(machine: Any) -> Optional[Dict[str, Any]]:
    number_input = _params_of(machine).get("numberInput")
    return number_input if isinstance(number_input, dict) else None


def _unit_of(number_class: str, number_input: Dict[str, Any], units: str) -> Any:
    """The increment (``increment``) or the value of a written "1" (``scale``)."""
    entry = _dict(_dict(number_input.get("classes")).get(number_class))
    if number_class in _UNIT_CLASSES:
        increment = entry.get("increment")
        if isinstance(increment, str):
            if units == "inch":
                return _first_present(entry.get("incrementInch"), _tenth_of(increment))
            return increment
        if units == "inch":
            return _first_present(number_input.get("incrementInch"), _tenth_of(number_input.get("incrementMm")))
        return number_input.get("incrementMm")
    if number_class == "angle":
        return _first_present(entry.get("increment"), number_input.get("incrementDeg"), number_input.get("incrementMm"))
    # Dwell: ``incrementSec``, else the digits of ``incrementMm`` (§7.15). The angular
    # increment is not a step on that chain.
    return _first_present(
        entry.get("increment"),
        number_input.get("incrementSec"),
        number_input.get("incrementMm"),
    )


def _reading_for(
    number_class: Any, number_input: Optional[Dict[str, Any]], units: str
) -> "Optional[Tuple[str, str]]":
    """``(mode, unit)`` for this class on this machine, or ``None`` when it has no reading.

    ``'increment'`` is not a class but a ``CodeParam.unit``: a parameter that is **always**
    a count of least input increments, whatever its address suggests (the micrometre
    depths and pecks of §8.2). It is the length class read as a **count**, and it keeps
    that reading whatever the control does with an ordinary length word: the syntax notes
    describe one machine on which ``X50`` is 50 mm *and* ``Q6000`` is 6 mm, so "as
    written" is a statement about positions and not about the micrometre parameters of a
    cycle (the G10 decision of M6). The unit still has to be declared, never guessed: a
    preset that names no increment gives such a word no value.
    """
    # No declaration: the profile's own JSON decides, and it says what it says — as written.
    if not isinstance(number_input, dict):
        return ("calculator", "1")

    key = "length" if number_class == "increment" else number_class
    entry = _dict(_dict(number_input.get("classes")).get(key))
    mode = _first_present(entry.get("mode"), number_input.get("mode"))
    unit = _unit_of(key, number_input, units)
    if not isinstance(unit, str):
        return None

    if number_class == "increment":
        return ("scale" if mode == "scale" else "increment", unit)
    if mode not in ("increment", "calculator", "scale"):
        return None
    return (mode, unit)


def value_of(literal: Any, number_class: str, machine: Dict[str, Any], units: str) -> Optional[str]:
    """The value in mm, inch, degrees or seconds, as decimal text, or ``None``.

    * ``increment`` — with a decimal point as written, without one a count of increments;
    * ``calculator`` — as written, with or without a point;
    * ``scale`` — the literal times the class's unit, with or without a point.

    ``None`` means this word has no value on this machine: it has no class, it is a
    ``count``, or the machine declares no reading for it. Nothing downstream may invent
    one (AD-31).
    """
    raw = _literal_raw(literal)
    if raw is None:
        return None
    if number_class is None or number_class == "count":
        return None
    reading = _reading_for(number_class, _number_input_of(machine), units)
    if reading is None:
        return None
    mode, unit_text = reading

    value = _decimal(raw)
    if value is None:
        return None
    if mode == "calculator":
        return _dec_text(value)
    if mode == "increment" and _literal_has_point(literal):
        return _dec_text(value)

    unit = _decimal(unit_text)
    if unit is None or unit == _ZERO:
        return None
    return _dec_text(_multiply(value, unit))


def write_back(
    value: str,
    original: Any,
    number_class: str,
    machine: Dict[str, Any],
    units: str,
    fmt: Dict[str, Any],
    refuse_rounding: bool = False,
) -> "Tuple[Optional[str], bool, Optional[str]]":
    """``(text, rounded, error)``: the value in the word's own form, or ``None`` and why.

    A point stays a point, and a point-less word stays point-less — which is only possible
    while the value is a whole number of increments (or of units, in a unit system).
    Otherwise the literal is rounded half away from zero and ``rounded`` says so; with
    ``refuse_rounding`` the write is refused instead, which is what an editor does rather
    than change a value behind the programmer's back.

    ``rounded`` is decided by reading the result back: the text is rounded exactly when
    this machine would not read the value asked for out of it again. No tolerance.
    """
    if _literal_raw(original) is None:
        return (None, False, WRITE_BACK_ERRORS["noReading"])
    if number_class is None or number_class == "count":
        return (None, False, WRITE_BACK_ERRORS["noReading"])
    reading = _reading_for(number_class, _number_input_of(machine), units)
    if reading is None:
        return (None, False, WRITE_BACK_ERRORS["noReading"])
    mode, unit_text = reading

    wanted = _decimal(value)
    if wanted is None:
        return (None, False, WRITE_BACK_ERRORS["notANumber"])

    as_written = mode == "calculator" or (mode == "increment" and _literal_has_point(original))
    literal = wanted
    if not as_written:
        unit = _decimal(unit_text)
        if unit is None or unit == _ZERO:
            return (None, False, WRITE_BACK_ERRORS["noReading"])
        literal = _divide(wanted, unit)

    # A word without a point cannot carry a fraction, so a count is written as a count. In
    # `calculator` mode the profile's own number format decides, as it did in Phase 1.
    use_fmt = dict(_dict(fmt))
    if not as_written and not _literal_has_point(original):
        use_fmt["decimals"] = 0
    text = format_number(_dec_text(literal), original, use_fmt, True)

    back = parse_number(text)
    read_back = value_of(back, number_class, machine, units) if back is not None else None
    rounded = read_back is None or read_back != _dec_text(wanted)
    if rounded and refuse_rounding:
        return (None, True, WRITE_BACK_ERRORS["rounded"])
    return (text, rounded, None)


# --- with no machine: every reading the profile offers ------------------------


def readings_of(literal: Any, number_class: str, profile: Dict[str, Any], units: str) -> List[Dict[str, Any]]:
    """One ``{"preset", "label", "value"}`` per declared preset, the default first.

    The list is what a script reports when nothing is settled: "0.050 mm (increments of
    0.001 mm)", "50 mm (as written)". A preset that gives the word no value carries
    ``None``, which is also a difference — it is never quietly left out.
    """
    decl = _dict(_dict(profile).get("machineParams"))
    presets = _presets_of(decl)
    if not presets:
        return []
    default_id = _dict(decl.get("numberInput")).get("default")
    ordered = [p for p in presets if p.get("id") == default_id]
    ordered += [p for p in presets if p.get("id") != default_id]
    out: List[Dict[str, Any]] = []
    for preset in ordered:
        preset_id = preset.get("id")
        label = preset.get("label")
        out.append(
            {
                "preset": preset_id if isinstance(preset_id, str) else "",
                "label": label if isinstance(label, str) else "",
                "value": value_of(literal, number_class, {"numberInput": preset.get("value")}, units),
            }
        )
    return out


def resolve_value(
    literal: Any,
    number_class: Optional[str],
    ctx_machine: Dict[str, Any],
    profile: Dict[str, Any],
    units: str,
) -> "Tuple[Optional[str], List[Dict[str, Any]]]":
    """``(value, readings)``: what this word is worth, or what has to be asked first.

    With the machine's own number input (``source.numberInput == "machine"``) the machine
    decides and ``readings`` is empty. Otherwise the word keeps a value only while
    **every** preset the profile declares reads it the same way (AD-31 "No machine, no
    guess"); where they differ, the value is ``None`` and the readings say what each preset
    would make of it, the assumed default first.

    ``readings`` is empty whenever the value is settled or the word has no class, so a
    script can treat a non-empty list as "this needs a machine" and report it.
    """
    if number_class is None or number_class == "count":
        return (None, [])
    machine = _dict(ctx_machine)
    params = _params_of(machine)
    if _dict(machine.get("source")).get("numberInput") == "machine":
        return (value_of(literal, number_class, params, units), [])

    readings = readings_of(literal, number_class, profile, units)
    # A profile that declares no presets has nothing to disagree about: its JSON is the
    # answer, which is exactly what every Phase 1 document had.
    if not readings:
        return (value_of(literal, number_class, params, units), [])

    first = readings[0]["value"]
    if first is not None and all(reading["value"] == first for reading in readings):
        return (first, [])
    return (None, readings)

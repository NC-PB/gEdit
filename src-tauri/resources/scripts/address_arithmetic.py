#!/usr/bin/env python3
# /// gedit
# name = "Address arithmetic"
# description = "Adds, subtracts, multiplies or divides the written values of chosen addresses: a Z shift after a stock change, a flipped sign, a scale. A shift of the tool axis moves the positions of the drilling cycles that hold one. Incremental words, variables, machine positions, frames, rotary moves without tool centre point control and cycles that cannot be judged are left as written and listed."
# input = "selection-or-document"
# output = "replace"
# timeout = 300
# envelope = true
#
# [[params]]
# id = "operation"
# type = "choice"
# label = "Operation"
# default = "add"
# choices = [
#   { label = "Add", value = "add" },
#   { label = "Subtract", value = "subtract" },
#   { label = "Multiply", value = "multiply" },
#   { label = "Divide", value = "divide" }
# ]
#
# [[params]]
# id = "operand"
# type = "number"
# label = "Value"
# help = "For add and subtract, in the program's units (mm or inch; degrees for a rotary axis). For multiply and divide, a plain factor."
# required = true
# decimals = 6
#
# [[params]]
# id = "addresses"
# type = "address-list"
# label = "Addresses"
# help = "The words to change. A shift of Z also moves the cycle positions on the tool axis (the R plane of a drilling cycle, Q203, RTP, RFP, DP). When multiplying, add R if arcs are written with a radius."
# default = ["Z"]
# choices = [
#   { label = "X", value = "X" },
#   { label = "Y", value = "Y" },
#   { label = "Z", value = "Z" },
#   { label = "U", value = "U" },
#   { label = "V", value = "V" },
#   { label = "W", value = "W" },
#   { label = "A", value = "A" },
#   { label = "B", value = "B" },
#   { label = "C", value = "C" },
#   { label = "I", value = "I" },
#   { label = "J", value = "J" },
#   { label = "K", value = "K" },
#   { label = "R", value = "R" }
# ]
#
# [[params]]
# id = "arcCentres"
# type = "choice"
# label = "Arc centres"
# help = "Also changes the arc centre words of the chosen axes: I with X, J with Y, K with Z. Automatically means no for add and subtract, where they are distances from the start point on most controls, and yes for multiply and divide."
# default = "auto"
# choices = [
#   { label = "Automatically", value = "auto" },
#   { label = "Yes", value = "yes" },
#   { label = "No", value = "no" }
# ]
#
# [[params]]
# id = "xOperand"
# type = "choice"
# label = "The X value is"
# help = "Only on a turning profile, where X is written as a diameter: whether the value added to X is a diameter or a radius. Each X word is converted by the diameter mode it is written in."
# default = "diameter"
# choices = [
#   { label = "A diameter", value = "diameter" },
#   { label = "A radius", value = "radius" }
# ]
#
# [[params]]
# id = "decimals"
# type = "choice"
# label = "Decimal places"
# help = "As written keeps the decimals each value was written with, and adds the ones the result needs (at most four)."
# default = "keep"
# choices = [
#   { label = "As written", value = "keep" },
#   { label = "0", value = "0" },
#   { label = "1", value = "1" },
#   { label = "2", value = "2" },
#   { label = "3", value = "3" },
#   { label = "4", value = "4" }
# ]
# ///
"""Address arithmetic (plan §6 M10 WP10.4; `nc-transformations.md`, "Arithmetic on address
values"; roadmap R3, R6 and R8).

Adds a value to, subtracts it from, multiplies or divides the **literal** values of chosen
addresses, and hands the program back through the `envelope` output with a summary and one
finding per block or word it left as written. Its daily use is a shift: "the part sits
0.5 mm higher, move every Z".

The rule this script lives by: **a block it cannot judge is left as written and listed,
never shifted in part.** A shift that moves a hole depth wrongly scraps a part; a block
left alone and listed costs one look. The golden format, the form ids and the vocabulary of
the findings are `tests/fixtures/scripts/address_arithmetic/README.md`.

What it changes
---------------
Every word of a chosen address that holds a literal number, in a block the script can
judge, by its **effective** value (plan §7.15, AD-31): `gedit_nc.resolve_value` says what
the word is worth on the document's machine, the operation is applied to that value in the
program's units, and `gedit_nc.write_back` puts the result back into the word's own form —
a point stays a point, a point-less increment or unit word stays a whole number of them,
rounded half away from zero and reported when it had to be rounded. Multiply and divide are
unit-free, so they work on the literal itself where the result keeps its form.

On a **turning** profile with `addresses.diameter` the X operand is a diameter or a radius
(`xOperand`), and each word is converted by its own reading
(`ModalInterpreter.diameter_reading`, AD-19 rule 11): a +0.5 diameter shift moves a
`DIAMON` word by 0.5 and a `DIAMOF` word by 0.25. On a **milling** profile that lists
diameter words (Sinumerik `DIAMON` on a mill) the operand is a plain coordinate whatever
`xOperand` says: a radius word moves by it, a word written as a diameter by twice it (M10
review, NC-1).

A multiply or divide scales a distance like a position: incremental words, twins and
`IC()` values are scaled too, and the distance mode does not matter (M10 review, CODE-8).
What it would leave unscaled while the rest moves is refused instead (`not-scaled`): a
coordinate shift or set (`CodeEntry.shift`: `G52`, `G92`, `TRANS`) written with a chosen
axis, and, with the tool axis chosen, a cycle that writes another length parameter (a peck
depth `Q`, Klartext `Q201`, Sinumerik `SDIS`).

**Arc geometry** (NC-3). An absolute arc centre (`I=AC(50)`) and the intermediate point of
`CIP` (`CodeParam.axis`, absolute under `G90`) are positions of their axis and move with
the end point; one the script cannot compute refuses the arc (`arc-geometry`). `Z=AC(3.25)`
is an absolute position whatever the distance mode, `Z=IC(2)` an incremental one.

**The pole** (NC-2). The Klartext `CC` (`CodeEntry.pole: 'set'`) is a position of the plane
in force: an absolute pole moves with its axes, an incremental one (`CC IX+10`) is left (it
is relative to the last position, which moves anyway). The pole and the arcs and polar moves
around it (`pole: 'use'`) are one group: a pole that cannot be moved, a multiply or divide
of its plane, or an unknown plane refuses all of them (`pole`).

**Rotary axes** (NC-4). While tool centre point control is off and no frame is open, a
linear word is a position in the workpiece only while every rotary axis that turns it
(ISO 841: A and B turn Z, B and C turn X, A and C turn Y; on a lathe C does not turn X)
stands at zero (`gedit_nc.RotaryState`). A word written while one stands turned, at an
unknown angle, or before the program first writes it, is refused (`rotary-without-tcp`);
a C-axis lathe still shifts Z.

A block that writes a code the database does not know under the move letter, and nothing
the run would change, is not refused but listed once per code (`unknown-code-note`): the
code may change how the blocks after it are read. A program call (`CodeEntry.call`, `G65`)
that hands a chosen address a number is refused like a cycle nobody reviewed (NC-6).

**Roadmap R8.** A cycle parameter whose database entry carries `position: 'tool-axis'`
(`CodeParam.position`, §7.2) is an absolute coordinate on the tool axis, and a shift of the
tool axis moves it with the axis words: the `R` of a Fanuc mill drilling cycle, Klartext
`Q203`, Sinumerik `RTP`, `RFP`, `DP` and `FDEP`. The tool axis is `Z` while the plane in
force is `XY`. A parameter written as an address word follows the distance mode like any
word (`G91 G81 … R2.` is incremental); one written as a call argument or a Klartext Q
parameter is absolute by definition and is moved whatever the distance mode.

What it leaves as written, and lists
------------------------------------
Whole blocks (`severity: "warning"`, the first reason that applies):

* a code the database does not know under the letter the database writes its moves with;
* a machine position (`axisWords: 'machine'`: `G53`, `G28`, `M91`, `SUPA`, …);
* a block that opens a coordinate frame or runs inside one (the interpreter's `frame`);
* a block that moves a rotary axis together with a chosen linear one while tool centre
  point control is off (the interpreter's `tcp`);
* a cycle that cannot be judged: one with no reviewed parameter, a parameter nobody
  reviewed, an argument the database does not describe, a position of its own
  (`CYCL CALL POS`), a mode argument other than 0, a plane other than `XY`, a tool-axis
  position written as a variable, or a position whose reading depends on the machine.

**A cycle and the blocks that run it are moved together or not at all.** A Fanuc modal
cycle and every positioning block under it until it ends, a Klartext definition and every
call of it, a Sinumerik `MCALL` and its positions: when one of them is refused, all of them
are, because a call that runs a definition left as written — or a definition whose calls
are left — would put the hole somewhere nobody asked for.

Single words (`severity: "info"`, the rest of the block is changed): the words of a code
whose words are data (`G92`, `G52`, `G10`, a datum shift), incremental words (`G91`, an
incremental twin such as `W`, the Klartext `I` prefix — and every word while the distance
mode is not known), variables and expressions, words with no resolved value (every
machine-dependent word while no machine is chosen), and count parameters reached only
through the arc-centre option (`G83 … K3`).

Selections
----------
A run over a selection is primed from the lines above it (`input.precedingLines`), so the
distance mode, the plane, a frame and a cycle in force there are known. A cycle that
started above the selection and is moved there cannot be moved here, so the blocks in the
selection that run it are refused. Without the lines above, the run says so at its first
line and reads the selection from the top-of-program state, which leaves most words alone.

Everything outside the values it changes — line endings, spacing, block numbers, comments —
is handed back byte for byte: the only edits are the value spans of tokens.
"""

from __future__ import annotations

import sys
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc

#: The operations of the form.
OPERATIONS = ("add", "subtract", "multiply", "divide")

#: Addresses the form never offers and a context may not ask for: codes, block and program
#: numbers, tools.
NEVER = frozenset(("G", "M", "N", "O", "T"))

#: The tool axis a drilling cycle drills along while the plane in force is `XY` (R8).
TOOL_AXIS = "Z"

#: The axis each arc centre word belongs to (ISO: I is along X, J along Y, K along Z). The
#: `arcCentres` option adds the centre words of the chosen axes only.
ARC_AXIS = {"I": "X", "J": "Y", "K": "Z"}

#: A plane -> its two axes, for the pole (Klartext `CC`) of the plane in force.
PLANE_AXES = {"XY": ("X", "Y"), "ZX": ("Z", "X"), "YZ": ("Y", "Z")}

#: Sinumerik's value functions, as `extents.py` reads them: `Z=AC(3.25)` is absolute and
#: `X=IC(2)` incremental whatever the distance mode says, and a CAM post writes an absolute
#: arc centre as `I=AC(50)`. Only a plain number inside is a value; anything else is an
#: expression. (The code database has no flag for this yet; it is the one vocabulary here.)
VALUE_FUNCTIONS = {"AC": "absolute", "IC": "incremental"}

#: The parameter units of a cycle value that is no length (`CodeParam.unit`).
NOT_A_LENGTH = ("dwell", "count", "angle")

#: At most this many findings; the rest are counted in the message. The app takes 1000.
MAX_FINDINGS = 500

#: "As written" keeps the decimals a value was written with and adds at most this many for
#: what the result needs (a division can need infinitely many).
MAX_KEEP_DECIMALS = 4

#: How long a block or a word may be in a finding before it is cut.
QUOTE_LENGTH = 60

#: The order of the refusal reasons (README "The vocabulary"): a block gets the first one.
BLOCK_REASONS = (
    "unknown-code",
    "machine-position",
    "frame",
    "rotary-without-tcp",
    "cycle-outside",
    "cycle-not-reviewed",
    "cycle-position",
    "cycle-mode",
    "cycle-plane",
    "cycle-expression",
    "cycle-unresolved",
    "pole",
    "arc-geometry",
    "not-scaled",
)
WORD_REASONS = ("unreadable", "data", "incremental", "expression", "machine-dependent", "count")

#: What the summary calls a count of each reason (singular, plural).
REASON_TEXT = {
    "unknown-code": ("under a code the database does not know", None),
    "machine-position": ("machine position", "machine positions"),
    "frame": ("inside a frame", None),
    "rotary-without-tcp": ("rotary move without tool centre point control", "rotary moves without tool centre point control"),
    "cycle-outside": ("cycle started above the selection", "cycles started above the selection"),
    "cycle-not-reviewed": ("cycle not reviewed", "cycles not reviewed"),
    "cycle-position": ("cycle call with positions of its own", "cycle calls with positions of their own"),
    "cycle-mode": ("cycle in another mode", "cycles in another mode"),
    "cycle-plane": ("cycle outside the XY plane", "cycles outside the XY plane"),
    "cycle-expression": ("cycle with a variable position", "cycles with a variable position"),
    "cycle-unresolved": ("cycle whose position depends on the machine", "cycles whose position depends on the machine"),
    "pole": ("block around a pole that cannot be moved", "blocks around a pole that cannot be moved"),
    "arc-geometry": ("arc whose centre or intermediate point cannot be moved", "arcs whose centre or intermediate point cannot be moved"),
    "not-scaled": ("block a multiply or divide does not scale", "blocks a multiply or divide does not scale"),
    "unreadable": ("word that cannot be read", "words that cannot be read"),
    "data": ("data word", "data words"),
    "incremental": ("incremental word", "incremental words"),
    "expression": ("variable or expression", "variables or expressions"),
    "machine-dependent": ("word whose reading depends on the machine", "words whose reading depends on the machine"),
    "count": ("count", "counts"),
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def as_dict(value: Any) -> Dict[str, Any]:
    """``value`` when it is a dictionary, else an empty one — the context arrives as JSON."""
    return value if isinstance(value, dict) else {}


def decimal_text(value: Any) -> Optional[str]:
    """A form value as an exact decimal string, or ``None`` when it is not a number.

    A float is read through its ``repr``, the shortest text that reads back as the same
    double, and written without an exponent so that it parses as an NC number.
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
        return format(number, "f") if number.is_finite() else None
    if isinstance(value, str):
        text = value.strip()
        return text if gedit_nc.parse_number(text) is not None else None
    return None


def trim(value: Decimal) -> str:
    """A decimal as short text, never in exponent form: ``Decimal('0.50')`` is ``'0.5'``."""
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def frac_digits(value: Decimal) -> int:
    """The decimals ``value`` needs to be written exactly."""
    exponent = value.normalize().as_tuple().exponent
    return -exponent if isinstance(exponent, int) and exponent < 0 else 0


def count_text(count: int, singular: str, plural: Optional[str] = None) -> str:
    """``1 word`` / ``4 words``."""
    return "%s %s" % ("{:,}".format(count), singular if count == 1 else (plural or singular + "s"))


def and_list(words: Sequence[str]) -> str:
    """``Z`` / ``X and Z`` / ``X, Y and Z``."""
    words = list(words)
    if len(words) <= 1:
        return words[0] if words else ""
    return "%s and %s" % (", ".join(words[:-1]), words[-1])


def quote(text: str) -> str:
    """A block or a word as written, cut to a length a finding can carry."""
    text = text.strip()
    if len(text) > QUOTE_LENGTH:
        return text[: QUOTE_LENGTH - 1].rstrip() + "…"
    return text


is_assignment = gedit_nc.is_assignment


def value_span(token: gedit_nc.Token) -> Optional[Tuple[int, int]]:
    """Where a word's value stands in the line, or ``None`` when it cannot be told.

    The value is the end of the token's text (`Z-5.`, `IZ+5`, `Z=10`); anything else is not
    edited, because an edit that lands next to the value corrupts the block.
    """
    value = token.value_text or ""
    if value == "" or not token.text.endswith(value):
        return None
    return (token.end - len(value), token.end)


def function_value(token: gedit_nc.Token) -> Tuple[Optional[str], Optional[gedit_nc.NumericLiteral], Optional[Tuple[int, int]]]:
    """A word written with a value function (:data:`VALUE_FUNCTIONS`): its mode, the number
    inside and where that number stands, or ``(None, None, None)``.

    ``Z=AC(3.25)`` is ``('absolute', 3.25, span of '3.25')``; ``I=AC(R1)`` is
    ``('absolute', None, None)``: an absolute value the script cannot compute.
    """
    text = token.text
    value = token.value_text or ""
    if not value or not text.endswith(value) or not value.rstrip().endswith(")"):
        return None, None, None
    open_at = value.find("(")
    if open_at <= 0:
        return None, None, None
    mode = VALUE_FUNCTIONS.get(value[:open_at].strip().upper())
    if mode is None:
        return None, None, None
    close_at = value.rstrip().rfind(")")
    inner = value[open_at + 1 : close_at]
    stripped = inner.strip()
    literal = gedit_nc.parse_number(stripped) if stripped else None
    if literal is None:
        return mode, None, None
    base = token.end - len(value)
    start = base + open_at + 1 + (len(inner) - len(inner.lstrip()))
    return mode, literal, (start, start + len(stripped))


def split_arguments(text: str) -> List[Tuple[str, int, int]]:
    """The arguments of a call as written, with their spans inside ``text``.

    ``10, 0, ,-30`` is ``[('10', 0, 2), ('0', 4, 5), ('', 7, 7), ('-30', 8, 11)]``: an
    empty argument keeps its place, because a cycle reads its arguments by position, and the
    span is the stripped argument's. A comma inside a string, a bracket or a nested call
    (``AC(10)``) does not split.
    """
    out: List[Tuple[str, int, int]] = []
    depth = 0
    quoted = False
    start = 0

    def push(end: int) -> None:
        raw = text[start:end]
        lead = len(raw) - len(raw.lstrip())
        stripped = raw.strip()
        out.append((stripped, start + lead, start + lead + len(stripped)))

    for i, char in enumerate(text):
        if quoted:
            quoted = char != '"'
        elif char == '"':
            quoted = True
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            push(i)
            start = i + 1
    push(len(text))
    return out


# ---------------------------------------------------------------------------
# The form
# ---------------------------------------------------------------------------


class Params:
    """The run's parameters, checked. A value that cannot be used is an error, not a guess."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        operation = values.get("operation")
        if operation in (None, ""):
            operation = "add"
        if operation not in OPERATIONS:
            raise ValueError("Operation: %r is not add, subtract, multiply or divide." % (operation,))
        self.operation: str = operation
        self.additive = operation in ("add", "subtract")

        raw = values.get("operand")
        if raw is None or raw == "":
            raise ValueError("Value: enter the value to %s." % self.verb_phrase())
        text = decimal_text(raw)
        if text is None:
            raise ValueError("Value: %r is not a number." % (raw,))
        self.operand = Decimal(trim(Decimal(text)))
        self.operand_text = trim(self.operand)
        self.operand_decimals = frac_digits(self.operand)
        if operation == "divide" and self.operand == 0:
            raise ValueError("Value: a division by zero is not a number.")
        if operation == "multiply" and self.operand == 0:
            raise ValueError("Value: multiplying by zero would set every value to zero.")

        addresses = values.get("addresses")
        if addresses is None:
            addresses = ["Z"]
        if not isinstance(addresses, list) or not all(isinstance(a, str) for a in addresses):
            raise ValueError("Addresses: expected a list of address letters.")
        chosen: List[str] = []
        for address in addresses:
            word = address.strip().upper()
            if word == "" or not word.isalpha():
                raise ValueError("Addresses: %r is not an address." % (address,))
            if word in NEVER:
                raise ValueError("Addresses: %s is never changed by this script." % word)
            if word not in chosen:
                chosen.append(word)
        if not chosen:
            raise ValueError("Addresses: choose at least one address.")
        self.chosen = chosen

        arc = values.get("arcCentres")
        arc = arc if arc in ("auto", "yes", "no") else "auto"
        self.arc_choice = arc
        self.arc_centres = (not self.additive) if arc == "auto" else arc == "yes"

        x_operand = values.get("xOperand")
        self.x_operand = x_operand if x_operand in ("diameter", "radius") else "diameter"

        decimals = values.get("decimals")
        if decimals in (None, "", "keep"):
            self.decimals: Any = "keep"
        elif isinstance(decimals, bool):
            raise ValueError("Decimal places: %r is not a number of decimals." % (decimals,))
        elif isinstance(decimals, int) or (isinstance(decimals, str) and decimals.strip().isdigit()):
            count = int(decimals) if isinstance(decimals, int) else int(decimals.strip(), 10)
            if count < 0 or count > 10:
                raise ValueError("Decimal places: %d is outside 0 to 10." % count)
            self.decimals = count
        else:
            raise ValueError("Decimal places: %r is not a number of decimals." % (decimals,))

        self.fmt = gedit_nc.number_format_of(profile)

    def verb_phrase(self) -> str:
        return {"add": "add", "subtract": "subtract", "multiply": "multiply by", "divide": "divide by"}[self.operation]

    def apply(self, value: Decimal, factor: Decimal = Decimal(1)) -> Decimal:
        """The operation on one value; ``factor`` converts the operand (diameter or radius)."""
        with localcontext() as context:
            context.prec = 80
            context.rounding = ROUND_HALF_UP
            if self.operation == "add":
                return value + self.operand * factor
            if self.operation == "subtract":
                return value - self.operand * factor
            if self.operation == "multiply":
                return value * self.operand
            quotient = value / self.operand
            try:
                return quotient.quantize(Decimal(1).scaleb(-24), rounding=ROUND_HALF_UP)
            except InvalidOperation:  # pragma: no cover - only for absurd magnitudes
                return quotient


# ---------------------------------------------------------------------------
# What the run knows about the profile and the machine
# ---------------------------------------------------------------------------


class Setup:
    """The profile, the database and the machine, read once for the whole run."""

    def __init__(self, context: Dict[str, Any], profile: Dict[str, Any], codes: Sequence[Dict[str, Any]], params: Params) -> None:
        self.context = context
        self.profile = profile
        self.codes = list(codes)
        self.params = params
        addresses = as_dict(profile.get("addresses"))

        def upper_list(key: str) -> List[str]:
            found = addresses.get(key)
            return [str(a).upper() for a in found if isinstance(a, str) and a != ""] if isinstance(found, list) else []

        self.axes = frozenset(upper_list("axes"))
        self.angular = frozenset(upper_list("angular"))
        self.rotary = self.axes & self.angular
        self.linear = self.axes - self.angular
        self.arc_addresses = frozenset(upper_list("arcCenter"))
        #: Arc centres written as absolute coordinates by the profile (`arcCenterMode`).
        self.centre_absolute = addresses.get("arcCenterMode") == "absolute"
        self.diameter_words = frozenset(gedit_nc.diameter_axes(profile))
        #: M10 review (NC-1): only a turning profile reads X as a diameter by default and
        #: offers the X operand. A milling profile that lists diameter words (Sinumerik
        #: `DIAMON` on a mill) converts a word only by the mode it is written in.
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        self.twins = gedit_nc.incremental_axes(profile)
        tool = addresses.get("tool")
        spindle = addresses.get("spindle")
        #: Words of a cycle block that are not arguments of the cycle.
        self.not_arguments = frozenset(
            a.upper() for a in (tool, spindle, "N", "O") if isinstance(a, str) and a != ""
        )

        chosen = frozenset(params.chosen)
        self.chosen = chosen
        #: The arc centres of the chosen axes, added by the `arcCentres` option.
        self.via_arcs = (
            frozenset(c for c in self.arc_addresses if ARC_AXIS.get(c) in chosen) - chosen
            if params.arc_centres
            else frozenset()
        )
        self.targets = chosen | self.via_arcs
        #: Incremental twins of a chosen axis, and chosen twins: always left and reported.
        self.twin_targets = frozenset(t for t, axis in self.twins.items() if axis in chosen or t in chosen)
        self.words = self.targets | self.twin_targets
        #: Whether the run moves positions at all: a cycle can only be judged against that.
        self.touches_positions = bool(chosen & (self.axes | frozenset(self.twins)))
        self.moves_tool_axis = TOOL_AXIS in chosen
        self.chosen_linear = chosen & self.linear

        self.letters = motion_letters(self.codes)
        self.machine = gedit_nc.machine_params(context)
        machine_params = as_dict(self.machine.get("params"))
        self.power_on_units = machine_params.get("units") if machine_params.get("units") in ("mm", "inch") else "mm"
        self.chosen_numbers = as_dict(self.machine.get("source")).get("numberInput") == "machine"
        decl = as_dict(profile.get("machineParams"))
        presets = as_dict(decl.get("numberInput")).get("presets")
        #: The presets a no-machine result has to agree with (AD-31 "no machine, no guess").
        self.presets = (
            [{"numberInput": p.get("value")} for p in presets if isinstance(p, dict) and isinstance(p.get("value"), dict)]
            if isinstance(presets, list) and not self.chosen_numbers
            else []
        )
        self._resolved: Dict[Any, Tuple[Optional[str], List[Dict[str, Any]]]] = {}

    def resolve(self, literal: gedit_nc.NumericLiteral, cls: str, units: str) -> Tuple[Optional[str], List[Dict[str, Any]]]:
        key = (literal.raw, literal.has_point, cls, units)
        found = self._resolved.get(key)
        if found is None:
            found = gedit_nc.resolve_value(literal, cls, self.machine, self.profile, units)
            self._resolved[key] = found
        return found


def motion_letters(codes: Sequence[Dict[str, Any]]) -> frozenset:
    """The letters the database writes its moves with: `G` on the ISO dialects, none on Klartext.

    A code under such a letter decides what the block's words are (a machine position, a
    frame), so one the database does not know refuses the block (README `unknown-code`).
    """
    out = set()
    for entry in codes or ():
        code = entry.get("code") if isinstance(entry, dict) else None
        if entry.get("group") == "motion" and isinstance(code, str) and len(code) > 1 and code[0].isalpha() and code[1].isdigit():
            out.add(code[0].upper())
    return frozenset(out)


def sets_of(entry: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    sets = entry.get("sets") if isinstance(entry, dict) else None
    return sets if isinstance(sets, dict) else {}


def params_of(entry: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    params = entry.get("params") if isinstance(entry, dict) else None
    return [p for p in params if isinstance(p, dict)] if isinstance(params, list) else []


def param_named(entry: Optional[Dict[str, Any]], address: str) -> Optional[Dict[str, Any]]:
    # B1: the first declaration answers for both blocks of a two-block cycle; its `position`
    # and `unit` are the same in both (`gedit_nc.params_of_block` has the block's labels).
    for param in params_of(entry):
        written = param.get("address")
        if isinstance(written, str) and written.upper() == address.upper():
            return param
    return None


def param_axis(codes: Sequence[Dict[str, Any]], address: str) -> Optional[str]:
    """The axis a parameter of one of ``codes`` is a coordinate of (`CodeParam.axis`, the
    intermediate point `I1=` of `CIP`), or ``None``."""
    for entry in codes:
        param = param_named(entry, address)
        axis = param.get("axis") if param is not None else None
        if isinstance(axis, str) and axis != "":
            return axis.upper()
    return None


def reviewed(entry: Optional[Dict[str, Any]]) -> bool:
    """Whether anybody reviewed the entry's parameters for R8: at least one carries a role."""
    return any(gedit_nc.position_of(param) is not None for param in params_of(entry))


def code_of(entry: Optional[Dict[str, Any]], fallback: str = "the cycle") -> str:
    code = entry.get("code") if isinstance(entry, dict) else None
    return code if isinstance(code, str) and code != "" else fallback


# ---------------------------------------------------------------------------
# One block
# ---------------------------------------------------------------------------


class Line:
    """One line of the program: its text, its tokens, its number in the document."""

    __slots__ = ("index", "number", "text", "tokens", "inside")

    def __init__(self, index: int, number: int, text: str, tokens: List[gedit_nc.Token], inside: bool) -> None:
        self.index = index
        self.number = number
        self.text = text
        self.tokens = tokens
        self.inside = inside


class Arg:
    """A value a cycle block writes: a word, a Klartext Q parameter or a call argument.

    ``literal`` is the number as written, or ``None`` for a variable or an expression;
    ``span`` is where the value stands in its line; ``position`` is the place of a call
    argument (1-based), which is how a cycle reads it.
    """

    __slots__ = ("name", "text", "literal", "line", "span", "token", "kind", "position")

    def __init__(
        self,
        name: str,
        text: str,
        literal: Optional[gedit_nc.NumericLiteral],
        line: Line,
        span: Optional[Tuple[int, int]],
        token: Optional[gedit_nc.Token],
        kind: str,
        position: int = 0,
    ) -> None:
        self.name = name
        self.text = text
        self.literal = literal
        self.line = line
        self.span = span
        self.token = token
        self.kind = kind  # 'word' | 'q' | 'call'
        self.position = position


class Block:
    """What one block says: its codes, its values, and what this run makes of them."""

    def __init__(self, lines: List[Line]) -> None:
        self.lines = lines
        self.first = lines[0]
        self.inside = lines[0].inside
        #: (entry, token kind, token) of every code the block writes, in written order.
        self.entries: List[Tuple[Dict[str, Any], str, gedit_nc.Token]] = []
        #: The first code under a move letter the database does not know.
        self.unknown: Optional[str] = None
        #: A cycle definition whose number the database does not know (`CYCL DEF 251`).
        self.generic_cycle: Optional[str] = None
        #: Value words that are not codes, with their lines.
        self.words: List[Tuple[gedit_nc.Token, Line]] = []
        #: Klartext `Q203=+0` parameters.
        self.q_args: List[Arg] = []
        #: (entry or None, call token, line) of every call.
        self.calls: List[Tuple[Optional[Dict[str, Any]], gedit_nc.Token, Line]] = []
        #: A keyword that makes the call behind it modal (`sets.cycle: 'call-modal-next'`, `MCALL`).
        self.modal_keyword = False
        #: The entries of this block's cycle calls (`CYCL CALL POS`, `M99`).
        self.call_entries: List[Dict[str, Any]] = []
        #: Whether the block opens a coordinate frame (set while it is judged).
        self.opens_frame = False
        # What the run decides.
        self.refusal: Optional[Tuple[str, str]] = None
        self.edits: List[Tuple[Line, int, int, str]] = []
        #: (line, reason, message) of every word left as written.
        self.word_findings: List[Tuple[int, str, str]] = []
        #: (line, message) of every value that had to be rounded.
        self.notes: List[Tuple[int, str]] = []
        self.changed = 0
        self.cycle_changed = 0
        #: Arc centres changed only because of the `arcCentres` option.
        self.arc_changed = 0
        self.group: Optional["Group"] = None
        #: M10 review (NC-4): the chosen linear words of the block, the rotary axes turning
        #: them that stand turned or unknown, those not written yet, and whether the block
        #: writes one of the turning axes itself.
        self.tilt_words: List[str] = []
        self.tilt_turned: frozenset = frozenset()
        self.tilt_pending: frozenset = frozenset()
        self.tilt_moves = False
        #: The same for the tool axis, which a cycle's tool-axis positions lie on.
        self.tilt_tool: Tuple[frozenset, frozenset] = (frozenset(), frozenset())
        #: Whether the block sets the pole (`CodeEntry.pole: 'set'`).
        self.pole_set = False

    @property
    def number(self) -> int:
        return self.first.number

    def as_written(self) -> str:
        return quote(self.first.text)

    def codes(self) -> List[Dict[str, Any]]:
        return [entry for entry, _, _ in self.entries]

    def clear(self) -> None:
        """Forgets every change: the block is left as written."""
        self.edits = []
        self.word_findings = []
        self.notes = []
        self.changed = 0
        self.cycle_changed = 0
        self.arc_changed = 0


class Group:
    """A cycle and the blocks that run it: moved together or not at all.

    ``kind`` says how the cycle runs: ``'modal'`` (a word that stays in force until it is
    cancelled, Fanuc `G81`), ``'single'`` (a one-shot word, a lathe `G71`), ``'call'`` (a call,
    `CYCLE81(…)`, repeated after every position behind `MCALL`), ``'define'`` (a definition
    and its calls, Klartext), ``'undefined'`` (a call with no reviewed definition) and
    ``'macro'`` (a modal macro call, `G66`).
    """

    def __init__(self, kind: str, entry: Optional[Dict[str, Any]], line: int) -> None:
        self.kind = kind
        self.entry = entry
        self.line = line
        self.members: List[Block] = []


def joined_code(entry_of: Any, name: str, number: Optional[str]) -> Optional[str]:
    """A keyword and the number behind it as one code, when the database knows it.

    The interpreter's own rule: `CYCL DEF 200` is that cycle's entry, and a sub-block written
    with a decimal part (`CYCL DEF 7.1`) is the cycle it belongs to.
    """
    if number is None:
        return None
    joined = "%s %s" % (name, number)
    if entry_of(joined) is not None:
        return joined
    whole, dot, part = number.partition(".")
    if dot == "." and whole.isdigit() and part.isdigit():
        joined = "%s %s" % (name, whole)
        if entry_of(joined) is not None:
            return joined
    return None


def has_number(text: str, name: str) -> bool:
    """Whether the arguments of a call written as ``text`` (behind its ``name``) hold a digit."""
    return any(ch.isdigit() for ch in text[len(name) :])


def read_block(block: Block, entry_of: Any, letters: frozenset) -> None:
    """Fills in what the block writes, from its tokens and the database."""
    for line in block.lines:
        tokens = line.tokens
        count = len(tokens)
        consumed = -1
        i = 0
        while i < count:
            token = tokens[i]
            kind = token.kind
            if kind == "word":
                address = (token.address or "").upper()
                if address != "" and i != consumed:
                    value = token.value_text or ""
                    entry = entry_of(address + value) if value != "" and not is_assignment(token) else None
                    if entry is not None:
                        block.entries.append((entry, "word", token))
                    elif value != "" and address in letters and not is_assignment(token):
                        if block.unknown is None:
                            block.unknown = token.text.strip()
                    else:
                        block.words.append((token, line))
            elif kind == "call":
                entry = entry_of(token.address or "")
                block.calls.append((entry, token, line))
                if entry is not None:
                    block.entries.append((entry, "call", token))
            elif kind == "keyword":
                name = token.address or token.text
                number = token.value_text
                behind = -1
                if number is None:
                    for j in range(i + 1, count):
                        nxt = tokens[j]
                        if nxt.kind == "whitespace":
                            continue
                        if nxt.kind == "word" and nxt.address is None and nxt.value_text is not None:
                            number = nxt.value_text
                            behind = j
                        break
                joined = joined_code(entry_of, name, number)
                entry = entry_of(joined) if joined is not None else entry_of(name)
                if entry is not None:
                    block.entries.append((entry, "keyword", token))
                    if entry.get("group") == "cycle":
                        if joined is None and behind >= 0:
                            block.generic_cycle = "%s %s" % (name, number)
                        if sets_of(entry).get("cycle") == "call-modal-next":
                            block.modal_keyword = True
                if behind >= 0:
                    consumed = behind
            elif kind == "variable":
                # Klartext writes a cycle parameter as `Q203=+0`: a Q parameter, `=` and its
                # value. `Q203=+Q10` is an expression.
                j = i + 1
                while j < count and tokens[j].kind == "whitespace":
                    j += 1
                if j < count and tokens[j].kind == "operator" and tokens[j].text.strip() == "=":
                    k = j + 1
                    while k < count and tokens[k].kind == "whitespace":
                        k += 1
                    end = k
                    while end < count and tokens[end].kind not in ("comment", "continuation"):
                        end += 1
                    values = [t for t in tokens[k:end] if t.kind != "whitespace"]
                    if values:
                        first, last = values[0], values[-1]
                        literal = None
                        span = None
                        if len(values) == 1 and first.kind == "word" and first.address is None and first.value is not None:
                            literal = first.value
                            span = (first.start, first.end)
                        text = line.text[first.start : last.end]
                        block.q_args.append(Arg(token.text.strip().upper(), text, literal, line, span, first, "q"))
                    i = end
                    continue
            i += 1


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------


class Findings:
    """The findings of a run, capped so that a huge program cannot flood the panel."""

    def __init__(self, limit: int = MAX_FINDINGS) -> None:
        self.items: List[Dict[str, Any]] = []
        self.dropped = 0
        self.limit = limit

    def add(self, line: int, severity: str, message: str, reason: str) -> None:
        if len(self.items) >= self.limit:
            self.dropped += 1
            return
        self.items.append({"line": line, "severity": severity, "message": message, "reason": reason})


#: A value the run would change, or why it leaves it: ``('edit', line, start, end, text,
#: rounded, written, is_cycle)``, ``('skip', line, reason, message, written)`` or ``('same',)``.
Outcome = Tuple[Any, ...]


class Run:
    """Walks the program once, judges every block, then settles the cycles."""

    def __init__(self, setup: Setup, cp: gedit_nc.CompiledProfile) -> None:
        self.setup = setup
        self.params = setup.params
        self.cp = cp
        self.interp = gedit_nc.ModalInterpreter(cp, setup.codes)
        self._entries: Dict[str, Optional[Dict[str, Any]]] = {}
        self._as_written: Dict[Any, bool] = {}
        self._classes: Dict[Any, Optional[str]] = {}
        self.blocks: List[Block] = []
        self.groups: List[Group] = []
        # The cycles in force.
        self.iso_group: Optional[Group] = None
        self.defined: Optional[Group] = None
        self.modal_call = False
        self.mcall: Optional[Group] = None
        self.macro: Optional[Group] = None
        self.macro_group: Optional[str] = None
        #: The pole in force (Klartext `CC`) and its group, while the run touches its plane.
        self.pole: Optional[Group] = None
        #: Where the rotary axes stand while nothing compensates them (NC-4).
        self.rotary = gedit_nc.RotaryState(setup.profile)
        #: Codes the database lacks, met in blocks the run had nothing to change in (NC-5):
        #: code -> [first line, blocks].
        self.unknown_seen: Dict[str, List[int]] = {}

    def entry(self, code: str) -> Optional[Dict[str, Any]]:
        """The database entry of a written code, remembered per spelling."""
        if code in self._entries:
            return self._entries[code]
        found = self.interp.entry(code) if code else None
        self._entries[code] = found
        return found

    # -- the walk ---------------------------------------------------------------

    def walk(self, lines: Sequence[str], first_number: int, inside_from: int) -> None:
        """Reads every line; ``inside_from`` is the index of the first line of the selection."""
        cp = self.cp
        state: Optional[gedit_nc.LineState] = None
        pending: List[Line] = []
        for index, text in enumerate(lines):
            head = gedit_nc.continues_block(text, cp)
            continued = (state.continuation if state is not None else False) or head
            if pending and not continued:
                self.finish(pending)
                pending = []
            tokens, state = gedit_nc.tokenize_line(text, cp, state)
            self.interp.update(tokens, first_number + index, "", continued=head)
            pending.append(Line(index, first_number + index, text, tokens, index >= inside_from))
        if pending:
            self.finish(pending)

    def finish(self, lines: List[Line]) -> None:
        """One whole block has been read: judge it in the state it leaves behind."""
        block = Block(lines)
        read_block(block, self.entry, self.setup.letters)
        self.track_rotary(block)
        group = self.place(block)
        frame = self.interp.frame
        block.opens_frame = frame is not None and any(line.number == frame["line"] for line in lines)
        if not self.relevant(block, group):
            if block.unknown is not None and block.inside:
                seen = self.unknown_seen.setdefault(block.unknown, [block.number, 0])
                seen[1] += 1
            return
        self.judge(block, group)
        if group is not None:
            group.members.append(block)
            block.group = group
        self.blocks.append(block)

    def linear_of(self, address: str, codes: List[Dict[str, Any]]) -> Optional[str]:
        """The linear axis a chosen word is a position or a distance of, or ``None``."""
        setup = self.setup
        if address in setup.linear:
            return address
        twin = setup.twins.get(address)
        if twin is not None:
            return twin if twin in setup.linear else None
        paired = ARC_AXIS.get(address)
        if paired is not None and address in setup.arc_addresses:
            return paired
        axis = param_axis(codes, address)
        return axis if axis in setup.linear else None

    def track_rotary(self, block: Block) -> None:
        """NC-4: where the rotary axes stand after this block, and which of its chosen linear
        words they turn while tool centre point control is off."""
        rotary = self.rotary
        if not rotary.rotary:
            return
        setup = self.setup
        codes = block.codes()
        distance = self.interp.state.get("distance")
        words: List[Tuple[str, Any, Optional[bool]]] = []
        writes = set()
        for token, _ in block.words:
            address = (token.address or "").upper()
            axis = rotary.axis_of(address)
            if axis is None or (token.value_text or "") == "":
                continue
            literal = token.value
            mode = None
            if literal is None:
                mode, literal, _ = function_value(token)
            if address in rotary.twins or token.incremental or mode == "incremental":
                incremental: Optional[bool] = True
            elif mode == "absolute" or distance == "absolute":
                incremental = False
            elif distance == "incremental":
                incremental = True
            else:
                incremental = None
            words.append((address, literal, incremental))
            writes.add(axis)
        before = dict(rotary.state)
        flags = [gedit_nc.axis_words_of(entry) for entry in codes]
        # The words of a data block (a macro call's `A1.`, a coordinate set) move no axis; a
        # machine position does, to a place the program's frame does not state.
        if words and "data" not in flags:
            rotary.update(words, block.number, "machine" in flags)
        if self.interp.tcp is not None:
            return
        after = rotary.state
        if TOOL_AXIS in setup.linear:
            block.tilt_tool = rotary.blocking(TOOL_AXIS, before, after)
        turned = set()
        pending = set()
        moved: List[str] = []
        for token, _ in block.words:
            address = (token.address or "").upper()
            if (token.value_text or "") == "" or address not in setup.words:
                continue
            linear = self.linear_of(address, codes)
            if linear is None:
                continue
            hit, unwritten = rotary.blocking(linear, before, after)
            if hit or unwritten:
                if address not in moved:
                    moved.append(address)
                turned |= hit
                pending |= unwritten
                if hit & writes:
                    block.tilt_moves = True
        block.tilt_words = moved
        block.tilt_turned = frozenset(turned)
        block.tilt_pending = frozenset(pending)

    # -- cycles -----------------------------------------------------------------

    def new_group(self, kind: str, entry: Optional[Dict[str, Any]], line: int) -> Group:
        group = Group(kind, entry, line)
        self.groups.append(group)
        return group

    def place(self, block: Block) -> Optional[Group]:
        """The cycle group this block belongs to, or ``None`` (README "What R8 decides").

        Driven by the database's ``sets.cycle`` values and flags and by no dialect name.
        """
        interp = self.interp
        entries = block.entries
        positions = self.positions(block)

        # The pole (Klartext `CC`, `CodeEntry.pole`) and the arcs and polar moves around it,
        # until the next pole: moved together or not at all (M10 review, NC-2). Only while
        # the run touches an axis of the plane the pole lies in; a Z shift in the XY plane
        # leaves the polar contour to its own Z words.
        poles = [entry.get("pole") for entry, _, _ in entries]
        if "set" in poles:
            block.pole_set = True
            self.pole = self.new_group("pole", None, block.number) if self.pole_touched() else None
            return self.pole
        if "use" in poles and self.pole is not None:
            return self.pole

        # A modal macro call (`G66`): a modal entry whose words are data, until another
        # modal code of its group (`G67`).
        for entry, _, _ in entries:
            group = entry.get("group")
            if entry.get("modal") is not True or not isinstance(group, str):
                continue
            if entry.get("wordsAreData") is True:
                self.macro = self.new_group("macro", entry, block.number)
                self.macro_group = group
                return self.macro
            if self.macro is not None and group == self.macro_group:
                self.macro = None
                self.macro_group = None
        if self.macro is not None and positions:
            return self.macro

        cycles = [(e, k) for e, k, _ in entries if sets_of(e).get("cycle") in ("start", "define", "call", "call-modal")]

        # A definition, known or not, replaces the one before it and ends a modal call.
        defines = [e for e, _ in cycles if sets_of(e).get("cycle") == "define"]
        if defines or block.generic_cycle is not None:
            self.defined = self.new_group("define", defines[-1] if defines else None, block.number)
            self.modal_call = False
            return self.defined
        calls = [e for e, _ in cycles if sets_of(e).get("cycle") in ("call", "call-modal")]
        if calls:
            block.call_entries = calls
            self.modal_call = any(sets_of(e).get("cycle") == "call-modal" for e in calls)
            if self.defined is None:
                return self.new_group("undefined", None, block.number)
            return self.defined
        if self.modal_call and positions and self.defined is not None:
            return self.defined

        # A cycle written as a call (`CYCLE81(…)`), repeated behind `MCALL`.
        starts = [(e, k) for e, k in cycles if sets_of(e).get("cycle") == "start"]
        call_starts = [e for e, k in starts if k == "call"]
        # A call the database does not know, with a number among its arguments
        # (`CYCLE76(50,0,2,-1,…)`, `CYCLE77(…)`: Sinumerik cycles the database does not
        # describe): a cycle nobody described may hold absolute positions that a shift of
        # the tool axis has to move with the axis words, so it is refused and listed, never
        # skipped in silence (found at the M10 integration: the Sinumerik face-milling cycle
        # stayed where it was while every Z word around it moved).
        unknown_call = any(e is None and has_number(t.text, t.address or "") for e, t, _ in block.calls)
        if call_starts or unknown_call or (block.modal_keyword and block.calls):
            group = self.new_group("call", call_starts[-1] if call_starts else None, block.number)
            self.mcall = group if block.modal_keyword else self.mcall
            return group
        if block.modal_keyword and not block.calls:
            self.mcall = None
        if self.mcall is not None and positions:
            return self.mcall

        # A cycle written as a word: in force until the interpreter says it is over.
        active = interp.active_cycle if interp.modal_call is None else None
        word_starts = [e for e, k in starts if k in ("word", "keyword")]
        if word_starts:
            modal = [e for e in word_starts if e.get("modal") is True]
            if modal and active is not None:
                if self.iso_group is None:
                    self.iso_group = self.new_group("modal", modal[-1], block.number)
                self.iso_group.entry = self.entry(active) or modal[-1]
                return self.iso_group
            self.iso_group = None
            return self.new_group("single", word_starts[-1], block.number)
        if active is None:
            self.iso_group = None
            return None
        group = self.iso_group
        if group is not None and (positions or self.writes_cycle_data(block, group.entry)):
            group.entry = self.entry(active) or group.entry
            return group
        return None

    def pole_touched(self) -> bool:
        """Whether the run changes an axis of the plane in force (any axis, when the plane is
        not known): then the pole and the moves around it are judged together."""
        pair = PLANE_AXES.get(self.interp.state.get("plane") or "")
        axes = frozenset(pair) if pair is not None else frozenset(("X", "Y", "Z"))
        return bool(self.setup.chosen & axes)

    def positions(self, block: Block) -> bool:
        """A positioning block: an axis word with a value, and no code that makes it data."""
        axes = self.setup.axes
        if not any(
            (t.address or "").upper() in axes and (t.value_text or "") != "" and not is_assignment(t)
            for t, _ in block.words
        ):
            return False
        return not any(gedit_nc.axis_words_of(entry) == "data" for entry in block.codes())

    def writes_cycle_data(self, block: Block, entry: Optional[Dict[str, Any]]) -> bool:
        """A block under a modal cycle that writes one of its parameters (`R3.` alone)."""
        return any(
            (t.value_text or "") != "" and param_named(entry, t.address or "") is not None for t, _ in block.words
        )

    def relevant(self, block: Block, group: Optional[Group]) -> bool:
        """A block this run would change, a frame it opens, or a cycle whose positions it moves."""
        setup = self.setup
        words = setup.words
        for token, line in block.words:
            if (token.address or "").upper() in words:
                if (token.value_text or "") != "":
                    return True
                # NC-5: a chosen word that cannot be read is reported (`judge`).
                if gedit_nc.unreadable_value(token, line.tokens) is not None:
                    return True
        if not setup.touches_positions:
            return False
        return group is not None or block.opens_frame

    # -- judging ----------------------------------------------------------------

    def judge(self, block: Block, group: Optional[Group]) -> None:
        """Decides the block: refused with one reason, or its edits and word findings."""
        setup = self.setup
        interp = self.interp
        state = interp.state
        codes = block.codes()

        refusal = self.block_refusal(block, state, codes)
        if refusal is not None:
            block.refusal = refusal
            return

        # Which values the run changes: the words of the chosen addresses, and (R8) the
        # cycle positions on the tool axis.
        cycle_words: Dict[int, bool] = {}
        cycle_args: List[Tuple[Arg, Optional[str]]] = []
        pole_words: set = set()
        if group is not None:
            if group.kind == "pole":
                refusal = self.judge_pole(block, state, pole_words)
            else:
                refusal = self.judge_cycle(block, group, state, cycle_words, cycle_args)
            if refusal is not None:
                block.refusal = refusal
                return
        if (cycle_words or cycle_args) and interp.tcp is None:
            # NC-4: a cycle's tool-axis positions (the R plane, Q203, RFP) are Z coordinates
            # too, turned by the same rotary axes.
            turned, pending = block.tilt_tool
            names = sorted(
                {arg.name for arg, _ in cycle_args} | {(t.address or "").upper() for t, _ in block.words if id(t) in cycle_words}
            )
            if turned:
                block.refusal = (
                    "rotary-without-tcp",
                    "writes the cycle position %s while %s %s turned (or %s angle is not known) and tool centre point control is off: the tool tip does not move by the shift there"
                    % (and_list(names), and_list(sorted(turned)), "is" if len(turned) == 1 else "are", "its" if len(turned) == 1 else "their"),
                )
                return
            if pending:
                block.tilt_pending = block.tilt_pending | pending
                block.tilt_words = block.tilt_words + [n for n in names if n not in block.tilt_words]

        data = next((code_of(e) for e in codes if gedit_nc.axis_words_of(e) == "data"), None)
        in_force = [group.entry] if group is not None and group.kind == "modal" and isinstance(group.entry, dict) else []
        outcomes: List[Outcome] = []
        geometry: List[Outcome] = []
        for token, line in block.words:
            address = (token.address or "").upper()
            if (token.value_text or "") == "":
                # M13 review (NC-5): `Z–5.` with a dash pasted for the minus sign is the address
                # alone, a character no control reads and a bare number. Left as written, and
                # said so: the user asked for every Z.
                unreadable = gedit_nc.unreadable_value(token, line.tokens) if address in setup.words else None
                if unreadable is not None:
                    written, why = unreadable
                    outcomes.append(("skip", line, "unreadable", "%s: %s; left as written" % (written, why), written))
                continue
            is_cycle = id(token) in cycle_words
            # NC-3: an absolute arc centre (`I=AC(50)`) or a `CIP` intermediate point is a
            # position of its axis, moved with the end point or the arc is not left whole.
            geo = self.geometry_of(token, address, codes)
            if geo is not None and geo[1] in setup.chosen:
                if geo[0] == "expression":
                    block.refusal = (
                        "arc-geometry",
                        "%s is a coordinate of the arc that cannot be computed, so the arc cannot be moved or scaled with its end point"
                        % quote(token.text),
                    )
                    return
                outcome = self.word_outcome(token, line, address, state, codes, in_force, None, False, geo)
                outcomes.append(outcome)
                geometry.append(outcome)
                continue
            if address not in setup.words and not is_cycle:
                continue
            word_data = None if id(token) in pole_words else data
            outcomes.append(self.word_outcome(token, line, address, state, codes, in_force, word_data, is_cycle))
        for arg, cls in cycle_args:
            outcomes.append(self.arg_outcome(arg, cls, state))

        if geometry and any(o[0] == "edit" for o in outcomes):
            bad = next((o for o in geometry if o[0] == "skip"), None) or next(
                (o for o in outcomes if o[0] == "skip" and o[2] in ("expression", "machine-dependent", "unreadable")), None
            )
            if bad is not None:
                why = bad[3].split(": ", 1)[-1]
                block.refusal = (
                    "arc-geometry",
                    "%s cannot be changed (%s), so the arc's end point, centre and intermediate point cannot be changed together"
                    % (bad[4], why),
                )
                return

        if group is not None:
            # A cycle is moved in one piece or not at all (R8), and so is the contour around
            # a pole (NC-2).
            for outcome in outcomes:
                if outcome[0] == "skip" and outcome[2] in ("expression", "machine-dependent", "unreadable"):
                    why = outcome[3].split(": ", 1)[-1]
                    if group.kind == "pole":
                        block.refusal = (
                            "pole",
                            "%s cannot be moved (%s), so the pole and the moves around it cannot be moved in one piece"
                            % (outcome[4], why),
                        )
                        return
                    reason = "cycle-expression" if outcome[2] in ("expression", "unreadable") else "cycle-unresolved"
                    block.refusal = (reason, "%s cannot be moved (%s), so the cycle cannot be moved in one piece" % (outcome[4], why))
                    return

        for outcome in outcomes:
            kind = outcome[0]
            if kind == "edit":
                _, line, start, end, text, rounded, written, is_cycle = outcome
                block.edits.append((line, start, end, text))
                block.changed += 1
                if outcome[6].upper().startswith(tuple(setup.via_arcs)) and not is_cycle:
                    block.arc_changed += 1
                if is_cycle:
                    block.cycle_changed += 1
                if rounded:
                    old_value = line.text[start:end]
                    new_word = written[: len(written) - len(old_value)] + text if written.endswith(old_value) else text
                    block.notes.append(
                        (
                            line.number,
                            "%s: written as %s, rounded half away from zero to what the word's form can hold"
                            % (written, new_word),
                        )
                    )
            elif kind == "skip":
                _, line, reason, message, _ = outcome
                block.word_findings.append((line.number, reason, message))

    def block_refusal(self, block: Block, state: Dict[str, Any], codes: List[Dict[str, Any]]) -> Optional[Tuple[str, str]]:
        """The first of the block reasons that are not about a cycle, or ``None``."""
        setup = self.setup
        interp = self.interp
        if block.unknown is not None:
            return (
                "unknown-code",
                "%s is not in the code database, and a code nobody described may be a machine position or a frame"
                % block.unknown,
            )
        for entry in codes:
            if gedit_nc.axis_words_of(entry) == "machine":
                return (
                    "machine-position",
                    "a machine position (%s): its positions are not in the program's coordinates, so a shift of the program does not apply to them"
                    % code_of(entry),
                )
        frame = interp.frame
        if frame is not None:
            if block.opens_frame:
                where = "opens a coordinate frame (%s)" % frame["code"]
            else:
                where = "inside the coordinate frame of %s (line %d)" % (frame["code"], frame["line"])
            return ("frame", where + ": what a shift of the program's coordinates does there cannot be judged")
        if interp.tcp is None and block.tilt_turned:
            # NC-4: a linear word is a position in the workpiece only while every rotary axis
            # that turns it (ISO 841) stands at zero; the rotary position stays in force after
            # the block that wrote it.
            rotary = sorted(block.tilt_turned)
            if block.tilt_moves:
                return (
                    "rotary-without-tcp",
                    "moves %s together with %s while tool centre point control is off: the tool tip does not move by the shift there"
                    % (and_list(rotary), and_list(block.tilt_words)),
                )
            return (
                "rotary-without-tcp",
                "writes %s while %s %s turned (or %s angle is not known) and tool centre point control is off: the tool tip does not move by the shift there"
                % (and_list(block.tilt_words), and_list(rotary), "is" if len(rotary) == 1 else "are", "its" if len(rotary) == 1 else "their"),
            )
        for entry in codes:
            if entry.get("call") is not True:
                continue
            # NC-6: a program call hands the block's words to another program, and a probing
            # or protected-move macro takes absolute positions there.
            hits = [
                quote(t.text)
                for t, _ in block.words
                if (t.address or "").upper() in setup.words and any(ch.isdigit() for ch in (t.value_text or ""))
            ]
            if hits:
                return (
                    "cycle-not-reviewed",
                    "%s runs another program and hands it %s, which may be a position of this program that nobody described"
                    % (code_of(entry), and_list(hits)),
                )
        if not self.params.additive:
            for entry in codes:
                if entry.get("shift") is not True:
                    continue
                hits = [
                    quote(t.text)
                    for t, _ in block.words
                    if (t.address or "").upper() in setup.words
                    and ((t.address or "").upper() in setup.axes or (t.address or "").upper() in setup.twins)
                    and (t.value_text or "") != ""
                ]
                if hits:
                    return (
                        "not-scaled",
                        "%s shifts or sets the coordinate system by %s, and whether that shift scales with the program cannot be judged"
                        % (code_of(entry), and_list(hits)),
                    )
        return None

    def judge_pole(self, block: Block, state: Dict[str, Any], pole_words: set) -> Optional[Tuple[str, str]]:
        """NC-2: the pole and the moves around it. An absolute pole is a position of the plane
        in force and moves with its axes; an incremental one (`CC IX+10`) is relative to the
        last position, which moves anyway, and is left."""
        setup = self.setup
        if not self.params.additive:
            return (
                "pole",
                "a multiply or divide cannot scale the polar radii of the moves around the pole with it, so the pole and those moves are left as written",
            )
        if not block.pole_set:
            return None
        pair = PLANE_AXES.get(state.get("plane") or "")
        written = [
            token
            for token, _ in block.words
            if (token.address or "").upper() in setup.axes and (token.value_text or "") != ""
        ]
        if pair is None:
            if any((t.address or "").upper() in setup.words for t in written):
                return ("pole", "the working plane is not known here, so the axes the pole lies on are not certain")
            return None
        for token in written:
            if (token.address or "").upper() in pair:
                pole_words.add(id(token))
        return None

    def geometry_of(self, token: gedit_nc.Token, address: str, codes: List[Dict[str, Any]]) -> Optional[Tuple[str, str]]:
        """NC-3: ``(mode, axis)`` for a word that is a coordinate of an arc other than its end
        point — a `CIP` intermediate point (`CodeParam.axis`; ``'follows'`` the distance mode,
        or the mode of its value function) or an absolute centre (`I=AC(50)`, or a centre of
        a profile whose `arcCenterMode` is absolute) — and ``'expression'`` for one the script
        cannot compute; ``None`` for every other word."""
        setup = self.setup
        axis = param_axis(codes, address)
        if axis is not None:
            if token.value is not None:
                return ("follows", axis)
            mode, literal, _ = function_value(token)
            return (mode, axis) if mode is not None and literal is not None else ("expression", axis)
        paired = ARC_AXIS.get(address)
        if paired is None or address not in setup.arc_addresses:
            return None
        if token.value is not None:
            return ("absolute", paired) if setup.centre_absolute else None
        mode, literal, _ = function_value(token)
        if mode == "absolute":
            return ("absolute", paired) if literal is not None else ("expression", paired)
        if address in setup.via_arcs and literal is None:
            # A centre a multiply would scale with the end point but cannot compute.
            return ("expression", paired)
        return None

    def judge_cycle(
        self,
        block: Block,
        group: Group,
        state: Dict[str, Any],
        cycle_words: Dict[int, bool],
        cycle_args: List[Tuple[Arg, Optional[str]]],
    ) -> Optional[Tuple[str, str]]:
        """R8: whether this block's cycle can be judged, and which of its values move with it."""
        setup = self.setup
        entry = group.entry
        name = code_of(entry)
        if group.kind == "macro":
            return (
                "cycle-not-reviewed",
                "the modal macro call of %s runs after every position, and its arguments may be positions nobody described"
                % name,
            )
        if group.kind == "undefined":
            return ("cycle-not-reviewed", "a cycle call while no reviewed cycle is defined")
        if entry is None:
            if block.generic_cycle is not None:
                what = block.generic_cycle
            elif group.kind == "define":
                what = "the cycle it runs (line %d)" % group.line
            else:
                what = next((t.address for e, t, _ in block.calls if e is None and t.address), "the cycle")
            return ("cycle-not-reviewed", "%s is not in the code database, so nobody reviewed its positions" % what)
        if not reviewed(entry):
            return ("cycle-not-reviewed", "nobody reviewed the positions of %s (roadmap R8)" % name)

        args = self.cycle_values(block, group)
        for arg in args:
            param = self.param_of(entry, arg)
            if arg.kind == "word" and arg.name in setup.axes and gedit_nc.position_of(param) is None:
                continue  # an axis word: it moves as one
            if param is None:
                if arg.kind == "call":
                    return (
                        "cycle-not-reviewed",
                        "argument %d of %s is %s, and the code database describes only %d"
                        % (arg.position, name, quote(arg.text), len(params_of(entry))),
                    )
                return ("cycle-not-reviewed", "%s writes %s, which the code database does not describe" % (name, quote(arg.text)))
            if gedit_nc.position_of(param) is None:
                return ("cycle-not-reviewed", "nobody reviewed %s of %s (roadmap R8)" % (self.shown(entry, arg), name))
        for own in [entry] + list(block.call_entries):
            others = [str(p.get("address")) for p in params_of(own) if gedit_nc.position_of(p) == "other"]
            if others:
                return (
                    "cycle-position",
                    "%s has positions of its own (%s) that a shift cannot judge" % (code_of(own), and_list(others)),
                )
        for arg in args:
            if gedit_nc.position_of(self.param_of(entry, arg)) != "mode" or arg.text.strip() == "":
                continue
            value = gedit_nc.decimal_of(arg.literal) if arg.literal is not None else None
            if value is None or value != 0:
                return (
                    "cycle-mode",
                    "%s is %s, a mode the cycle reads its positions in that a shift cannot judge"
                    % (self.shown(entry, arg), quote(arg.text)),
                )
        tool_axis = [str(p.get("address")) for p in params_of(entry) if gedit_nc.position_of(p) == "tool-axis"]
        if tool_axis and state.get("plane") != "XY":
            plane = state.get("plane")
            where = "the plane is %s" % plane if plane in ("ZX", "YZ") else "the plane is not known here"
            return (
                "cycle-plane",
                "%s, so the tool axis %s of %s lie on is not certain" % (where, and_list(tool_axis), name),
            )
        # What moves with a shift of the tool axis.
        for arg in args:
            if gedit_nc.position_of(self.param_of(entry, arg)) != "tool-axis" or arg.text.strip() == "":
                continue
            if arg.kind == "word":
                # An address word follows the distance mode like any word (`word_outcome`).
                if setup.moves_tool_axis or arg.name in setup.targets:
                    cycle_words[id(arg.token)] = True
                continue
            if not setup.moves_tool_axis:
                continue
            if arg.literal is None:
                return (
                    "cycle-expression",
                    "%s is written as %s, a variable or an expression, so it cannot be moved with the %s words"
                    % (self.shown(entry, arg), quote(arg.text), TOOL_AXIS),
                )
            cls = gedit_nc.number_class_of(TOOL_AXIS, setup.profile, self.interp.feed_unit, [], False, [])
            if arg.kind == "call":
                arg.name = self.shown(entry, arg)
            cycle_args.append((arg, cls))
        if not self.params.additive and setup.moves_tool_axis:
            # CODE-8: a multiply or divide of the tool axis scales the cycle's positions, but
            # not a depth or a distance written as one of its other parameters (`Q1.` of
            # `G83`, Klartext `Q201`, Sinumerik `SDIS`): the cycle is scaled in one piece or
            # not at all.
            codes = block.codes()
            for arg in args:
                param = self.param_of(entry, arg)
                if gedit_nc.position_of(param) != "none" or arg.text.strip() == "":
                    continue
                if isinstance(param, dict) and param.get("unit") in NOT_A_LENGTH:
                    continue
                if arg.literal is not None and gedit_nc.decimal_of(arg.literal) == 0:
                    continue
                if arg.kind == "word":
                    cls = self.number_class(arg.name, codes, [entry])
                    if cls is not None and cls not in ("length", "increment"):
                        continue
                return (
                    "not-scaled",
                    "%s writes %s, which may be a depth or a distance a multiply or divide does not scale, so the cycle cannot be scaled in one piece"
                    % (name, quote("%s=%s" % (self.shown(entry, arg), arg.text) if arg.kind != "word" else arg.text)),
                )
        return None

    def param_of(self, entry: Optional[Dict[str, Any]], arg: Arg) -> Optional[Dict[str, Any]]:
        if arg.kind == "call":
            params = params_of(entry)
            return params[arg.position - 1] if 0 < arg.position <= len(params) else None
        return param_named(entry, arg.name)

    def shown(self, entry: Optional[Dict[str, Any]], arg: Arg) -> str:
        """What a finding calls a value: its parameter's address, or the word."""
        param = self.param_of(entry, arg)
        address = param.get("address") if param is not None else None
        return address if isinstance(address, str) and address != "" else arg.name

    def cycle_values(self, block: Block, group: Group) -> List[Arg]:
        """The values the block writes for its cycle: words, Q parameters or call arguments."""
        setup = self.setup
        entry = group.entry
        args: List[Arg] = []
        if group.kind == "call":
            for call_entry, token, line in block.calls:
                if call_entry is not entry:
                    continue
                text = token.value_text or ""
                offset = token.text.find("(")
                base = None
                if offset >= 0 and token.text[offset + 1 : offset + 1 + len(text)] == text:
                    base = token.start + offset + 1
                for position, (arg_text, start, end) in enumerate(split_arguments(text), 1):
                    if arg_text == "":
                        continue
                    span = (base + start, base + end) if base is not None else None
                    literal = gedit_nc.parse_number(arg_text)
                    args.append(Arg("argument %d" % position, arg_text, literal, line, span, None, "call", position))
            return args
        if group.kind == "define":
            # The definition writes its values; a call of it writes positions, not arguments.
            if any(e is entry for e, _, _ in block.entries):
                return list(block.q_args)
            return []
        if group.kind in ("modal", "single"):
            for token, line in block.words:
                address = (token.address or "").upper()
                if (token.value_text or "") == "" or address in setup.not_arguments or is_assignment(token):
                    continue
                args.append(Arg(address, token.text.strip(), token.value, line, value_span(token), token, "word"))
        return args

    # -- one value ----------------------------------------------------------------

    def units(self, state: Dict[str, Any]) -> str:
        value = as_dict(state.get("units")).get("value")
        return value if value in ("mm", "inch") else self.setup.power_on_units

    def word_outcome(
        self,
        token: gedit_nc.Token,
        line: Line,
        address: str,
        state: Dict[str, Any],
        codes: List[Dict[str, Any]],
        in_force: List[Dict[str, Any]],
        data: Optional[str],
        is_cycle: bool,
        geometry: Optional[Tuple[str, str]] = None,
    ) -> Outcome:
        """One word of a chosen address (or a cycle position written as a word, or a
        coordinate of an arc, ``geometry = (mode, axis)``)."""
        setup = self.setup
        params = self.params
        additive = params.additive
        written = quote(token.text)
        if data is not None:
            return ("skip", line, "data", "%s: a value of %s, not a position of this program" % (written, data), written)
        literal = token.value
        span = value_span(token)
        function = None
        if literal is None:
            function, literal, span = function_value(token)
        mode = geometry[0] if geometry is not None else None
        twin = address in setup.twin_targets
        # A multiply or divide scales a distance like a position (CODE-8): only a shift
        # needs to know whether a word is absolute.
        if twin and additive:
            axis = setup.twins.get(address, "")
            return ("skip", line, "incremental", "%s: %s moves %s by a distance, so a shift does not apply to it" % (written, address, axis), written)
        if additive and (token.incremental or function == "incremental" or mode == "incremental"):
            return ("skip", line, "incremental", "%s: written as an incremental distance, so a shift does not apply to it" % written, written)
        absolute = function == "absolute" or mode == "absolute"
        distance = state.get("distance")
        if additive and not twin and not absolute:
            if distance == "incremental":
                return ("skip", line, "incremental", "%s: the distance mode is incremental here, so a shift does not apply to it" % written, written)
            if distance != "absolute":
                return ("skip", line, "incremental", "%s: the distance mode is not known here (no code set it before this block)" % written, written)
        if literal is None:
            return ("skip", line, "expression", "%s: a variable or an expression, which this script does not compute" % written, written)
        cls = self.number_class(address, codes, in_force)
        if cls is None and geometry is not None:
            cls = self.number_class(geometry[1], codes, in_force)
        if geometry is None and cls in ("count", "increment") and address in setup.via_arcs:
            owner = next((code_of(e) for e in codes + in_force if param_named(e, address) is not None), "its code")
            return ("skip", line, "count", "%s: a parameter of %s, not an arc centre" % (written, owner), written)
        factor = Decimal(1)
        paired = geometry[1] if geometry is not None and geometry[1] != address else ARC_AXIS.get(address)
        diameter_word = address in setup.diameter_words or (geometry is not None and geometry[1] in setup.diameter_words and param_axis(codes, address) is not None)
        if additive and not diameter_word and paired in setup.diameter_words and address not in setup.diameter_words:
            # The centre word of a diameter axis is a radius value (AD-19 rule 11). On a mill
            # the operand is a plain coordinate, so it moves by the operand itself (NC-1).
            if setup.lathe and params.x_operand == "diameter":
                factor = Decimal("0.5")
        elif additive and diameter_word:
            reading = self.interp.diameter_reading(geometry[1] if geometry is not None and address not in setup.diameter_words else address)
            if as_dict(state.get("diameter")).get("mode") == "absolute-only" and function is not None:
                # DIAM90: the word's own value function decides, as the distance mode would.
                reading = "diameter" if function == "absolute" else "radius"
            if reading not in ("diameter", "radius"):
                return ("skip", line, "machine-dependent", "%s: whether it is a diameter or a radius is not known here" % written, written)
            # On a lathe the operand is a diameter or a radius (`xOperand`); on a mill it is a
            # plain coordinate, and a word written as a diameter moves by twice it (NC-1).
            operand_is_diameter = setup.lathe and params.x_operand == "diameter"
            if reading == "diameter":
                factor = Decimal(1) if operand_is_diameter else Decimal(2)
            else:
                factor = Decimal("0.5") if operand_is_diameter else Decimal(1)
        return self.change(literal, cls, line, span, written, factor, self.units(state), is_cycle)

    def number_class(self, address: str, codes: List[Dict[str, Any]], in_force: List[Dict[str, Any]]) -> Optional[str]:
        """`gedit_nc.number_class_of`, remembered: a program asks the same few questions."""
        interp = self.interp
        key = (address, tuple(id(e) for e in codes), tuple(id(e) for e in in_force), interp.feed_unit, interp.pitch_feed)
        if key not in self._classes:
            self._classes[key] = gedit_nc.number_class_of(
                address, self.setup.profile, interp.feed_unit, codes, interp.pitch_feed, in_force
            )
        return self._classes[key]

    def arg_outcome(self, arg: Arg, cls: Optional[str], state: Dict[str, Any]) -> Outcome:
        """A tool-axis position written as a call argument or a Q parameter: absolute always."""
        written = quote("%s=%s" % (arg.name, arg.text))
        if arg.literal is None:
            return ("skip", arg.line, "expression", "%s: a variable or an expression" % written, written)
        return self.change(arg.literal, cls, arg.line, arg.span, written, Decimal(1), self.units(state), True)

    def change(
        self,
        literal: gedit_nc.NumericLiteral,
        cls: Optional[str],
        line: Line,
        span: Optional[Tuple[int, int]],
        written: str,
        factor: Decimal,
        units: str,
        is_cycle: bool,
    ) -> Outcome:
        """The new text of one value, or why it is left: the number rules of §7.15."""
        setup = self.setup
        params = self.params
        if span is None:
            return ("skip", line, "expression", "%s: the value cannot be told apart from what surrounds it" % written, written)
        if cls is None:
            return ("skip", line, "machine-dependent", "%s: gEdit does not know what kind of number this word is on this profile" % written, written)
        number = gedit_nc.decimal_of(literal)
        if number is None:
            return ("skip", line, "expression", "%s: not a number gEdit can read" % written, written)

        if cls == "count" or (not params.additive and self.keeps_form(literal, params.apply(number))):
            # A count, or a product that keeps the word's form: on the literal, which is the
            # same in every reading (multiplying is unit-free).
            exact = params.apply(number)
            text, rounded = self.write_literal(exact, literal)
            return self.edit_or_same(line, span, text, rounded, written, is_cycle)

        value, readings = setup.resolve(literal, cls, units)
        if value is None:
            if readings:
                return (
                    "skip",
                    line,
                    "machine-dependent",
                    "%s: the reading depends on the machine (%s); choose a machine"
                    % (written, readings_text(readings, CLASS_UNIT.get(cls, units))),
                    written,
                )
            return ("skip", line, "machine-dependent", "%s: this word has no value on this machine" % written, written)
        current = Decimal(value)
        new_value = trim(params.apply(current, factor))
        # The literal is the value times a constant in every reading (as written, a count of
        # increments, a count of units), so the decimals the result needs in the word's own
        # form follow from that constant.
        ratio = number / current if current != 0 else None
        text, rounded, error = self.write_back(new_value, literal, cls, setup.machine, units, ratio)
        if error is not None or text is None:
            return ("skip", line, "machine-dependent", "%s: %s" % (written, error or "nothing can be written back into it"), written)
        if setup.presets and not self.as_written_everywhere(literal, number, cls, units):
            for preset in setup.presets:
                other, other_rounded, other_error = self.write_back(new_value, literal, cls, preset, units, ratio)
                if other != text or other_rounded != rounded or other_error is not None:
                    return (
                        "skip",
                        line,
                        "machine-dependent",
                        "%s: the result would be written differently on another machine of this profile; choose a machine" % written,
                        written,
                    )
        return self.edit_or_same(line, span, text, rounded, written, is_cycle)

    def as_written_everywhere(self, literal: gedit_nc.NumericLiteral, number: Decimal, cls: str, units: str) -> bool:
        """Whether every preset reads this word **as written** (§7.15): then all of them write
        the same value back the same way, and the run need not ask each of them.

        As written means the calculator reading, or the increment reading of a word with a
        point. A word that merely has the same value everywhere is not enough: `Z0` is 0 on
        every Fanuc preset, and 0.5 mm is `Z500` in increments and `Z0.5` as written.
        """
        key = (literal.has_point, cls)
        found = self._as_written.get(key)
        if found is None:
            found = cls != "increment"
            for preset in self.setup.presets:
                number_input = as_dict(preset.get("numberInput"))
                entry = as_dict(as_dict(number_input.get("classes")).get(cls))
                mode = entry.get("mode") or number_input.get("mode")
                if not (mode == "calculator" or (mode == "increment" and literal.has_point)):
                    found = False
                    break
            self._as_written[key] = found
        return found

    def keeps_form(self, literal: gedit_nc.NumericLiteral, exact: Decimal) -> bool:
        """A product every reading writes alike: one with a point, or a whole number."""
        return literal.has_point or exact == exact.to_integral_value()

    def decimals_for(self, literal: gedit_nc.NumericLiteral, needed: int) -> int:
        params = self.params
        if params.decimals != "keep":
            return int(params.decimals)
        written = len(literal.frac_part or "")
        return max(written, min(needed, MAX_KEEP_DECIMALS))

    def write_literal(self, exact: Decimal, literal: gedit_nc.NumericLiteral) -> Tuple[str, bool]:
        """A count or a product written on the literal: point-less stays whole."""
        fmt = dict(self.params.fmt)
        fmt["decimals"] = self.decimals_for(literal, frac_digits(exact)) if literal.has_point else 0
        text = gedit_nc.format_number(trim(exact), literal, fmt, True)
        back = gedit_nc.decimal_of(text)
        return text, back is None or back != exact

    def write_back(
        self,
        value: str,
        literal: gedit_nc.NumericLiteral,
        cls: str,
        machine: Dict[str, Any],
        units: str,
        ratio: Optional[Decimal],
    ) -> Tuple[Optional[str], bool, Optional[str]]:
        """`gedit_nc.write_back` with the decimals of the form (README `decimals`).

        ``ratio`` is the literal divided by its value on the document's machine; "as written"
        then adds the decimals the result needs in the word's own form (none for a count of
        increments, which `write_back` writes whole anyway).
        """
        fmt = dict(self.params.fmt)
        if self.params.decimals == "keep":
            if ratio is not None:
                with localcontext() as context:
                    context.prec = 80
                    needed = frac_digits(Decimal(value) * ratio)
            else:
                needed = frac_digits(Decimal(value))
            fmt["decimals"] = self.decimals_for(literal, needed)
        else:
            fmt["decimals"] = self.params.decimals
        return gedit_nc.write_back(value, literal, cls, machine, units, fmt)

    def edit_or_same(self, line: Line, span: Tuple[int, int], text: str, rounded: bool, written: str, is_cycle: bool) -> Outcome:
        start, end = span
        if line.text[start:end] == text:
            return ("same",)
        return ("edit", line, start, end, text, rounded, written, is_cycle)

    # -- the end ------------------------------------------------------------------

    def settle(self) -> None:
        """A cycle and the blocks that run it are moved together or not at all, and so is the
        contour around a pole."""
        self.settle_rotary()
        self.settle_groups()

    def settle_rotary(self) -> None:
        """NC-4: a rotary axis that was not written yet when a block ran, and that the program
        later writes to anything but zero, stood somewhere nobody knows: the block's linear
        words are refused after all."""
        first = self.rotary.first_written
        for block in self.blocks:
            if block.refusal is not None or not block.edits or not block.tilt_pending:
                continue
            later = self.rotary.known_later(block.tilt_pending)
            if not later:
                continue
            block.refusal = (
                "rotary-without-tcp",
                "writes %s before the program first writes %s (line %d), so %s angle here is not known and tool centre point control is off: the tool tip may not move by the shift there"
                % (
                    and_list(block.tilt_words),
                    and_list(later),
                    min(first[axis] for axis in later),
                    "its" if len(later) == 1 else "their",
                ),
            )
            block.clear()

    def settle_groups(self) -> bool:
        changed = False
        for group in self.groups:
            members = group.members
            if not members:
                continue
            first = next((m for m in members if m.refusal is not None), None)
            outside = next((m for m in members if not m.inside and m.edits), None)
            if first is None and outside is None:
                continue
            what = "the same contour around the pole" if group.kind == "pole" else "the same cycle"
            for member in members:
                if member.refusal is None:
                    changed = changed or bool(member.edits)
                    if first is not None:
                        member.refusal = (
                            first.refusal[0],  # type: ignore[index]
                            "part of %s as line %d, which is left as written (%s)"
                            % (what, first.number, SHORT[first.refusal[0]]),  # type: ignore[index]
                        )
                    else:
                        member.refusal = (
                            "cycle-outside",
                            "part of %s as line %d above the selection, which this run does not change"
                            % (what, outside.number),  # type: ignore[union-attr]
                        )
                member.clear()
        return changed


#: What a cascaded finding says about the block that refused its cycle.
SHORT = {
    "unknown-code": "a code the database does not know",
    "machine-position": "a machine position",
    "frame": "inside a frame",
    "rotary-without-tcp": "a rotary move without tool centre point control",
    "cycle-outside": "above the selection",
    "cycle-not-reviewed": "not reviewed",
    "cycle-position": "positions of its own",
    "cycle-mode": "another mode",
    "cycle-plane": "outside the XY plane",
    "cycle-expression": "a variable position",
    "cycle-unresolved": "a position whose reading depends on the machine",
    "pole": "a pole that cannot be moved",
    "arc-geometry": "an arc that cannot be moved in one piece",
    "not-scaled": "not scaled",
}


def readings_text(readings: Sequence[Dict[str, Any]], unit: str) -> str:
    """``1 mm under "Increments of 0.001 mm (IS-B)" or 1000 mm under "As written"``.

    One entry per preset the profile declares, the assumed default first, as
    `gedit_nc.readings_of` hands them over; a preset that gives the word no value is named
    too, because that is a difference like any other.
    """
    parts: List[str] = []
    for entry in readings:
        value = entry.get("value")
        label = (entry.get("label") or entry.get("preset") or "").split(":", 1)[0].strip()
        shown = "%s %s" % (value, unit) if isinstance(value, str) else "no value"
        parts.append('%s under "%s"' % (shown, label))
    if len(parts) <= 1:
        return parts[0] if parts else ""
    return "%s or %s" % (", ".join(parts[:-1]), parts[-1])


#: The unit a reading is in, by number class, for a finding.
CLASS_UNIT = {"angle": "\u00b0", "dwell": "s"}


# ---------------------------------------------------------------------------
# The message
# ---------------------------------------------------------------------------


def machine_note(setup: Setup) -> str:
    """The machine, as every M10 script says it (README "The envelope", item 3)."""
    machine = setup.machine
    if machine.get("id") is None:
        return "No machine chosen: words whose reading depends on the machine are left alone."
    name = machine.get("name") or machine.get("id")
    params = as_dict(machine.get("params"))
    parts: List[str] = []
    if setup.chosen_numbers:
        number_input = as_dict(params.get("numberInput"))
        length = as_dict(as_dict(number_input.get("classes")).get("length"))
        mode = length.get("mode") or number_input.get("mode")
        inch = setup.power_on_units == "inch"
        unit = length.get("incrementInch" if inch else "increment") or number_input.get("incrementInch" if inch else "incrementMm")
        unit_name = "inch" if inch else "mm"
        if mode == "increment" and isinstance(unit, str):
            parts.append("numbers without a point are increments of %s %s" % (unit, unit_name))
        elif mode == "scale" and isinstance(unit, str):
            parts.append("every number counts in units of %s %s, with or without a point" % (unit, unit_name))
        elif mode == "calculator":
            parts.append("numbers are read as written")
    else:
        parts.append("it does not say how it reads numbers, so words whose reading depends on that are left alone")
    if setup.diameter_words and setup.lathe:
        # NC-1: only a turning profile reads X as a diameter or a radius by its machine.
        diameter = params.get("diameter")
        word = "X" if "X" in setup.diameter_words else sorted(setup.diameter_words)[0]
        if diameter == "on":
            parts.append("%s is a diameter" % word)
        elif diameter == "off":
            parts.append("%s is a radius" % word)
    return "Machine '%s': %s." % (name, "; ".join(parts))


def summary(run: Run, findings: Findings) -> str:
    params = run.params
    blocks = [b for b in run.blocks if b.inside]
    changed_words = sum(b.changed for b in blocks if b.refusal is None)
    changed_blocks = sum(1 for b in blocks if b.refusal is None and b.changed)
    cycle_words = sum(b.cycle_changed for b in blocks if b.refusal is None)
    rounded = sum(len(b.notes) for b in blocks if b.refusal is None)

    if changed_words == 0:
        first = "Changed nothing."
    else:
        shown = [
            "%s (as a %s)" % (a, params.x_operand) if params.additive and run.setup.lathe and a in run.setup.diameter_words else a
            for a in params.chosen
        ]
        addresses = and_list(shown)
        how = {
            "add": "Added %s to %s" % (params.operand_text, addresses),
            "subtract": "Subtracted %s from %s" % (params.operand_text, addresses),
            "multiply": "Multiplied %s by %s" % (addresses, params.operand_text),
            "divide": "Divided %s by %s" % (addresses, params.operand_text),
        }[params.operation]
        if any(b.arc_changed for b in blocks if b.refusal is None):
            how += " and the arc centres"
        first = "%s in %s on %s" % (how, count_text(changed_words, "word"), count_text(changed_blocks, "block"))
        extras: List[str] = []
        if cycle_words:
            extras.append("%s of them %s" % ("{:,}".format(cycle_words), "a cycle position" if cycle_words == 1 else "cycle positions"))
        if rounded:
            extras.append("%s rounded to the form %s written in" % ("{:,}".format(rounded), "it is" if rounded == 1 else "they are"))
        first += (", " + ", ".join(extras) if extras else "") + "."

    block_counts: Dict[str, int] = {}
    word_counts: Dict[str, int] = {}
    for block in blocks:
        if block.refusal is not None:
            block_counts[block.refusal[0]] = block_counts.get(block.refusal[0], 0) + 1
        else:
            for _, reason, _ in block.word_findings:
                word_counts[reason] = word_counts.get(reason, 0) + 1
    sentences = [first]
    left_blocks = sum(block_counts.values())
    left_words = sum(word_counts.values())
    if left_blocks or left_words:
        what = []
        if left_blocks:
            what.append(count_text(left_blocks, "block"))
        if left_words:
            what.append(count_text(left_words, "word"))
        parts = []
        for reason in BLOCK_REASONS:
            if block_counts.get(reason):
                singular, plural = REASON_TEXT[reason]
                parts.append("%s %s" % ("{:,}".format(block_counts[reason]), singular if block_counts[reason] == 1 or plural is None else plural))
        for reason in WORD_REASONS:
            if word_counts.get(reason):
                singular, plural = REASON_TEXT[reason]
                parts.append("%s %s" % ("{:,}".format(word_counts[reason]), singular if word_counts[reason] == 1 or plural is None else plural))
        sentences.append("Left %s as written: %s." % (" and ".join(what), ", ".join(parts)))
    if findings.dropped:
        sentences.append("%s further findings are not listed." % "{:,}".format(findings.dropped))
    sentences.append(machine_note(run.setup))
    return " ".join(sentences)


def collect_findings(run: Run, findings: Findings) -> None:
    """One finding per refused block and per word left as written, in line order."""
    rows: List[Tuple[int, int, str, str, str]] = []
    for block in run.blocks:
        if not block.inside:
            # A block that starts above the selection and runs into it: its head cannot be
            # changed, so the lines of it the selection holds are left too, and said so.
            inner = next((line for line in block.lines if line.inside), None)
            if inner is not None and (block.refusal is not None or block.edits):
                rows.append(
                    (
                        inner.number,
                        0,
                        "warning",
                        "%s: the block starts above the selection (line %d), so it is left as written." % (quote(inner.text), block.number),
                        "cycle-outside" if block.group is not None else "selection",
                    )
                )
            continue
        if block.refusal is not None:
            reason, text = block.refusal
            rows.append((block.number, 0, "warning", "%s: %s." % (block.as_written(), text), reason))
            continue
        for number, reason, text in block.word_findings:
            # NC-5: a word that cannot be read still goes to the old position: a warning.
            rows.append((number, 1, "warning" if reason == "unreadable" else "info", text + ".", reason))
        for number, text in block.notes:
            rows.append((number, 2, "info", text + ".", "rounded"))
    for code, (line, count) in run.unknown_seen.items():
        # NC-5: a code nobody described, in a block with nothing to change, may still change
        # how the blocks after it are read (a polar or another coordinate mode).
        rows.append(
            (
                line,
                0,
                "warning",
                "%s: a code the database does not know, in %s this run had nothing to change in; if it changes how the blocks after it are read (a polar or another coordinate mode), this run cannot see that. Check those blocks by hand."
                % (code, count_text(count, "block")),
                "unknown-code-note",
            )
        )
    rows.sort(key=lambda row: (row[0], row[1]))
    for number, _, severity, message, reason in rows:
        findings.add(number, severity, message, reason)


def apply_edits(lines: Sequence[str], run: Run) -> List[str]:
    by_line: Dict[int, List[Tuple[int, int, str]]] = {}
    for block in run.blocks:
        if block.refusal is not None or not block.inside:
            continue
        for line, start, end, text in block.edits:
            if line.inside:
                by_line.setdefault(line.index, []).append((start, end, text))
    out = list(lines)
    for index, edits in by_line.items():
        line = out[index]
        parts: List[str] = []
        at = 0
        for start, end, text in sorted(edits):
            parts.append(line[at:start])
            parts.append(text)
            at = end
        parts.append(line[at:])
        out[index] = "".join(parts)
    return out


def main() -> int:
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()

    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print(
            "Address arithmetic needs a dialect profile. Run it from gEdit, which puts the "
            "profile into the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("Address arithmetic cannot use this profile: %s" % err, file=sys.stderr)
        return 1
    try:
        params = Params(as_dict(context.get("params")), profile)
    except (ValueError, ArithmeticError) as err:
        print("Address arithmetic: %s" % err, file=sys.stderr)
        return 1

    codes = context.get("codes") if isinstance(context.get("codes"), list) else []
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    base_line = start if isinstance(start, int) and not isinstance(start, bool) and start >= 1 else 1
    fragment = scope.get("scope") == "selection" and base_line > 1
    preceding = gedit_nc.preceding_lines(context) if fragment else []

    setup = Setup(context, profile, codes, params)
    findings = Findings()
    if not codes:
        findings.add(
            base_line,
            "warning",
            "This run had no code database, so it cannot tell a machine position, a frame or a "
            "cycle from a move: nothing was changed.",
            "no-database",
        )
        gedit_nc.envelope("\n".join(lines), "Changed nothing. " + machine_note(setup), findings.items)
        return 0
    if fragment and not preceding:
        findings.add(
            base_line,
            "warning",
            "This run saw only the selection, from line %d, so the distance mode, the plane, a "
            "frame and any cycle set above it are unknown: words that depend on them are left "
            "as written. Run the command on the whole program, or check these blocks by hand."
            % base_line,
            "selection",
        )

    run = Run(setup, cp)
    run.walk(list(preceding) + lines, base_line - len(preceding), len(preceding))
    run.settle()
    out = apply_edits(list(preceding) + lines, run)[len(preceding):]
    collect_findings(run, findings)
    findings.items.sort(key=lambda finding: finding["line"])
    gedit_nc.envelope("\n".join(out), summary(run, findings), findings.items)
    return 0


if __name__ == "__main__":
    sys.exit(main())

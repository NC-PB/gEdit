# Machines

A [dialect profile](dialects.md) says how a program is **written**: what a comment looks
like, where the block number goes, which codes exist. A **machine configuration** says how
one particular control **reads** it.

Those are two different questions, and the second one has no answer that holds for a whole
control family. Whether `X50` is fifty millimetres or five hundredths of one, whether the
lathe is set up for G-code system A or B, whether `X` is a diameter when the program
starts, whether the spindle is in feed per revolution before the program says anything —
none of that is a property of "Fanuc", "Okuma" or "Sinumerik". It is a property of the
machine standing in your workshop, set by its parameters when it was commissioned. So it is
yours to tell gEdit, once per machine.

You do not have to. Everything in this editor works without a single machine configured:
the highlighting, the program map, the code help, the renumbering, the cleanups, the tool
list and the scaling scripts. What a machine buys you is that gEdit stops saying "I cannot
know that" about the values in your program.

---

## Why it matters: the number without a decimal point

This is the whole reason the feature exists.

```
G00 X50.  Z2.
G01 X50   Z2   F0.2
```

On a control set to **calculator-type input**, both lines go to the same place: 50 mm in X.
On the same control with that switch off, the second line goes to **0.050 mm** — the digits
are counted in least input increments, and on a metric IS-B machine one increment is a
thousandth of a millimetre. One factor of a thousand, decided by a machine parameter, on
two lines that look almost identical.

CAM output usually writes the point, so most of the time the question never comes up. It
comes up in the programs people edit by hand, in the ones an older post writes, and in the
cycle parameters — a peck depth written as `Q6000` is six millimetres on one machine and
six metres of nonsense on another.

On an Okuma control the point does not even help: there, both lines above can be 50 mm,
0.5 mm or 0.05 mm, depending on the machine's unit system — see
[Okuma](#okuma-the-unit-system-scales-every-number).

gEdit's rule for this is short and it does not bend:

> **No machine, no guess.** Where the presets a dialect knows would read a word
> differently, and you have not said which control this program is for, the word gets no
> value at all. It is reported, not converted.

That is why the status bar says **assumed** next to "Machine: none". It is not a nag. It is
the difference between an editor that is honest and one that is confidently wrong.

## The three ways a control reads a number

gEdit knows three. A machine configuration picks one of the dialect's named presets; a
preset can read some kinds of word differently (below), and a rule of your own can be
written into the file.

| Reading | A word **with** a point | A word **without** a point |
|---|---|---|
| **In increments** | as written | a count of least input increments |
| **As written** | as written | as written |
| **Scaled** | multiplied by the unit | multiplied by the unit |

**In increments** — Fanuc's IS-B and IS-C, with calculator-type input off. `X50.` is
50 mm; `X50` is 50 increments, so 0.050 mm on IS-B (0.001 mm per increment) and 0.0050 mm
on IS-C (0.0001 mm). The point is what makes the difference.

**As written** — Fanuc's calculator-type input. `X50` and `X50.` are both 50 mm, and `G04
U2` is a two-second dwell. This is the default gEdit assumes for the Fanuc lathe profile,
because the turning manuals the project worked from write `G0 X40 W-40` for 40 mm in
exactly this way; it is also the only reading of the Sinumerik profile and what an Okuma
control set to a 1 mm unit does. On the Fanuc lathe, the cycle parameters written in
microns are the exception and are still counted; see
[Not every word is read the same way](#not-every-word-is-read-the-same-way).

**Scaled** — the whole program is measured in a unit the machine parameter names, and the
decimal point changes nothing at all. On an Okuma control set to 10 µm, `X2500` is 25 mm
**and** `X0.5` is 0.005 mm. The Okuma profile offers this reading for its 1 µm and 10 µm
unit systems.

The difference between the first and the third is worth a second look, because they are
easy to confuse. In the first, a decimal point rescues you. In the third, it does not: a
value with a point is scaled exactly like one without.

### Not every word is read the same way

A control can distinguish kinds of word, and gEdit follows it. The classes are:

| Class | Which words | Unit |
|---|---|---|
| Length | axis words, their incremental twins, arc centres, `R`, and the cycle lengths the code database marks as such | mm or inch |
| Angle | the words the profile lists as angular: `C` on a lathe, and on Sinumerik also `AR` and `SF` | degrees |
| Dwell | the dwell word of `G04` — `X` or `U` on Fanuc, `F` on Okuma and Sinumerik — and the `E` dwell of an Okuma cycle | seconds |
| Feed per minute | the feed word while feed per minute is in force | mm/min or in/min |
| Feed per revolution | the feed word while feed per revolution is in force | mm/rev or in/rev |

On the Fanuc presets that count increments the **feeds are read as written**: a 1 mm/min
increment gives the same number either way, so `F155` is 155 mm/min whatever the
decimal-point setting is. That is why the feed limits in the scaling script keep working
even with no machine chosen. (Whether a control with calculator-type input off really reads
a feed per revolution as written is one of the things the project has not been able to
confirm — see
[What gEdit assumes](#what-gedit-assumes-and-what-it-does-not-know).) On Okuma it is the
other way round: the unit system scales the feeds too, and by a different factor for a feed
per minute than for a feed per revolution.

Angles and dwells do not follow the metric/inch switch: degrees are degrees and seconds are
seconds in an inch program too. On a lathe control that counts in thousandths, `C90000` is
90° and `G04 X2500` is a dwell of 2.5 seconds — in a millimetre program and in an inch
program alike. The Fanuc mill profile lists no angular words yet, so there `A`, `B` and `C`
are read like lengths for now: on an IS-B mill `C90000` comes out as 90 mm, or as 9 inches
in an inch program.

A few cycle parameters are counts of increments **whatever** the machine's general setting
is: the µm depths and steps (`P`, `Q`) of the Fanuc lathe's `G74`, `G75`, `G76`, `G83` and
`G87`. gEdit knows which ones from the code database, and treats them as counts rather
than as millimetres. That holds on a control that reads positions as written too: the
documentation the project worked from describes one machine on which `X50` is 50 mm *and*
the peck `Q6000` is 6 mm, so "as written" is a statement about positions and not about the
micron parameters of a cycle. The Fanuc "as written" preset therefore names an increment of
0.001 mm for those parameters, and its label says so. The Fanuc mill profile has no such
parameters: there the `Q` of `G73` and `G83` belongs to no class at all and never gets a
value, whichever preset is chosen.

A spindle speed is never converted, on any control: `S` is revolutions per minute, or a
cutting speed under constant surface speed, whatever the machine's number settings are.
Counts — a repeat count, a number of holes, a block number, a program number — are never
converted either.

## What "none" means

"Machine: none" is a perfectly good state. It means: read this program with what the
**dialect** documents, and mark every one of those values as assumed.

Concretely, with no machine:

- Anything that does not depend on the machine is unaffected. Highlighting, the program
  map, hover help, completion, every transformation on the NC tab, comparing, saving — none
  of it changes. (On a Fanuc lathe the hover and completion follow the G-code system in
  force, which gEdit reads off the program when no machine names it.)
- **Scaling still works.** Multiplying a feed by 90 % is unit-free: `F155` becomes `F140`
  whether that `F` means 155 mm/min or 0.155. The scripts do the arithmetic on the number
  as it is written.
- **Comparing with a limit needs a value.** If a feed cannot be given one, the scaling
  script still scales it and tells you it could not check it against your minimum or
  maximum.
- A word whose value depends on the machine is **listed, never converted**. Where gEdit can
  show you what each preset would make of it, it does — the assumed default first.

What that leaves with a value depends on the dialect:

| | With a value, even with no machine | Without a value until you choose a machine |
|---|---|---|
| Fanuc mill | every word written with a point; feeds | point-less lengths and dwells (`X50`, `G04 X2500`), `A`/`B`/`C` among the lengths; the `Q` of `G73`/`G83` has no value with any machine |
| Fanuc lathe | every word written with a point; feeds | point-less lengths, angles and dwells (`X50`, `C90000`, `G04 X2500`), and the cycle steps counted in microns (`G83 … Q6000`, `G74`/`G75` `P`/`Q`, `G76 Q`) |
| Okuma OSP lathe | nothing that has a unit: no length, feed, angle or dwell | every length, feed, angle and dwell, `X64.` included |
| Sinumerik 840D (turning) | every word: the control's own language reads a number as written, with or without a point | nothing |

Two things in that table surprise people.

On the **Fanuc lathe**, whose assumed reading is "as written", a cycle parameter that is a
count of increments has **no** value. `G83 ... Q6000` is a six-millimetre peck on a machine
set to thousandths and something else entirely on a machine set up differently, and "as
written" does not answer the question. gEdit says so instead of picking one.

On **Okuma**, nothing with a unit has a value until you choose a machine, not even a word
with a decimal point: the three unit systems read `X64.` as 64 mm, 0.64 mm or 0.064 mm, and
none of them is safer to assume than the others. The scale-feed limits are therefore
skipped, and reported, for every feed of an Okuma program with no machine.

One machine configuration, set up once, ends all of this for every program you open for
that machine.

## Defining a machine

`Settings ▸ Machines`, or **Manage Machines…** from the command palette (`F1`).

1. **Add…**, and pick the dialect this machine runs. It cannot be changed afterwards — a
   machine is a setup of one dialect. (Only dialects that have machine parameters are
   offered. Klartext has none, so there is nothing to configure there.)
2. Fill in the form. What it offers comes from the dialect, so a lathe gets fields a mill
   does not:

| Field | |
|---|---|
| **Name** | What the status bar and the picker call it. Yours to choose, up to 64 characters and different from every other machine's name, capitals aside: "Lathe 2", "Mill 3", "the old one" |
| **How the control reads numbers** | One of the dialect's presets — on Okuma, the control's unit system; Sinumerik has only one. Every preset's name says what it does to a word with and without a point, so you can pick it without knowing the jargon |
| **Units at power-on** | Millimetres or inches — what the control measures in until the program says otherwise |
| **X and U are diameters at power-on** (Fanuc lathe), **X is a diameter at power-on** (Okuma, Sinumerik) | Turning only. Off for a control set to radius programming. The label names the dialect's diameter words, and on Sinumerik this is the diameter programming (`DIAMON`) a program starts with |
| **G-code system** | Fanuc lathe only: A or B. See [the Fanuc lathe](#the-fanuc-lathe) |
| **Feed mode**, **Spindle-speed mode**, **Plane** and **Positioning at power-on** | What is in force before the program sets it, as far as the dialect offers them — Fanuc mill: feed mode, positioning, plane; Fanuc lathe: feed mode, spindle-speed mode, plane; Okuma: feed mode, positioning, spindle-speed mode; Sinumerik: feed mode (the feed type), plane, positioning. "Dialect default" leaves it to the profile |
| **Notes** | Your own note, up to 500 characters. gEdit only stores it |

The feed modes a Fanuc lathe is offered follow its G-code system: `G98`/`G99` in A,
`G94`/`G95` in B. Switching the system resets a power-on code the other system does not have
to "Dialect default", and says which.

Keep a note to 500 characters: the form does not stop you yet, but a longer note makes the
machine unusable from the next start — it is then listed on the Machines page with the
reason and cannot be picked until the note is shortened in the file.

3. **Save.**

Afterwards:

- **Edit…** changes a machine.
- **Duplicate…** asks only for a name and copies everything else — the fast way to a second
  machine that differs in one setting, which you then change with **Edit…**.
- **Remove** asks first, because it cannot be undone. A removed machine does not break the
  documents that used it; they fall back to the defaults and say so.
- **Default for its dialect** makes it the machine a document of that dialect gets when
  nothing else applies. On the default machine the same button reads **Not the default any
  more**.

## Choosing the machine for a document

The status bar, on the right, shows **Machine:** and the machine's name —
**Machine: Lathe 2**, say — or **Machine: none (assumed)**. Click it, or use
**Change Machine…** in the command palette:

- **None (dialect defaults)** — the explicit choice, not the same as never having chosen.
- Every machine of this document's dialect, with the default marked.
- **Other machines…** — the machines of the other dialects, shown when there are any.
  Picking one also switches the document's dialect, because a machine is a setup of one
  dialect.
- **Manage machines…**

A Fanuc lathe document is also offered the Fanuc mill machines, because the lathe profile is
built on the mill one, and with no default of its own it takes the mill's default machine.
A mill machine sets no diameter and no G-code system, so those stay what the lathe profile
assumes.

Hover the status item and it lists every effective parameter with **where it came from**:
"set by the machine", "detected in this program" or "dialect default, assumed". Nothing in
that list has to be believed; it says who claimed it.

The item is not shown at all for a dialect that has no machine parameters.

**The choice is remembered for that file.** Pick a machine for `WELLE.NC` and it is there
again the next time you open `WELLE.NC`, this afternoon or next month — **None (dialect
defaults)** included, which is why it is a choice of its own rather than the absence of
one. gEdit keeps that for the last 500 files you opened, in its own state file; nothing is
written into the program, and a copy of the file on another computer knows nothing about
it. Once a file has a choice, it keeps it: making another machine the default later does
not change that file. `Settings ▸ Files ▸ Remember where you were in each file` turns the
memory off, and the dialect's default machine takes over again.

A remembered machine that is no longer there — you removed it, or you replaced
`machines.json` with a copy that does not have it — is not used: the document falls back to
the dialect's default machine, or to none, and gEdit says so once. Changing a document's
dialect by hand does the same to a machine the new dialect cannot use: gEdit says once that
the machine is not for this profile, and the document takes the new dialect's default
machine, or none.

If the program's content and the machine disagree — a program that reads like G-code system
B opened with a machine set to A — gEdit tells you once and **changes nothing**. The
machine you chose wins. It is your machine; a text file does not get to overrule it.

## Reading the settings off your machine

gEdit cannot look at your control, and this guide will not print parameter numbers the
project has not verified. What to look for:

- **How numbers are read.** In the control's parameter list, the setting is usually
  described as *calculator-type decimal point input*, *decimal point input*, or as the
  *least input increment* / *increment system* of the axes (IS-A to IS-C on Fanuc). Some
  controls express the same thing as an *input unit* per axis. On a control that scales
  everything, it is a single *unit* parameter for the program — on Okuma, the unit system
  among the control's optional parameters, which has a screen of its own.
- **The G-code system**, on a Fanuc lathe, is its own parameter. The machine's manual
  usually prints the A/B/C table next to it. gEdit offers systems A and B; a system-C lathe
  has no matching choice.
- **The power-on modes** — feed per minute or per revolution, constant surface speed or
  direct rpm, the plane — are parameters too, and on many machines the same list also says
  what a reset restores. On a Sinumerik control they are machine data.
- **Diameter or radius programming** for the turning axis is a parameter as well; on a
  Sinumerik control it is machine data, and the program can switch it with `DIAMON` and
  `DIAMOF`.

If you cannot get at the parameters, the safest test is a program: write the same move with
and without the decimal point, run it dry, and see which one moves how far. Then set gEdit
to match what you saw. On Okuma that test tells you nothing, because the point makes no
difference there; look at a program that is known to be right for that machine instead
(see [Okuma](#okuma-the-unit-system-scales-every-number)).

**Your control's manual and its parameter list are the authority. gEdit is not.**

## The Fanuc lathe

Turning brings four things a mill program does not have.

**X is a diameter.** On the Fanuc lathe profile gEdit assumes diameter programming is on at
power-on, which is the usual setup for turning, and a machine configuration can say
otherwise.

**G-code system A or B.** On a Fanuc lathe the same numbers mean different things depending
on a parameter: the feed-mode codes, the speed clamp and some of the threading cycles change
with it ([dialects.md](dialects.md#the-fanuc-iso-lathe-profile) lists them). Same program
text, different meaning. gEdit treats this as a machine setting, because that is what it is.

With no machine, gEdit reads the program and decides from what is in it — a `G50 S2500`
points at A; a `G92 S2500` or a `G77`, `G78` or `G79` points at B; the feed-mode codes count
a little — and it needs a clear margin before it acts on that. A program that says nothing
either way, or not clearly enough, is read in system A. The status item's tooltip shows
what it settled on: "detected in this program" when the program pointed clearly one way,
"dialect default, assumed" when it fell back to A. **A machine that names the system always
wins over what the text looks like.**

**The tool word changes the tool.** A turret lathe has no `M6`: a `T` word is station plus
offset, and a `T…00` offset cancel is not a change. That is a rule of the dialect, not of the
machine — see [dialects.md](dialects.md#the-fanuc-iso-lathe-profile).

**A feed can be a thread lead.** In a threading or tapping cycle the `F` word carries a lead
rather than a feed rate, and scaling it cuts a different thread. Which codes those are
depends on the G-code system, which is one more reason to get the system right — but gEdit
also refuses the codes that thread in the other system, so the protection does not hang on
it. Hover says so on the block, and the scaling script refuses those blocks and lists them.
The codes are in [dialects.md](dialects.md#the-fanuc-iso-lathe-profile).

The power-on state the Fanuc lathe profile assumes is feed per revolution, direct rpm and
the ZX plane (in system B, feed per revolution is written `G95`). Those are documented
defaults, and a machine configuration is how you correct them.

## Okuma: the unit system scales every number

An Okuma OSP control neither counts increments nor cares about the decimal point. It has one
setting — the **unit system** — that says what a written "1" is worth, and it multiplies
every number of the program by it: 1 mm, 10 µm or 1 µm on a metric machine, 1 inch or
1/10000 inch on an inch machine. What that does to a program:

| | Unit 1 mm | Unit 10 µm | Unit 1 µm |
|---|---|---|---|
| 10 mm in X is written | `X10` or `X10.` | `X1000` | `X10000` |
| `X64.` is | 64 mm | 0.64 mm | 0.064 mm |
| A feed of 0.25 mm/rev is written | `F0.25` | `F25` | `F250` |
| A dwell of 2 seconds is written | `G04 F2` | `G04 F20` | `G04 F200` |

> **A decimal point does not protect you on this control.** A program full of points —
> `G01 X64. Z-40. F0.25` — is 64 mm on a machine set to 1 mm and 0.064 mm on one set to
> 1 µm. The unit system is not a question about hand-written programs without points; it
> decides what **every** number in **every** program means, and it has to be right for
> each Okuma machine you set up.

What a written "1" is worth also depends on the kind of word:

| Unit system | Length, feed per revolution | Feed per minute | Angle | Dwell |
|---|---|---|---|---|
| 1 mm | 1 mm, 1 mm/rev | 1 mm/min | 1° | 1 s |
| 10 µm (metric only) | 0.01 mm, 0.01 mm/rev | 1 mm/min | 0.01° | 0.1 s |
| 1 µm | 0.001 mm, 0.001 mm/rev | 0.1 mm/min | 0.001° | 0.01 s |
| 1 inch | 1 in, 1 in/rev | 1 in/min | 1° | 1 s |
| 1/10000 inch | 0.0001 in, 0.0001 in/rev | 0.01 in/min | 0.001° | 0.01 s |

A length is a position, an arc centre or a length inside a cycle; a dwell is the `F` of
`G04` or the `E` dwell of a cycle. `S`, a spindle or cutting speed, is never scaled.

The Okuma profile offers three presets, named after the unit and each with its own examples
in the name:

- **Unit 1 mm** — every number as written. The assumed default.
- **Unit 1 µm** — every number scaled, point or not.
- **Unit 10 µm, metric only** — every number scaled, point or not. There is no 10 µm inch
  system on this control, so do not combine this preset with inches.

An inch machine takes "Unit 1 mm" for a 1-inch system and "Unit 1 µm" for a 1/10000-inch
one, and sets **Units at power-on** to inches.

**With no machine, no Okuma value is computed at all** (see
[What "none" means](#what-none-means)). That is not caution for its own sake: the three
presets disagree about every length, feed, angle and dwell by factors of ten to a thousand,
with or without a point, so there is no reading that is safe to assume.

**How to tell which unit system a machine uses.** The control shows it on the screen of its
optional parameters; that is the authority. If you cannot get at it, look at a program that
is known to run correctly on that machine: a 64 mm diameter written as `X64` or `X64.` is a
1 mm machine, `X6400` a 10 µm machine and `X64000` a 1 µm machine. Do not find out by
moving the machine.

The other Okuma parameters are simpler: **X is a diameter**, in incremental mode too, and
the profile assumes the state after a reset that the manual describes — feed per revolution
(`G95`) and absolute positions (`G90`). The form also offers **Spindle-speed mode at
power-on** (`G96` or `G97`), for which the profile assumes nothing.

## Sinumerik: diameter programming and the rest

**Diameter programming is on at the start of a program.** On a Sinumerik turning machine,
`X` can be written as a diameter (`DIAMON`) or as a radius (`DIAMOF`), and which one the
control starts with is machine data. Out of the box the control starts with radius
programming (`DIAMOF`); the machine builder can change that, and turning machines are often
set up with diameter programming on. gEdit's turning profile assumes **on** — a decision
taken for this turning profile, and its documented default. The status item shows it as
assumed until a machine says otherwise; a machine whose control starts with radius
programming switches off the setting that makes `X` a diameter at power-on.

From there the program's own codes decide, block by block, and the modal state a script
sees follows them:

- `DIAMON` — `X` is a diameter from here on;
- `DIAMOF` — `X` is a radius from here on;
- `DIAM90` — an absolute `X` is a diameter and an incremental one (under `G91`) a radius.
  `G91 X-1` after `DIAM90` moves the tool 1 mm towards the axis, not 0.5 mm.

**How numbers are read.** **As written**: `X50` and `X50.` are both 50 mm, `F0.2` is
0.2 mm/rev and `G4 F2` waits two seconds. The control's programming manual settles this for
its own language — a number without a point is that number, not a count of increments — so
it is the one reading the profile offers, and a Sinumerik program has its values with no
machine chosen. A program written for the control's ISO mode is Fanuc-style code and
usually opens with a Fanuc profile, whose presets cover the increment readings; if the
status bar says Sinumerik, change it by hand.

**Power-on state.** The profile assumes the turning plane (`G18`) and feed per revolution
(`G95`). Both are machine data on the control, and both can be corrected per machine, under
**Feed mode at power-on** and **Plane at power-on**; the positioning (`G90`/`G91`) under
**Positioning at power-on**. On this control the constant cutting speed is part of the feed
type — `G96` is a feed per revolution with a cutting speed, `G961` the same with a feed per
minute — so a machine that powers on in one of them sets it in the same field as the feed
mode.

**Tools.** Whether a post writes `T="ROUGH_80"` or `T3 D1` depends on whether the control
is set up to manage its tools by name — a setup of the control, like the others here — but
it is not a setting in gEdit, because gEdit reads both forms as a tool change (see
[dialects.md](dialects.md#the-sinumerik-840d-turning-profile)).

## Where the file is, and how to back it up

Machine configurations live in **`machines.json`**, next to `settings.json` in gEdit's
configuration folder — where that folder is on your system is in
[Where things are](README.md#where-things-are). They are deliberately *not* in
`settings.json`: they are records with their own names, not preferences.

To back them up or move them to another computer, copy that one file. To share a shop's
setup, copy it to the same place on the other computer. Copy it while gEdit is closed: a
file put in place while gEdit runs is not seen, and the next change on the Machines page
writes over it.

It is plain JSON and hand-editing is supported:

```json
{
  "$version": 1,
  "machines": [
    {
      "id": "lathe-2",
      "name": "Lathe 2",
      "profile": "fanuc-lathe",
      "params": {
        "numberInput": { "mode": "calculator", "incrementMm": "0.001" },
        "units": "mm",
        "diameter": "on",
        "variants": { "gcodeSystem": "B" },
        "modalInitial": { "feedmode": "G95" }
      },
      "notes": "The big chuck; set up for G-code system B."
    },
    {
      "id": "lathe-3",
      "name": "Lathe 3",
      "profile": "okuma-osp",
      "params": {
        "numberInput": {
          "mode": "scale",
          "incrementMm": "0.01",
          "incrementDeg": "0.01",
          "incrementSec": "0.1",
          "classes": {
            "feedPerRev": { "increment": "0.01" },
            "feedPerMin": { "increment": "1" }
          }
        },
        "units": "mm",
        "diameter": "on"
      },
      "notes": "Unit system 10 µm, read off the parameter screen."
    }
  ],
  "defaults": { "fanuc-lathe": "lathe-2", "okuma-osp": "lathe-3" }
}
```

A machine stores the whole rule set of the preset it was given — the first machine above is
what the Fanuc lathe's "As written" preset writes, the second what "Unit 10 µm, metric
only" writes — so a later change to a preset never changes a machine you already have. The
`0.001` in the first one is not a slip: it is the increment the micron parameters of the
turning cycles are counted in, while every position is read as written. A machine is
matched to a preset only when every rule is the same, so one made from an older version of
a preset shows as "Custom (edited in the file)" until you pick a preset again.

What the file must hold:

- The readings are `"increment"`, `"calculator"` (as written) and `"scale"`. Every increment
  is decimal text in quotes (`"0.001"`, not `0.001`) and above zero, and `classes` may give
  `length`, `angle`, `feedPerMin`, `feedPerRev` or `dwell` a reading or an increment of its
  own.
- An `id` is 1–64 lower-case letters, digits and hyphens, not starting with a hyphen. Do not
  change it: the memory of which file uses which machine points at it.
- A name is at most 64 characters and unique, capitals aside; notes are at most 500
  characters; a file holds at most 100 machines.

**Open machines file** on the Machines page, or **Open Machines File** in the command
palette, opens it as a document in gEdit. Saving it makes gEdit re-read it, so the next thing you do on the Machines page is written on top of
your edit rather than over it. A number rule you wrote by hand that matches no preset shows
in the form as "Custom (edited in the file)" and survives an edit of the name — gEdit does
not quietly replace what it did not offer you.

A single machine the file holds but gEdit cannot use — a typo in its number rule, a power-on
code its G-code system does not have, a dialect this version does not know, a duplicate
name — is kept as written and listed on the Machines page with the reason and its place in
the file. It cannot be picked, edited, removed or made the default until the file is fixed;
the other machines keep working.

If the file as a whole cannot be used — a stray comma, something that is not a JSON object,
a file over 1 MiB, or a `machines` or `defaults` member of the wrong shape — then:

- no machine configuration is in use, and every document falls back to the documented
  defaults, with one notice saying so;
- the Machines page disables everything that writes, and offers only **Open machines file**
  and **Replace with an empty file**. A hand edit is never overwritten behind your back;
- **Replace with an empty file** keeps the old file as `machines.json.bak`, replacing an
  older `.bak` — but only a file that was not valid JSON, not a JSON object or too big. A
  file that is valid JSON with a member of the wrong shape is replaced without a copy, and
  so is a file whose copy could not be made: copy such a file away yourself first.

A file written by a newer version of gEdit is different: its machines are used as they are,
but gEdit never writes it — the Machines page changes nothing, and **Replace with an empty
file** is refused as well. A file gEdit cannot open at all (no permission, or not a regular
file) is not replaced either. To start over in either case, move the file away yourself
while gEdit is closed.

Writes are atomic: the file is written whole or not at all.

Which machine a *document* uses is remembered per file, and that is kept somewhere else —
in gEdit's own state file, not in `machines.json` (see
[Choosing the machine for a document](#choosing-the-machine-for-a-document)). Copying
`machines.json` to another computer therefore brings the machines and the dialect defaults
across, but not "this program is for Lathe 2". A default for the dialect is the answer
that does travel with that one file, which is what makes it the right setting for a shop
where every lathe program goes to the same lathe.

## What gEdit assumes, and what it does not know

Everything below is a **documented default, not a fact about your machine.** It comes from
the project's own notes on each control, which were written from control documentation
and, where that ran out, from general knowledge; where those notes leave a question open,
this page says so rather than dress it up as knowledge. Nothing here has been checked
against a machine on a shop floor. Until a machine sets a value, the status item's tooltip
shows it as "dialect default, assumed" — or, for a G-code system read off the program, as
"detected in this program".

| | Fanuc (ISO) mill | Fanuc (ISO) lathe | Okuma OSP lathe | Sinumerik 840D (turning) |
|---|---|---|---|---|
| How numbers are read | Increments of 0.001 mm (IS-B); feeds and speeds as written | Positions as written; cycle parameters in microns | Unit 1 mm: everything as written | As written |
| Other presets offered | Increments of 0.0001 mm (IS-C); as written | Increments of 0.001 mm (IS-B); increments of 0.0001 mm (IS-C) | Unit 1 µm; Unit 10 µm (metric only) | none: the control's own language has only this reading |
| Units at power-on | Millimetres | Millimetres | Millimetres | Millimetres |
| X is a diameter | not a parameter of this dialect | on (`X` and `U`) | on | on (`DIAMON`) |
| G-code system | not a parameter of this dialect | A | not a parameter of this dialect | not a parameter of this dialect |
| Power-on codes | feed per minute (`G94`) | feed per revolution (`G99`), direct rpm (`G97`), ZX plane (`G18`) | feed per revolution (`G95`), absolute (`G90`); no spindle-speed mode | feed per revolution (`G95`), ZX plane (`G18`) |

Known soft spots in that table, said plainly:

- The **mill default** is increments of 0.001 mm. It is the reading the project's notes
  describe first, and both readings occur on real controls. If your mill is set to
  calculator-type input, configure it — the dialect profile knows nothing about your
  machine.
- The **lathe default** is "as written" for positions, feeds and dwells, with the cycle
  steps still counted in microns — taken from turning manuals that write `G0 X40 W-40` for
  40 mm and `G4 U2` for two seconds. It is a reading of those manuals, not a measurement,
  and it is exactly the sort of thing to confirm per machine.
- Whether a control counting increments reads a **feed per revolution** as written or in
  increments is not settled in the notes. gEdit assumes as written, and both increment
  presets say so in their own name — it is the assumption the smallest and largest feed of
  the scaling script are measured against, so it has to be visible before you rely on
  those limits.
- The **Okuma default of 1 mm** is the one of the three unit systems that reads a program
  the way it looks. It is **not** known to be what your Okuma machines are set to, and it
  is still to be checked. The metric values inside the three presets come from the unit
  table of the control's programming manual — the 10 µm preset has no inch values, because
  the control has no 10 µm inch system — and the choice among them is the assumption. That
  choice decides every number, so it is the first thing to set when you configure an Okuma
  machine.
- The **Sinumerik reading "as written"** is settled by the control's programming manual for
  its own language, which is why it is the only reading offered.
- **Diameter programming on** for the Sinumerik turning profile is a decision taken for
  this turning profile, not something read off a control, and it differs from the control's
  delivery state, which is radius programming. It holds for the usual turning setup; a
  control that starts with radius programming needs a machine that says so.
- The Okuma **power-on state** — `G95` and `G90` — is the state after a reset that the
  manual describes. The Sinumerik one — `G95` and `G18` — is what turning programs are
  written in, and it is machine data on the control. Neither has been checked on a machine.
- The **power-on modes** and the assumed **millimetres** of the other profiles are what the
  notes describe as usual, not what your machine does after a reset.
- The default **G-code system A** is a fallback for a program that shows no sign either
  way. The project's Fanuc notes were written mostly from system B material.

### Correcting a default

A default is only what gEdit assumes while nobody has said otherwise. You say otherwise by
defining the machine, once, in `Settings ▸ Machines`, with the values off its control: what
you set in the form replaces the dialect's default for that machine, the status item then
shows the machine's name, and its tooltip says "set by the machine" instead of "dialect
default, assumed". (A power-on code left at "Dialect default" keeps the dialect's.) Then put
the machine to use:

- **for one program**, by picking it in the status bar — the choice is remembered for that
  file;
- **for every program of its dialect**, by making it the **Default for its dialect**. A shop
  whose Okuma programs all go to machines with the same unit system sets this once.

If a default turns out to be wrong for the machines it was meant for — not for one of
yours, but in general — tell the project. Each default is one entry in the dialect's
profile, so it is corrected there once, for everybody.

And three things gEdit does not do at all, so that nothing here is oversold:

- **It does not read your control.** There is no connection to a machine, and no import of a
  parameter file. What gEdit knows is what you typed into the form.
- **It does not simulate.** A machine configuration changes how a value is *read*, not where
  the tool goes. There is no backplot.
- **It does not correct your program.** Choosing a machine never rewrites a single byte.
  What changes is what gEdit is willing to tell you about the bytes that are there.

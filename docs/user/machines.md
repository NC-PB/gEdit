# Machines

A [dialect profile](dialects.md) says how a program is **written**: what a comment looks
like, where the block number goes, which codes exist. A **machine configuration** says how
one particular control **reads** it.

Those are two different questions, and the second one has no answer that holds for a whole
control family. Whether `X50` is fifty millimetres or five hundredths of one, whether the
lathe is set up for G-code system A or B, whether the spindle is in feed per revolution
before the program says anything — none of that is a property of "Fanuc". It is a property
of the machine standing in your workshop, set by its parameters when it was commissioned.
So it is yours to tell gEdit, once per machine.

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

gEdit's rule for this is short and it does not bend:

> **No machine, no guess.** Where the presets a dialect knows would read a word
> differently, and you have not said which control this program is for, the word gets no
> value at all. It is reported, not converted.

That is why the status bar says **assumed** next to "Machine: none". It is not a nag. It is
the difference between an editor that is honest and one that is confidently wrong.

## The three ways a control reads a number

gEdit knows three. A machine configuration picks one — as a named preset, or per class of
word where the control distinguishes them.

| Reading | A word **with** a point | A word **without** a point |
|---|---|---|
| **In increments** | as written | a count of least input increments |
| **As written** | as written | as written |
| **Scaled** | multiplied by the unit | multiplied by the unit |

**In increments** — Fanuc's IS-B and IS-C, with calculator-type input off. `X50.` is
50 mm; `X50` is 50 increments, so 0.050 mm on IS-B (0.001 mm per increment) and 0.0050 mm
on IS-C (0.0001 mm). The point is what makes the difference.

**As written** — Fanuc's calculator-type input. `X50` and `X50.` are both 50 mm, and `G04
U2` is a two-second dwell. This is the default gEdit assumes for the lathe profile, because
the turning manuals the project worked from write `G0 X40 W-40` for 40 mm in exactly this
way. The cycle parameters written in microns are the exception and are still counted; see
[Not every word is read the same way](#not-every-word-is-read-the-same-way).

**Scaled** — the whole program is measured in a unit the machine parameter names, and the
decimal point changes nothing at all. On a control set to 10 µm, `X1000` is 10 mm **and**
`X0.1` is 0.001 mm. gEdit can express this reading, and no dialect that ships today offers
it as a preset; it is here for the controls that work this way.

The difference between the first and the third is worth a second look, because they are
easy to confuse. In the first, a decimal point rescues you. In the third, it does not: a
value with a point is scaled exactly like one without.

### Not every word is read the same way

A control can distinguish kinds of word, and gEdit follows it. The classes are:

| Class | Which words | Unit |
|---|---|---|
| Length | axis words, their incremental twins, arc centres, most cycle depths and `R` | mm or inch |
| Angle | the words the profile lists as angular (`C` on a lathe) | degrees |
| Dwell | the dwell word of `G04` | seconds |
| Feed per minute | the feed word while feed per minute is in force | mm/min or in/min |
| Feed per revolution | the feed word while feed per revolution is in force | mm/rev or in/rev |

On both shipped Fanuc presets that count increments, the **feeds are read as written**: a
1 mm/min increment gives the same number either way, so `F155` is 155 mm/min whatever the
decimal-point setting is. That is why the feed limits in the scaling script keep working
even with no machine chosen. (Whether a control with calculator-type input off really reads
a feed per revolution as written is one of the things the project has not been able to
confirm — see [What gEdit assumes](#what-gedit-assumes-and-what-it-does-not-know).)

Angles and dwells do not follow the metric/inch switch: degrees are degrees and seconds are
seconds in an inch program too. On a control that counts in thousandths, `C90000` is 90° and
`G04 X2500` is a dwell of 2.5 seconds — in a millimetre program and in an inch program
alike.

A few cycle parameters are counts of increments **whatever** the machine's general setting
is — the µm peck and retract values of the deep-hole and grooving cycles are the usual
case. gEdit knows which ones from the code database, and treats them as counts rather than
as millimetres. That holds on a control that reads positions as written too: the project's
notes describe one machine on which `X50` is 50 mm *and* the peck `Q6000` is 6 mm, so "as
written" is a statement about positions and not about the micron parameters of a cycle.
The "as written" preset therefore names an increment of 0.001 mm for those parameters, and
the machine dialog says so.

## What "none" means

"Machine: none" is a perfectly good state. It means: read this program with what the
**dialect** documents, and mark every one of those values as assumed.

Concretely, with no machine:

- Anything that does not depend on the machine is unaffected. Highlighting, the program
  map, hover help, completion, every transformation on the NC tab, comparing, saving — none
  of it changes.
- **Scaling still works.** Multiplying a feed by 90 % is unit-free: `F155` becomes `F140`
  whether that `F` means 155 mm/min or 0.155. The scripts do the arithmetic on the number
  as it is written.
- **Comparing with a limit needs a value.** If a feed cannot be given one, the scaling
  script still scales it and tells you it could not check it against your minimum or
  maximum.
- A word whose value depends on the machine is **listed, never converted**. Where gEdit can
  show you what each preset would make of it, it does — the assumed default first.

The one case that surprises people: on the lathe profile, whose assumed reading is "as
written", a cycle parameter that is a count of increments has **no** value. `G83 ... Q6000`
is a six-millimetre peck on a machine set to thousandths and something else entirely on a
machine set up differently, and "as written" does not answer the question. gEdit says so
instead of picking one.

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
| **Name** | What the status bar and the picker call it. Yours to choose: "Lathe 2", "DMU 50", "the old one" |
| **How the control reads numbers** | One of the dialect's presets. Every preset's name says what it does to a word with and without a point, so you can pick it without knowing the jargon |
| **Units at power-on** | Millimetres or inches — what the control measures in until the program says otherwise |
| **X and U are diameters at power-on** | Turning only. Off for a control set to radius programming |
| **G-code system** | Fanuc lathe only: A or B. See [the lathe](#the-lathe) |
| **Power-on code**, one per modal group | What is in force before the program sets it — feed mode, spindle-speed mode, plane. "Dialect default" leaves it to the profile |
| **Notes** | Your own note. gEdit only stores it |

3. **Save.**

Afterwards: **Edit…**, **Duplicate…** (the fast way to a second machine that differs in one
setting), **Remove**, and **Default for its dialect** — the machine a document of that
dialect gets when nothing else applies. A removed machine does not break the documents that
used it; they fall back to the defaults and say so.

## Choosing the machine for a document

The status bar, on the right, shows **Machine: <name>** — or **Machine: none (assumed)**.
Click it:

- **None (dialect defaults)** — the explicit choice, not the same as never having chosen.
- Every machine of this document's dialect, with the default marked.
- **Other machines…** — the machines of the other dialects. Picking one also switches the
  document's dialect, because a machine is a setup of one dialect.
- **Manage machines…**

Hover the status item and it lists every effective parameter with **where it came from**:
set by the machine, detected in this program, or dialect default (assumed). Nothing in that
list has to be believed; it says who claimed it.

The item is not shown at all for a dialect that has no machine parameters.

**The choice is remembered for that file.** Pick a machine for `WELLE.NC` and it is there
again the next time you open `WELLE.NC`, this afternoon or next month — **None (dialect
defaults)** included, which is why it is a choice of its own rather than the absence of
one. gEdit keeps that for the last 500 files you opened, in its own state file; nothing is
written into the program, and a copy of the file on another computer knows nothing about
it. `Settings ▸ Files ▸ Remember where you were in each file` turns it off, and the
dialect's default machine takes over again.

A remembered machine that is no longer there — you removed it, or the file came from
another computer — is ignored. The document falls back to the dialect's default, with the
one notice it would give anyway, exactly as if nothing had been remembered.

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
  everything, it is a single *unit* parameter for the program.
- **The G-code system**, on a Fanuc lathe, is its own parameter. The machine's manual
  usually prints the A/B/C table next to it.
- **The power-on modes** — feed per minute or per revolution, constant surface speed or
  direct rpm, the plane — are parameters too, and on many machines the same list also says
  what a reset restores.
- **Diameter or radius programming** for the turning axis is a parameter as well.

If you cannot get at the parameters, the safest test is a program: write the same move with
and without the decimal point, run it dry, and see which one moves how far. Then set gEdit
to match what you saw.

**Your control's manual and its parameter list are the authority. gEdit is not.**

## The lathe

Turning brings four things a mill program does not have.

**X is a diameter.** On the lathe profile gEdit assumes diameter programming is on at
power-on, which is the usual setup for turning, and a machine configuration can say
otherwise. Whether one particular `X` word in one particular block is a diameter or a radius
is a second question: on controls that have a mixed mode it also depends on whether the
block is absolute or incremental, so gEdit answers it per block rather than per program.

**G-code system A or B.** On a Fanuc lathe the same numbers mean different things depending
on a parameter: in system A the feed modes are `G98`/`G99` and the speed clamp is `G50`; in
system B they are `G94`/`G95` and the clamp is `G92`. Same program text, different meaning.
gEdit treats this as a machine setting, because that is what it is.

With no machine, gEdit reads the program and decides from what is in it — a `G50 S2500`
points at A, a `G92 S2500` or a `G77`/`G78` points at B — and falls back to A when the
program says nothing either way. The status item shows what it settled on and marks it
assumed. **A machine that names the system always wins over what the text looks like.**

**The tool word changes the tool.** A turret lathe has no `M6`. gEdit reads a `T` word on
the lathe profile as station plus offset: four digits are two and two (`T0101` is station 1
with offset 01), three digits are one and two (`T111` is station 1 with offset 11), one or
two digits are the station alone. A word whose offset digits are `00` — `T0100` in a
retract block — cancels the offset and is **not** a tool change, so it does not turn up as
a tool in the program map or the tool list.

If your posts write short tool words in which the last digit is an offset rather than part
of the station, that rule is wrong for your machine. Say so; it is a data change, not a
program change.

**A feed can be a thread lead.** In a threading or tapping cycle the `F` word carries a lead
rather than a feed rate, and scaling it cuts a different thread. Which codes those are is
again a question of the G-code system — `G32`, `G76` and `G92` in system A, `G33` and `G78`
among them in system B — so gEdit takes the answer from the code database of the system in
force. Hover says so on the block, and the scaling script refuses those blocks and lists
them.

The power-on state the lathe profile assumes is feed per revolution, direct rpm and the ZX
plane (in system B, feed per revolution is written `G95`). Those are documented defaults,
and a machine configuration is how you correct them.

## Where the file is, and how to back it up

Machine configurations live in **`machines.json`**, next to `settings.json` in your
application configuration folder — on macOS
`~/Library/Application Support/com.pburg.gedit/machines.json`, with the equivalent folder
on Windows and Linux. They are deliberately *not* in `settings.json`: they are records with
their own names, not preferences.

To back them up or move them to another machine, copy that one file. To share a shop's
setup, copy it to the same place on the other computer.

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
        "numberInput": { "mode": "calculator", "incrementMm": "1" },
        "units": "mm",
        "diameter": "on",
        "variants": { "gcodeSystem": "B" },
        "modalInitial": { "feedmode": "G95" }
      },
      "notes": "The big chuck; set up for G-code system B."
    }
  ],
  "defaults": { "fanuc-lathe": "lathe-2" }
}
```

**Open machines file** on the Machines page opens it as a document in gEdit. Saving it
makes gEdit re-read it, so the next thing you do on the Machines page is written on top of
your edit rather than over it. A number rule you wrote by hand that matches no preset shows
in the form as "Custom (edited in the file)" and survives an edit of the name — gEdit does
not quietly replace what it did not offer you.

If the file cannot be read — a stray comma, or a file written by a newer version of gEdit —
then:

- no machine configuration is in use, and every document falls back to the documented
  defaults, with one notice saying so;
- the Machines page disables everything that writes, and offers only **Open machines file**
  and **Replace with an empty file**. A hand edit is never overwritten behind your back;
- **Replace with an empty file** keeps the old one as `machines.json.bak`.

Writes are atomic: the file is written whole or not at all, and a previous file that could
not be used is rescued as `machines.json.bak` first.

Which machine a *document* uses is remembered per file, and that is kept somewhere else —
in gEdit's own state file, not in `machines.json` (see
[Choosing the machine for a document](#choosing-the-machine-for-a-document)). Copying
`machines.json` to another computer therefore brings the machines and the dialect defaults
across, but not "this program is for Lathe 2". A default for the dialect is the answer
that does travel with that one file, which is what makes it the right setting for a shop
where every lathe program goes to the same lathe.

## What gEdit assumes, and what it does not know

Everything below is a **documented default, not a fact about your machine.** It comes from
the project's own syntax notes, which were written from control documentation — and where
those notes leave a question open, the value is marked as unconfirmed rather than dressed
up as knowledge. Nothing here has been checked against a machine on a shop floor.

| | Fanuc (ISO) mill | Fanuc (ISO) lathe |
|---|---|---|
| How numbers are read | Increments of 0.001 mm (IS-B); feeds and speeds as written | Positions as written; cycle parameters in microns |
| Other presets offered | Increments of 0.0001 mm (IS-C); everything as written | the same three |
| Units at power-on | Millimetres | Millimetres |
| X and U are diameters | not a parameter of this dialect | on |
| G-code system | not a parameter of this dialect | A |
| Power-on codes | feed per minute (`G94`) | feed per revolution (`G99`), direct rpm (`G97`), ZX plane (`G18`) |

Known soft spots in that table, said plainly:

- The **mill default** is increments of 0.001 mm. It is the reading the project's notes
  describe first, and both readings occur on real controls. If your mill is set to
  calculator-type input, configure it — the dialect profile knows nothing about your
  machine.
- The **lathe default** is "everything as written", taken from turning manuals that write
  `G0 X40 W-40` for 40 mm and `G4 U2` for two seconds. It is a reading of those manuals, not
  a measurement, and it is exactly the sort of thing to confirm per machine.
- Whether a control counting increments reads a **feed per revolution** as written or in
  increments is not settled in the notes. gEdit assumes as written, and both increment
  presets say so in their own name — it is the assumption the smallest and largest feed of
  the scaling script are measured against, so it has to be visible before you rely on
  those limits.
- The **power-on modes** and the assumed **millimetres** are what those notes describe as
  usual, not what your machine does after a reset.
- The default **G-code system A** is a fallback for a program that shows no sign either
  way. The project's Fanuc notes were written mostly from system B material.

And three things gEdit does not do at all, so that nothing here is oversold:

- **It does not read your control.** There is no connection to a machine, and no import of a
  parameter file. What gEdit knows is what you typed into the form.
- **It does not simulate.** A machine configuration changes how a value is *read*, not where
  the tool goes. There is no backplot.
- **It does not correct your program.** Choosing a machine never rewrites a single byte.
  What changes is what gEdit is willing to tell you about the bytes that are there.

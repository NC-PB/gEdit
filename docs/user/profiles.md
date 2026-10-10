# Your own profiles and code files

The six [dialect profiles](dialects.md) that come with gEdit cover the controls. They do
not cover **your shop**: the folder where lathe 2's programs land, the step your post
numbers in, the M codes your machine builder added to a control, the way you want a
dialect to behave while you type. For that you can write two kinds of small files of your
own:

- a **profile**, which starts from one of the six (or from another profile of yours) and
  changes only what differs;
- a **code file**, which adds your own G and M codes, with a short description each, to the
  hover help and the completion list.

Both are plain text files in JSON, kept in gEdit's configuration folder. You can write them
in gEdit itself (it starts a new file for you), you can send them to a colleague, and you
can copy them to another computer.

| In this page | |
|---|---|
| [Profile or machine?](#profile-or-machine) | Which of the two is the right place for a setting |
| [Where the files are](#where-the-files-are) | Folders, file names, limits |
| [The Profiles page](#the-profiles-page) | New, Open, Import, Export, Remove, Reload |
| [An example profile](#an-example-profile) | A profile for one lathe, line by line |
| [When your profile is used](#when-your-profile-is-used) | How a program ends up with it |
| [Code files](#code-files-your-own-g-and-m-codes) | Adding to a built-in set, or a set of your own, with an M-code table |
| [Testing a profile on a program](#testing-a-profile-on-a-program) | What every rule finds, line by line |
| [When a file has a problem](#when-a-file-has-a-problem) | What happens to a broken file |
| [Typing options](#typing-options-in-a-profile) | Upper case and joined blocks, per profile |

## Profile or machine?

A profile and a [machine configuration](machines.md) both describe "how things are for this
program", and it is easy to put a setting in the wrong one. The test is: *does it change
how the program is written, or how the control reads it?*

| | A profile of yours | A machine configuration |
|---|---|---|
| Says | How programs of this kind are **written** and recognised | How **one control** reads what is written |
| Examples | The folder or extension a post's files come in; the block-number step and the lines that stay unnumbered; which comments mark the program name; your own G and M codes and what they mean; whether typing is forced to upper case | What `X50` is worth; the unit system; the G-code system; whether `X` is a diameter at power-on; what is modal at power-on; the channels and wait codes |
| Shared by | Every program that is opened with it, whichever machine it is for | Every program you say is for that machine |
| Lives in | One file per profile in `profiles/` | One file for all machines, `machines.json` |
| How many | As many as you write (but a profile that changes nothing is not worth a file) | One per control you run |

Two machines of the same make usually need **two machine configurations and no profile at
all**. You write a profile when programs of one shop, one post or one folder are written
differently from the dialect's default, or when you want your own codes in the help. The two
work together: a machine configuration can be set up for a profile of yours, and then it
offers the same fields as the profile it starts from.

## Where the files are

| | |
|---|---|
| Profiles | `<config>/profiles/` |
| Code files | `<config>/codes/` |

`<config>` is the same folder that holds `settings.json` and `machines.json`; where it is on
your system is under [Where things are](README.md#where-things-are). gEdit makes both
folders itself.

- A file name is lower case: letters, digits, `-`, `_` and `.`, ending in `.json`, at most 64
  characters, starting with a letter or a digit (`shop-lathe-2.json`). A `.json` file whose
  name does not follow this (`Lathe-Shop.json`, `my profile.json`) is listed with the reason
  and not read: rename it to lower case without spaces. It also keeps its name taken, on a
  system that does not tell capitals apart. On Windows, the names the system reserves
  (`con.json`, `nul.json`, …) are refused too.
- A file is a single JSON object, at most 1 MiB, in UTF-8 without a byte-order mark, and its
  JSON nests at most 64 levels deep.
- **Limits inside a profile.** A pattern is at most 1,000 characters; a list of patterns
  (`detect.content`, `vetoes`, `outline`, the program start and end, the block-number
  references, `freeText`, `cycleNames`, a variant's `detect`, …) has at most 200 entries, and a
  profile at most 1,000 patterns in all. `name` and `filterName` are at most 80 characters,
  `shortName` at most 16, a folder in `detect.folders` at most 260. A pattern that would
  freeze the editor on some text, such as `(a+)+$` or `^(\w+\s?)*$` (a repeated group whose
  parts can match the same characters in several ways), is refused with the place in the file;
  a pattern copied unchanged from a built-in profile is let through. `files.extensions` and
  `detect.extensions` may not name `json` or `py`: typing options and the dialect are for NC
  programs, and these are the files you edit your profiles and scripts in.
- At most 64 files in each folder are read. The 65th is listed with the reason and not read.
- A link (a shortcut or symbolic link) is never followed. A file that is one is listed with a
  problem; copy the real file into the folder instead.
- gEdit never overwrites a file of that name when it creates or imports one.

Everything is JSON, so the usual rules apply: double quotes around every word, a comma
between members, no comma after the last one, and no comments. On Windows write a folder
with forward slashes (`D:/CAM/lathe2`); a backslash would have to be written twice.

## The Profiles page

`Settings ▸ Profiles`, or **Manage Profiles…** from the command palette (`F1`). The page
lists three things:

- **Your profiles** — one row per file in `profiles/`, with the profile's name, its file name,
  the profile it starts from, and how many problems the file has. A **note** (for example a
  code entry of yours that changes what a built-in code means) is listed under the file in a
  quieter line and is not counted as a problem. A row lists at most 50 problems and 50 notes,
  and says how many more there are.
- **Your code files** — the same for `codes/`.
- **Built-in profiles** — the six, for reference. Their rows only offer **New profile from
  this…**.

| Button | What it does |
|---|---|
| **New profile from…** (on the page, or on a built-in row as **New profile from this…**) | Asks which profile to start from and what to call the file, writes a small starting file and opens it as a document. Save it to use it |
| **New code file from…** | The same for a code file: pick a built-in set, name the file. See [Code files](#code-files-your-own-g-and-m-codes) for what the name means |
| **Import profile…**, **Import code file…** | Copies a file you pick into the folder (under a lower-case version of its name), without changing a byte. The original stays where it is. It does not overwrite a file of the same name |
| **Open** | Opens the file as a document |
| **Export…** | Saves a copy where you choose |
| **Remove…** | Deletes the file, after asking. This cannot be undone. Documents that were using a removed profile are read as whatever gEdit detects for them |
| **Test on document** | Shows what the profile's rules find in the program you have open: [Testing a profile on a program](#testing-a-profile-on-a-program). One test runs at a time |
| **Reload** | Reads both folders again |

You rarely need **Reload**: **a change takes effect when you save the file**. Saving a file
that is in the `profiles/` or `codes/` folder makes gEdit read both folders again, and every
open document is read with the new rules at once, without losing its text or its place. A
file you copy into the folder yourself, from outside gEdit, is picked up by **Reload** (or
**Reload Profiles** in the palette) or the next start.

The same commands are in the palette (`F1`): **New Profile From…**, **Open Profile File…**,
**Import Profile File…**, **Export Profile File…**, **Reload Profiles**,
**Test Profile on Document** and **Manage Profiles…**. From the palette each asks whether you
mean a profile or a code file. None has a keyboard shortcut. **Test Profile on Document** is
also on the **Tools** tab, in the **Profiles** group.

## An example profile

Say lathe 2 is a Fanuc-style lathe in system B whose programs land in `D:/CAM/lathe2`, and
its post numbers in steps of 5. Choose **New profile from…**, start from **Fanuc (ISO)
lathe**, call the file `shop-lathe-2`. gEdit writes and opens a starting file; this is the
finished profile:

```json
{
  "id": "shop-lathe-2",
  "name": "Shop lathe 2",
  "shortName": "Lathe 2",
  "version": 1,
  "extends": "fanuc-lathe",
  "codes": "shop-lathe",
  "detect": {
    "folders": ["D:/CAM/lathe2"],
    "content": []
  },
  "numbering": {
    "start": 5,
    "step": 5
  },
  "editing": {
    "preventLineJoin": false
  }
}
```

| Member | |
|---|---|
| `id` | The profile's identity. Lower case, no spaces, **different from the id of every built-in profile** and from that of every other profile of yours. It is what a [machine configuration](machines.md) refers to, so do not change it later |
| `name`, `shortName` | What the dialect picker calls the profile, and what the status bar shows (`Lathe 2`). Both are yours to choose, and a profile that starts from another must give its own — it cannot inherit them |
| `version` | Leave it at `1` |
| `extends` | The profile this one starts from: one of the six (`fanuc-gcode`, `fanuc-lathe`, `heidenhain-klartext`, `okuma-osp`, `sinumerik`, `sinumerik-mill`) or another file of yours. A chain may be four profiles long |
| `codes` | Which set of G and M codes the hover and the completion read. Left out, the profile uses its parent's. Here it names the code file `shop-lathe` from the [next section](#a-set-of-your-own-with-an-m-code-table) |
| `detect` | How a program comes to be read with this profile: [below](#when-your-profile-is-used) |
| `numbering` | The renumbering defaults: here the first block is `N5` and the step 5. Everything not written here stays as the parent has it (skipped lines, the limit, jumps that follow a renumber) |
| `editing` | The [typing options](#typing-options-in-a-profile) |

**What you write is laid over what the parent has.** This is the rule behind every profile
file, and it explains most surprises:

- A **setting** you write replaces the parent's setting. Write `"step": 5` and the parent's
  `start`, `max` and the rest stay.
- A **group of settings** (`numbering`, `detect`, `editing`) is merged member by member, so
  writing one member leaves the others as they were.
- A **list** you write replaces the parent's list **whole**. This is on purpose: the lists
  are rules where the first match wins, and a child that could only add rules could never
  say "not that one". The price is that you write out a list in full if you change it. The
  example uses it: `"content": []` throws away the parent's content rules, so that this
  profile is chosen only by what it says itself.
- `null` switches off something the parent has.

You only write what differs, and a profile file is usually under twenty lines. The full set of
members is whatever a built-in profile file contains; the built-ins are the reference, and
**Test on document** is how you find out what a pattern does. Patterns (`pattern` members)
are [regular expressions](regex.md) in the part that JavaScript and Python share.

## When your profile is used

A program is opened with a profile of yours in one of two ways: **you pick it**, or **a rule
that the profile itself added** picks it.

**You pick it.** Click the dialect in the status bar and choose the profile; it is listed
under its `name`. A dialect you chose by hand for a file wins over everything and is
remembered for that file, exactly like the choice of a built-in one
([Coming back where you left off](README.md#coming-back-where-you-left-off)).

**The profile picks itself, but only through rules it wrote.** gEdit scores every profile on
a program (see [Which dialect a file gets](dialects.md#which-dialect-a-file-gets)). A profile
of yours takes part in this automatically only through the detection rules **it adds**:

- **Its folder.** Every program inside a folder listed in `detect.folders` (subfolders
  included, capitals ignored) is read with the profile, whatever it contains. This is the
  usual case, one profile per machine folder, and the most reliable one. When folders of two
  profiles are nested, the deeper folder wins.
- **Its extension**, if you add one in `detect.extensions` (`"l2": 6` counts for files
  ending in `.l2`).
- **Its content**, if you add patterns in `detect.content`.

What the profile only **inherits** from the one it starts from does **not** make it a
candidate. If it did, a profile of yours that changes only the numbering would take over
every Fanuc lathe program on the computer, just because it matches all of them as well as
its parent does. So **whenever a built-in profile and a profile of yours score the same, the
built-in profile wins, whatever the priority**: not only against its parent, against every
built-in. Your profile is chosen by its own folder, extension or content rules, or by hand.
Between two profiles of yours that score the same, the one the other starts from (the
ancestor) wins, then the higher `detect.priority`. A profile that
adds no rule of its own is never picked by itself; pick it by hand.

This is also the reason the starting file has an empty `content` list: the profile then has
nothing of its own to win a program with, until you add a folder or a pattern. To check what
your rules do, use [Test on document](#testing-a-profile-on-a-program); the first line of the
result says which dialect gEdit would pick for this text.

## Code files: your own G and M codes

A code file adds codes to the database the hover and the completion read
([Code help](README.md#code-help)). It is a JSON object with a `dialect`, a `version` and a
list of entries.

**What it does to a database depends on its file name.**

| The file is called | It is | |
|---|---|---|
| The name of a built-in set — `fanuc`, `fanuc-lathe`, `fanuc-lathe-b`, `okuma`, `sinumerik`, `heidenhain` | An **addition** to that set | Its entries are laid over the built-in ones, for the profile that reads the set and for every profile that starts from it. It does not say `extends` |
| Any other name (`shop-lathe`) | A **set of its own** | It starts from the set named in `extends` (which it must say) and adds its own entries. A profile uses it by naming it in `codes` |

In both, **`dialect` must be the file name without `.json`**. gEdit offers the right
starting file in **New code file from…**: pick a built-in set and either give the file the
same name (an addition) or another name (a new set that starts from it).

### A set of your own, with an M-code table

Lathe 2's builder added four M codes. Written down for the shop as a table, they are:

| Code | What it does on lathe 2 |
|---|---|
| `M13` | Chip conveyor on |
| `M14` | Chip conveyor off |
| `M21` | Tailstock quill forward |
| `M22` | Tailstock quill back |

The code file `shop-lathe.json` says the same to gEdit:

```json
{
  "dialect": "shop-lathe",
  "version": 1,
  "extends": "fanuc-lathe",
  "codes": [
    {
      "code": "M13",
      "group": "auxiliary",
      "label": "Chip conveyor on",
      "description": "Starts the chip conveyor. A code of the builder of lathe 2; another lathe may use it for something else."
    },
    {
      "code": "M14",
      "group": "auxiliary",
      "label": "Chip conveyor off",
      "description": "Stops the chip conveyor."
    },
    {
      "code": "M21",
      "aliases": ["M021"],
      "group": "auxiliary",
      "label": "Tailstock quill forward",
      "description": "Moves the tailstock quill forward against the part."
    },
    {
      "code": "M22",
      "group": "auxiliary",
      "label": "Tailstock quill back",
      "description": "Retracts the tailstock quill."
    }
  ]
}
```

and the profile points at it with `"codes": "shop-lathe"`, as in the example above. From
then on, a document read with that profile shows these four descriptions on hover and offers
the codes in completion, next to everything the Fanuc lathe set already describes. Write
descriptions in your own words and keep them short and factual; the control's manual, and
not this guide, is the authority on what a code does.

If you leave out `extends`, or name a set that does not exist, the file is reported and not
used.

### What an entry holds

| Member | |
|---|---|
| `code` | The code as it is normally written, without a leading zero: `M13`, `G54.1`. **Required** |
| `label` | A few words. **Required** for a new code (and with `"replace": true`); an entry for a code the database already has may leave it out and keeps the built-in label |
| `replace` | `true` replaces the built-in entry of that code whole, instead of changing only the members written |
| `description` | A sentence or two, shown on hover |
| `aliases` | Other spellings of the same code (`M021`). A spelling that differs only by capitals or leading zeros needs no alias |
| `group` | A free word to sort by (`coolant`, `auxiliary`). The groups the built-in sets use for the modal state (`motion`, `plane`, `distance`, …) are best left to them |
| `modal` | `true` when the code stays in force until another of its group replaces it |
| `params` | The words the code takes: a list of `{ "address": "P", "label": "…" }`, with `"required": true`, `"min"` and `"max"` where they apply. On a cycle written in two blocks, `"block": 1` or `"block": 2` says which block a word belongs to ([below](#cycles-written-in-two-blocks)) |
| `blocks` | `2` for a cycle written in two blocks with the same code, such as the lathe's `G71` and `G76` |
| `verify` | `true` marks an entry you are not sure about: it is kept out of the hover and marked in the completion list, as the built-in "not verified yet" entries are |
| `review` | `"pending"` marks an entry that is still waiting for a review; the built-in sets use it for entries filled in from the control manuals. It changes nothing gEdit shows or does |

An entry for a code the database already has **changes only the members it writes**. The
others, the label included, stay as they are; `sets` is merged by key, and a list (such as
`params`) is replaced whole. So to change only the label of `M8`, write just that:

```json
{
  "dialect": "fanuc-lathe",
  "version": 1,
  "codes": [
    {
      "code": "M8",
      "label": "Coolant on, high pressure",
      "description": "On these lathes M8 starts the high-pressure pump as well as the flood coolant."
    }
  ]
}
```

(This one is called `fanuc-lathe.json`, so it is an addition and says no `extends`.) Write
`"replace": true` in an entry to replace the built-in entry whole instead; then it has to
hold everything it needs, and a `label` is required. gEdit lists every change of **meaning**
(not of label or description) as a note on the Profiles page, for example *G76: your entry
sets pitchFeed to false ("fanuc-lathe" has true); scale feed will scale its F like a feed*. An
entry for a code the database does not have is a new code and needs its `label`. A set of
your own can also list codes of its parent that its control does not have in a `remove` list,
the way the built-in lathe set does for the mill's drilling cycles.

#### Cycles written in two blocks

The lathe roughing, pecking and threading cycles `G71` to `G76` are written in two blocks with
the same code, and one letter can mean something else in each: in

```
G71 U2. R0.5
G71 P100 Q200 U0.4 W0.1 F0.25
```

the first `U` is the depth of cut and the second the finishing allowance on X. The entry says
so with `"blocks": 2`, and each of its `params` with `"block": 1` or `"block": 2`; a word without
`block` belongs to both. A letter may be listed once for each block, each time with its own
label:

```json
"params": [
  { "address": "U", "label": "Depth of cut per pass", "block": 1 },
  { "address": "R", "label": "Retract after each pass", "block": 1 },
  { "address": "P", "label": "First profile block", "block": 2 },
  { "address": "Q", "label": "Last profile block", "block": 2 },
  { "address": "U", "label": "Finishing allowance on X", "block": 2 }
]
```

gEdit takes a block for the **second** one when it writes a word that only the second block has
(`P` and `Q` here), and for the first when it writes a word of the first block and none of
those; the inspector and the hover then show that
block's words with their labels. Everything else about a letter listed twice, `unit` included,
has to be the same in both blocks: only the label may differ, or the second one is reported and
left out. A `block` on a code without `"blocks": 2` is reported too. An entry with no `block` at
all still works: the inspector then pairs the block with the one above or below it.

### Which set is in force

A Fanuc lathe in G-code system B reads its codes from a second built-in set,
`fanuc-lathe-b`, which differs from system A's in the handful of codes that are numbered
differently. A machine configuration (or the program's own content) decides which system a
document is in; see [the Fanuc lathe](machines.md#the-fanuc-lathe). Your own entries are
**not lost when the system switches**: a code file that starts from the lathe set lays its
entries over whichever of the two is in force. Under the other G-code system, your entries
for codes that system defines differently (or only one system has) are **not used**: the
system's own entry applies, and gEdit lists each one as a note. Your other entries, such as
builder M-codes, apply under both. An `M13` you wrote is therefore found in a program for
system A and in one for system B.

**A file named after a built-in database reaches every database that starts from it**:
`fanuc` reaches `fanuc-lathe` and `fanuc-lathe-b`. A table for one machine type belongs in a
code file of its own that `extends` the database, named by a profile of yours; if an addition
reaches a database that a profile of another machine type reads, gEdit says so in a note.
A profile's `codes` has to name a database that exists, or the profile is reported.

### Templates in a code file

A code file can also hold a `templates` list: the program starts, tool changes and cycles of the
Insert tab. They follow the same rules as the codes: a file named after a built-in set adds
to that set's templates (an id of yours that matches a built-in one replaces it whole), and a
set of your own starts from the templates of the set it `extends`. You do not have to write
the list by hand: the template manager makes and saves it. See
[Writing with templates](templates.md#where-your-templates-are-kept).

## Testing a profile on a program

Open a program, then **Test on document** on the Profiles page, or **Test Profile on
Document** on the Tools tab. By default it tests the profile of the document you have open,
**with the document's machine applied**; from the palette you can also pick another profile,
which tests it on the open text without changing the document's dialect.

The result is a table in the Results panel with a row for every thing a rule of the profile
found, in line order:

| Column | |
|---|---|
| **Line** | The line, a click jumps there. A finding about the whole program has none |
| **What** | *Finding the dialect*, *Ruled out*, *Tool change*, *Program start*, *Program end*, *Program map*, *Block-number reference*, *Renumbering leaves it*, *Setting read from the program*, *Setting chosen* |
| **Rule** | The pattern or rule that found it |
| **Found** | The text it matched and what that means: `"G50 S2500" counts 4 for this profile`, `"T0303" changes to tool 3`, `M99 P10 points at block 10; renumbering does not touch it` |
| **Time** | How long the rule took |

The heading says which dialect gEdit would pick for this text, and whether it is sure.
That makes the table the place to see **why** a program does or does not open with your
profile, why a line is not counted as a tool change, or why renumbering leaves a line alone.

A rule that needs more than 50 ms on a single line is called out with the pattern, the line
and the time. A pattern like that slows down opening a large program: make it more
specific. Only the first 20,000 lines are tested, and the table shows at most 2,000 rows;
it says so when it cuts. The test hands the window back every 200 lines, and all the rules
together may use 5 seconds: after that it stops, and the last row says after how many lines.

A content rule that scored a line above a *Ruled out* line is listed as not counting, with
the line of the veto: a veto sets the profile's score for the whole file to nothing,
whatever was found before it. Testing **another** profile reads the program the way choosing
it would: with no machine, and with the setting the program's own markers point at.

## When a file has a problem

A file of yours can be broken in many ways, and **a broken file never stops the rest**: the
built-in profiles, and every other file that is fine, keep working. When a load finds a
problem, the Results panel opens with one table: the **File**, **Where** in it (the profile
id and the place in the JSON, such as `shop-lathe-2 · numbering.step`) and the **Problem**.
The Profiles page lists the problems of a file on its row. A file reports at most 50
problems and a load at most 500, then says *and N more*, so a very broken file cannot flood
the window. A load with a problem **replaces** what the Results panel shows (a script's or
a search's result too); a note does not open it. The folder's own messages, such as *a link,
not followed*, are in English whatever the language of the window.

| What is wrong | What happens |
|---|---|
| The file is not valid JSON, or is not an object, or is over 1 MiB | The file is listed with the reason and not used |
| A profile's `id` is the id of a built-in profile | The file is not used (problem at `id`) |
| Two of your profiles have the same `id` | The first one by file name is used, the second is reported |
| `extends` names a profile that does not exist, or the chain loops or is more than four long | The profile is reported and not used |
| A member has a wrong value (a pattern that is not a valid expression, a number where text belongs) | The profile is reported and not used, with the place in the file |
| A code file's `dialect` is not its file name | The file is not used |
| A code entry has no `label` where one is needed, or a wrong member | That entry is left out and reported; the built-in entry of the same code stays |
| A profile's `codes` names a database that does not exist | The profile is reported and not used |
| A file nests deeper than 64 levels, or a pattern is too long or too many | The file (or profile) is reported and not used; the others load |
| A new code set with no `extends`, or whose parent is missing | The file is reported and not used |

When a profile that open documents were using disappears (you removed or broke its file),
those documents are read as whatever gEdit detects for them, and the status bar says once how
many. **When the profile comes back** (you fixed the typo and saved again), those documents
return to it, with a line in the status bar, unless you picked a dialect for one of them
in between (picking the one it already sits on counts: it stays there, and gEdit remembers it for the file). A [machine configuration](machines.md) that was set up for it becomes unusable but is
**kept**; it is listed as unusable on the Machines page and works again when the profile is
back.

## Typing options in a profile

A profile can switch the two [typing options](README.md#typing-forced-upper-case-and-no-accidental-joins)
on or off, in its `editing` group:

```json
"editing": {
  "forceUppercase": true,
  "preventLineJoin": true
}
```

Every built-in profile has both on, so a profile that starts from one has them on too. Typing
options apply to NC programs only: in a `.json` or `.py` file (your profile files, `machines.json`,
a script) a key is never changed, and the status bar says so when you switch Upper-Case
Typing on there. The
example above turns the join guard off for lathe 2 and leaves upper case on. A profile with
`forceUppercase` on also makes **Convert Case…** ask before it writes lower case
([Convert Case…](transformations.md#convert-case)).

## Sharing and backing up

The files are yours, in two ordinary folders: copy `profiles/` and `codes/` to back them up
or to another computer, or use **Export…** and **Import…** on the Profiles page to move one
file. An imported file is checked like any other, and a problem in it is reported in Results
right away; the file stays in the folder either way, so you can fix it.

Machine configurations are moved the same way with **Import…** and **Export…** on the
Machines page ([Moving machines to another computer](machines.md#moving-machines-to-another-computer)).
When you move a machine that is set up for a profile of yours, move the profile file with
it: the machine arrives, but it cannot be used until the profile is there.

## What a profile of yours is not

- It is **data**. It describes how a program is written; it cannot run code. A computation
  over a program is a [script](scripts.md).
- It starts from one of the six dialects. It can change how that dialect's lines are
  recognised, numbered and explained, but a control gEdit knows nothing about is still read
  by the closest dialect ([Other controls](dialects.md#other-controls)).
- It describes the **program**, not the machine. Number reading, G-code systems and
  power-on modes stay in the [machine configuration](machines.md).
- It is not shared between computers by itself. Copy the files.

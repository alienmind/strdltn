# DAW plan

The plan to turn [str]dltn Live[code] from an editor with side views into a DAW that is
written in code. Nothing in this file is built. The maintainer reads it, answers the
questions in "Decisions for the maintainer", and then we start with phase 0.

Each claim says where it comes from: "measured" (we ran it, the record is in
`doc/ARCHITECTURE.md` or `doc/TODO.md`), "read" (we read the code or the manual), or
"expected" (not tested). The spikes in "Spikes" turn the expected ones into measured
ones before the work that depends on them starts.

## Goal

The screen of Ableton Live, with code where Live has clips:

| Area of Live | What we build | Today |
|---|---|---|
| Browser (left pane) | One Browser view: search box, color tags, categories, places, and the results in the same column | Three tree views: Files, Sounds, Snippets |
| Session view with the mixer | A Mixer panel: one channel per chain of the song, made of the sliders that act on it, folded to its gain. Cables for sidechains (`.duck` to `.orbit`) and for MIDI (`.midi()` to a device), in two colors | The sliders are rows in the stage |
| Clip and device view (bottom) | The stage, as now, and a Devices view: one panel per firmware that plays, and the SHRUB window | The stage. Firmwares have no panel. SHRUB is a mockup tab behind a setting |
| Arrangement | The code editor, as now | The Strudel editor and the native editor |
| MIDI in and out | Devices in the Browser, `.midi()`, `midin()`, `midikeys()`, MIDI learn on the mixer | Nothing. A webview may not use MIDI (measured) |

The code stays the song. Every panel either shows what the code says or changes the
code. A song sounds the same when it is opened on strudel.cc, apart from the features
strudel.cc does not have (MIDI devices by our bridge, firmwares).

## What we learned before planning

### The browser of Live 12

Read in the Live 12 manual, chapter "Working with the Browser", and the Live 12 release
notes. Items marked (forum) come from the Ableton forum and are not in the manual.

- The sidebar has three sections. **Collections**: seven color labels. An item gets a
  color from its context menu or with the keys 1 to 7, and 0 clears them. An item can
  have several colors, and a row shows at most three, as small squares. A label can be
  renamed. The first is "Favorites", red (forum). **Library**: All, Sounds, Drums,
  Instruments, Audio Effects, MIDI Effects, Modulators, Max for Live, Plug-Ins, Clips,
  Samples, Grooves, Templates, Tunings. **Places**: Packs, Splice, Cloud, Push, User
  Library, Current Project, the user's own folders, "Add Folder...".
- Above the results is the **filter view**: groups of tags shown as small chips. The
  groups differ per label. Seen in the maintainer's screenshot for "All": Content, Type,
  Sounds, Drums, Character, Devices, Function, Format, MIDI Tools. A click on a chip
  narrows the results. Ctrl+click takes several chips of one group. The manual does not
  name the rule; we expect "any chip inside a group, every group must match".
- Tags are a tree: group, tag, subtag. A tag editor adds groups, tags and subtags, and
  tags many files at once. Built-in tags cannot be removed. Live also tags the user's
  samples by listening to them (up to 60 seconds).
- Live keeps the user's tags in files beside the content, in a folder "Ableton Folder
  Info", and an index in a database (forum).
- **Search**: Ctrl+F jumps to "All" and puts the cursor in the search field. Every term
  must match. A term matches the file name. `#Drums` matches a tag. "Add Label" saves
  the search with its filters as a new entry of the sidebar.
- **Preview**: a click on a result plays it. With "Raw" off the preview loops in the
  tempo of the song and starts on the next bar.
- **Hot-swap**: the browser replaces the sound of the selected device in place.

### The cables of ableton-rackutils

Read in `../ableton-rackutils/packages/editor-ui/src/` (MIT, the maintainer's own
project): `PatchCable.tsx`, `MappingCables.tsx`, `useParamDrag.ts`, `holdToDrag.ts`,
`editor.css`.

- A cable is not a simulated rope. It is one SVG path, a cubic curve from plug to plug:
  `M from C (from.x, from.y + sag) (to.x, to.y + sag) to`. The only thing that moves by
  physics is `sag`, one number per cable on a damped spring.
- The step: `acceleration = STIFFNESS * (target - sag) - DAMPING * velocity`, then
  `velocity += acceleration * dt` and `sag += velocity * dt`, with `dt` at most 1/30 s.
  `target = min(distance * SAG_RATIO, SAG_MAX)`.
- Constants of the cable being dragged: `SAG_RATIO` 0.28, `SAG_MAX` 150, `STIFFNESS`
  110, `DAMPING` 11. On a connection the velocity gets +900, which is the bounce. A drop
  on nothing pulls the free end back to its start in 260 ms.
- Constants of the cables that stay: 0.18, 90, 120, 9. An end that moved adds
  `moved * 6` to the velocity, so a cable swings when its channel moves.
- The loop sleeps when every spring is at rest for 30 frames. A resize, a scroll, a DOM
  change or a CSS transition wakes it.
- A drag uses pointer events only. HTML drag and drop passed the tests and did nothing
  in a real browser. The listeners for move and up are attached inside the `pointerdown`
  handler, or a fast flick is lost. The drop target is found with
  `document.elementFromPoint(x, y).closest('[data-...]')`.
- Cables are not stored. They are worked out from the model every time, so they cannot
  disagree with it. A drop changes the model and the cables follow.
- Other lessons recorded there: draw in viewport coordinates on one fixed layer, clip
  the layer to the scroll area, hide the stored cable of the thing being dragged, end a
  cable to a hidden target at its visible container, and respect
  `prefers-reduced-motion`.

The code depends on React only for rendering. We write it again without React, as one
module of our own, about 300 lines.

### The engine of m4l-gugelhupf

Read in `../m4l-gugelhupf` (AGPL-3.0-or-later, the maintainer's own project):
`src/app/shared/engine.worker.js`, `src/max/shared/engine.mjs`,
`src/max/shared/transport.mjs`, `ARCHITECTURE.md`, `DRAWER_OF_FAILED_IDEAS.md`.

- Its MIDI devices run Strudel **without sound in a Web Worker**: `@strudel/core`,
  `mini`, `tonal` and `transpiler`. The worker evaluates the code, asks the pattern for
  the events of the next 150 ms (`pat.queryArc(from, to, { _cps })`), turns each event
  into a note (`pitch`, `velocity`, `durMs`, `chan`, `delayMs`) and posts it. The host
  (Max) applies `delayMs` with its own exact clock and sends the MIDI. The timing of a
  note never depends on a browser timer.
- The host is a "dumb client": it pushes time in (`tick {playing, beats}`, `tempo`) and
  gets events out. The lesson written there: design message driven, and timers barely
  matter. A dedicated worker is not slowed down when its page is hidden.
- Headless Strudel lacks what the repl adds, so `engine.mjs` has its own collector for
  `$:` lines and stand-ins for `setcps`, `slider`, `_scope`, `_pianoroll`.
- Two clocks drift. Late events were once all moved to "now", and a bar of notes fired
  at once. The fix: tie one cycle to one time of the output clock, place later events by
  pattern time, and tie again only on a tempo change or when far off.
- One pattern must have exactly one scheduler. Two engines doubled the notes.
- Its main device takes the other road: the whole strudel.cc site in a hidden window,
  with a shim. That road never got its clock in sync with the host. Our drawer already
  rejects the whole site in a webview.
- MIDI notes coming in do not reach the pattern there yet. It is planned as a message
  into the worker with "one tick" of delay.

What we take: the lookahead and `delayMs` protocol, the clock rule, and the idea that
the part with the exact clock sends the MIDI. What we do not take: its fork of Strudel
(our rule is upstream from npm) and anything of Max.

### Facts about Strudel we read for this plan

In `@strudel/core` 1.2.6 and `superdough` 1.3.0, the versions we pin.

- A line `$: chain` becomes `chain.p('$')`, and `name: chain` becomes `chain.p('name')`.
  `Pattern.prototype.p` keeps each pattern under its id in a private table of the repl
  and gives an id with `$` in it a running number (`$0`, `$kick1`). A name that starts
  or ends with `_` is muted. A name that starts with `S` and is longer than one letter
  is a solo. After the evaluation the repl stacks the table into one pattern.
- The repl puts `p` back on `Pattern.prototype` at every evaluation and calls our
  `beforeEval` after that. So `beforeEval` is a place where we can wrap `p` from
  outside, with no patch.
- Every sound goes through an **orbit**: `superdough` asks
  `audioController.getOrbit(orbit)` for a bus. The bus holds the delay and the reverb of
  that orbit, so `room` and `delay` are shared by everything on one orbit. The default
  orbit is 1.
- `.duck("2,3,4")` on a pattern calls `audioController.duck(...)`, which pulls down the
  volume of those orbits at each event. `duckattack`, `duckdepth` and `duckonset` shape
  it. That is the sidechain. `template/demo.strudel` has it: `$kick` ducks the orbits 2,
  3 and 4, `$bass` plays on orbit 2, `lowendbass` on 3, `$riser` on 4.
- There is no bus per chain. A chain is only a pattern. Volume per chain exists as the
  controls `gain` and `postgain` of each event.
- The repl has an option `sync` that uses `NeoCyclist`, a scheduler that shares one
  clock between windows through a `SharedWorker`. Not tried by us.

### Facts about VS Code we already measured

From `doc/ARCHITECTURE.md`, `doc/TODO.md` and the drawer.

- A webview may not use WebMIDI. An extension cannot change that.
- A webview starts no sound without a click inside it.
- VS Code has no hidden webview. A panel is a visible tab, and a view in the side bar or
  the bottom panel is created when it is first shown.
- In Codespaces the extension host is on a remote machine with no sound card and no
  MIDI devices. Sound has to be made in the user's browser.
- `@julusian/midi` 3.9.0 loads in the extension host and lists the devices. A send takes
  0.05 ms. A plain timer there is late: 10 ms in the middle, 80 ms at worst.
- A tree view draws one line of text per row, takes no color from us, and has no search
  box of its own. A snippet list as a webview was released in 0.1.0 and replaced by a
  tree, because it did not match the Sounds tree above it.

## Design

### Parts

```
extension host                        webviews (browser side)
+---------------------------+         +--------------------------------------+
| index     catalog + tags  | <-----> | Browser view (side bar)              |
| model     chains, orbits, |         |   search, colors, categories, list   |
|           routes of a song| <-----> | Mixer panel (bottom panel)           |
| relay     passes messages |         |   a channel per chain, its sliders,  |
|                           |         |   cables: sidechain and MIDI         |
|           between views   | <-----> | Devices view (bottom panel)          |
|                           |         |   one panel per running firmware,    |
|                           |         |   the SHRUB window                   |
|                           | <-----> | Engine: Strudel editor or stage      |
|                           |         |   firmwares run here, in worklets    |
| midi      devices, bridge |         |   StrudelMirror, superdough, taps    |
+---------------------------+         +--------------------------------------+
```

The engine stays where it is in the first phases: in the Strudel editor or the stage of
the song. The Browser and the Mixer are clients. They hold no engine. The extension
host passes messages between them and the engine of the song in front. Moving the
engine is its own phase, see "Engine".

### Browser

**One webview view replaces Files, Sounds, Snippets and the logo view.** A tree cannot
draw color squares, chips or a search field. The drawer entry "Snippet cards in a
webview" failed because one webview sat between trees. Here the whole side bar is one
webview, so nothing is inconsistent. It also ends two known gaps: the logo view with its
empty strip and its second title, and the missing search box.

Layout, one column, top to bottom:

```
+--------------------------------+
| [str]dltn Live[code]  (banner) |
| [ Search (Ctrl+F)          ] x |
| Collections   o o o o o o o    |   seven color dots, a click filters
| Library                        |
|   All  Sounds  Drums  Samples  |   one row each, with an icon and a count
|   Instruments  Snippets  Songs |
|   Functions  MIDI              |
| Places                         |
|   Current project  Packs       |
|   Template  Add folder...      |
| Filters                        |   chips, grouped, for the chosen category
|   Drums: Kick Snare Hihat ...  |
|   Character: ...               |
|--------------------------------|
| Results                        |   in the same column, under a border that
|   # bd            tr909  [o]   |   can be dragged. A tree where the
|   # RolandTR909  > 12 sounds   |   category has levels (banks, folders)
+--------------------------------+
```

Collections, Library, Places and Filters fold, like sections of Live. Live's second
column is not built: the results are in the same column.

**Categories.**

| Category | Holds | Source |
|---|---|---|
| All | Everything | - |
| Sounds | Synths, soundfonts, wavetables, ZZFX | The engine's sound list |
| Drums | Drum machines by bank, then the sounds of a bank | The engine's sound list, tag `drum-machines` |
| Samples | Local samples, default samples, cached packs | The engine's list, `samples/`, `.strdltn/cache/` |
| Instruments | VIBE FM firmwares | `firmware/` and the cache |
| Snippets | The files under `lib/`, by their `@category` | As today |
| Songs | The `.strudel` files of the workspace | As the Files view today |
| Functions | The Strudel functions with their documentation | `@strudel/reference`, which we already ship |
| MIDI | Outputs and inputs | The MIDI bridge, from phase 5 |

**Places.** Current project (the folders `samples/`, `lib/`, `firmware/` and the songs),
Packs (each cached remote pack, with its size), Template (the examples), and folders the
user adds (a setting `strdltn.browser.folders`).

**A row.** Icon of its kind, name, a dim second text (bank, tags), up to three color
squares, and on hover the buttons a row has today: play, insert, copy, open. A click
plays a sound (preview stays on by default, with the toggle of today). A double click or
Enter inserts at the cursor. The hover card of a snippet is drawn by us inside the
webview: title, details, tags, code.

**Keys.** Up and down move, right and left open and close, Enter inserts, Space plays, 1
to 7 set a color, 0 clears, Ctrl+F goes to the search field, Esc clears the search.

**Preview in tempo.** While a song plays, the preview of a sample starts on the next
cycle. Expected to be possible with the scheduler's `now()`; a later step of the phase.

**Hot-swap.** With the cursor inside `s("...")` or `.bank("...")`, a row gets a "replace"
button that swaps the name under the cursor. `src/shared/context.ts` already finds what
is around a position.

### Index and tags

Every item of the browser has an id and a record in an index. The index is JSON.

**Ids.** `sound:<name>`, `bank:<name>`, `sample:<path in the workspace>`,
`pack:<address>`, `firmware:<id>`, `snippet:<path>`, `song:<path>`, `fn:<name>`,
`midi-out:<device>`, `midi-in:<device>`.

**Three layers, merged in this order:**

| Layer | File | Written by | Holds |
|---|---|---|---|
| Built in | `media/index.json`, shipped in the `.vsix` | `pnpm index`, a script of ours | Every default sound, bank, soundfont, synth and function, with tags from rules |
| Project | `strdltn.index.json` in the workspace root, committed with the songs | The Browser | Colors and tags the user gave, per id. Names of the colors. Saved searches |
| Live | Memory only | The engine and the file watchers | What exists right now: loaded sounds, files, devices |

The live layer decides what is shown. The other two only add what is known about it. An
item of the built-in layer that the engine has not loaded yet is still listed (dim), so
the Browser is full before a song is open. That ends the known gap "the Sounds view
shows the list the last engine reported".

A snippet keeps its tags in its own header (`@tags`, `@category`), as today. The header
wins, and a tag added to a snippet in the Browser is written into the header, not into
the project file.

**Record.**

```json
{
  "sound:RolandTR909_bd": {
    "kind": "sound",
    "name": "RolandTR909_bd",
    "tags": ["Drums/Kick", "Maker/Roland", "Machine/TR-909", "Source/Default"],
    "colors": [1],
    "count": 4
  }
}
```

**Tag groups.** A tag is `Group/Tag` or `Group/Tag/Subtag`, as in Live.

| Group | Tags | How an item gets one |
|---|---|---|
| Type | Sound, Drum, Sample, Instrument, Snippet, Song, Function, MIDI | From the kind |
| Sounds | Bass, Lead, Pad, Keys, Piano, Strings, Brass, Woodwind, Guitar, Mallets, Voice, FX | Soundfonts: from the General MIDI family. Synths and samples: from the name |
| Drums | Kick, Snare, Clap, Hihat, Cymbal, Tom, Percussion, Loop | From the sound part of the name: `bd`, `sd`, `cp`, `hh`, `oh`, `cr`, `rd`, `lt`, `mt`, `ht`, `perc`... |
| Maker, Machine | Roland, TR-909... | From the bank name |
| Source | Default, Local, Pack, Firmware | From where it was loaded |
| Category | The nine snippet categories | From `@category` |
| Function | Pattern, Effect, Sample, Synth, Tonal, Time, Random... | From the source file of the function (`meta.filename`) and a table of ours. `@strudel/reference` 1.2.2 has 577 functions and no categories (read) |
| Creator | A name | From `@by` and `@credits` of a snippet, and from the pack |
| User | Anything | Typed by the user |

The rules are in `src/shared/tags.ts` with a test file, like the other rule files. They
are plain tables (name part -> tag). We do not listen to the samples as Live does;
see "Not in this plan".

**Colors.** Seven, numbered 1 to 7, in the order of Live: red, orange, yellow, green,
blue, purple, gray. Their names can be changed and are kept in the project file. An item
can have several. A click on a color dot in Collections shows every item with it.

**Search.** The text is split into terms and every term must match. A term matches the
name, the bank, the tags and, for snippets and functions, the description. `#kick`
matches only tags. Chips: any chip inside a group, and every group with a chosen chip
must match (expected to be Live's rule). Search and chips work together. The match is a
plain scan: the index is about 2300 records (1347 drum sounds, 151 samples, 125
soundfonts and 25 synths measured, plus 577 functions), which needs no search library.
"Save search" adds the search with its chips as a new row under Collections.

**Tag editor.** Right click on a row or on several rows: "Edit tags..." opens a small
form in the Browser with the groups as checkboxes and a field for a new tag.

### Mixer panel

A webview view in the bottom panel of VS Code, next to Terminal and Problems, with the
id `strdltn.mixer`. It can be dragged elsewhere like any view. It shows the song in
front.

**The Mixer is made of the song's sliders.** Every `slider()` that the stage shows today
becomes a fader in the Mixer instead, and the stage keeps only the visuals. The sliders
are grouped by the chain they act on, and each group is a channel: a vertical strip with
the name of the chain on top, as in the Session view of Live. Folded, a channel shows one
fader, its gain. A click on its name unfolds it, and the strip widens to show every
slider of that chain side by side, each with its label. A click again folds it.

```
 folded                 kick unfolded, bass unfolded
+--------+--------+    +--------+--------+-----------------+-----------------+--------+
| vocals | kick   |    | vocals | kick   | bass            | lowendbass      | riser  |
| [M][S] | [M][S] |    | [M][S] | [M][S] | [M][S]          | [M][S]          | [M][S] |
|   ||   |   ||   |    |   ||   |   ||   |   ||       ||   |   ||       ||   |        |
|   ||   |   ||   |    |   ||   |   ||   |   ||       ||   |   ||       ||   |  (no   |
|   ##   |   ##   |    |   ##   |   ##   |   ##       ||   |   ##       ##   | slider)|
|   ||   |   ||   |    |   ||   |   ||   |   ||       ##   |   ||       ||   |        |
|  gain  |  gain  |    |  gain  |  gain  |  gain    lpenv  |  gain    lpenv  |        |
|  0.50  |  0.61  |    |  0.50  |  0.61  |  1.00    1.00   |  0.45    2.00   |        |
| duck o-+--------+----+--------+--o-----+-----------------+-----------------+--------+
+--------+--------+    +--------+-----\--+-----------------+-----------------+--------+
                                        \___ orbit 2 ___/ \___ orbit 3 ___/ \_orbit 4_/
```

**Channels.** One per `$:` or `name:` line, in the order of the code, named as the line
names it: `$kick:` gives "kick", `lowendbass:` gives "lowendbass". An anonymous `$:` is
named by the rules of `src/shared/context.ts` that name a visual today. A chain with no
slider still gets a strip, so it can be muted, soloed and ducked, but it has no fader.
One more strip on the left, "global", holds the sliders that act on no chain (a slider
used in `setcps()`, or one not used anywhere). It is left out when it is empty.

**Which slider belongs to which chain.** A parser of the code (`src/shared/chains.ts`,
with tests) finds the range of every chain, every `slider(...)` call and every constant
a slider is assigned to. A slider belongs to a chain when its call is inside the range
of the chain, or when a constant it is assigned to is used inside that range.
`const KICK_VOL = slider(0.607, 0, 1)` at the top of the song and `.gain(KICK_VOL)`
inside `$kick:` puts it in "kick". A slider used by two chains shows in both, and the two
faders move together, because they are one slider. We parse with `acorn`, which
`@strudel/transpiler` already brings, so the Mixer can be drawn from the text before the
song plays.

**The label of a fader.** The name of the call the slider feeds, where it is used:
`.gain(KICK_VOL)` gives "gain", `.lpenv(BASS_ENERGY)` gives "lpenv", `.lpf(slider(...))`
gives "lpf". Under it, smaller, the name of the constant when there is one ("kick vol",
the label the stage shows today) and the value. A slider whose use is not a call gets
the label of today's rules. The tooltip says the rule, as the stage does now.

**The gain fader.** The fader a folded channel shows is the slider used in `.gain()`,
else in `.postgain()`, else in `.velocity()`. A chain with sliders but none of these
shows its first slider folded, with its label, so a folded strip never lies about what
it controls.

**What the song in the template gives.** From `template/demo.strudel`, read by hand, as
the test will check it:

| Channel | Folded fader | Unfolded faders | Ducked by |
|---|---|---|---|
| vocals | gain (`VOCALS_VOL`) | gain | - |
| kick | gain (`KICK_VOL`) | gain | - |
| snare | gain (`SNARE_VOL`) | gain | - |
| hh | gain (`HH_VOL`) | gain | - |
| hhr | gain (`HHR_VOL`) | gain | - |
| bass | gain (`BASS_VOL`) | gain, lpenv (`BASS_ENERGY`) | kick, orbit 2 |
| lowendbass | gain (`SUB_VOL`) | gain, lpenv (`SUB_ENERGY`) | kick, orbit 3 |
| riser | none | none | kick, orbit 4 |

**A fader does what a slider row of the stage does today** (see "Sliders" in
`doc/ARCHITECTURE.md`): the sound changes at once, and the number is written into the
code 150 ms after the last move. The message for that exists: the host sends the engine
`slider {index, value}`, which moves the slider "as a drag would". The Mixer sends the
host the slider by its position in the code, the host finds the index. When no engine
plays the song, a move only writes the code.

**Mute and solo.** Each strip has M and S. They write upstream's own syntax into the
code: `_kick:` mutes, `Skick:` solos (decision 5). A muted or soloed channel is drawn as
such from the text.

**Title and activity.** A click on the strip's title, beside the fold, moves the cursor
of the editor to that chain. A small light in the header blinks on each event of the
chain while it plays. The light needs the events to carry the id of their chain: in
`beforeEval` we wrap `Pattern.prototype.p` so that the pattern it keeps marks its events
with the id. Expected to work, spike D1. Without it, the Mixer works the same with no
light.

**The stage after this.** The dock of the stage keeps the visuals (`_scope`,
`_pianoroll`, `_punchcard`...) and loses its slider rows. The Strudel editor keeps
upstream's inline sliders in the code, so a slider shows twice while both are open:
inline in the code and as a fader. They are the same slider and move together.

**Messages added to the protocol.**

| Direction | Message | Meaning |
|---|---|---|
| host -> mixer | `model {chains, sliders, ducks}` | From the parser: channels, faders with their labels and values, duck cables. Sent on every change of the document, after the same pause the packs use |
| mixer -> host | `slider {position, value}` | A fader moved. The host passes it to the engine as `slider {index, value}`, or only edits the code |
| mixer -> host | `mute`, `solo`, `duck {from, to}`, `unduck {from, to}`, `reveal {chain}` | What the user did |
| engine -> host -> mixer | `activity {chains}` | About 20 times a second while playing, from D1 |

### Cables

Cables are of two kinds, and each kind has a color of its own, so the two can never be
taken for each other:

| Kind | From | To | Means in code | Color and line |
|---|---|---|---|---|
| Sidechain | The "duck" jack of the chain that ducks | Each chain it ducks | `.duck("n")` and `.orbit(n)` | Orange (`--vscode-charts-orange`), dashed, with the orbit number as its label |
| MIDI | The "midi" jack of a chain | The strip of a MIDI output device, right of the chains | `.midi("device")` | Purple (`--vscode-charts-purple`), solid, with the MIDI channel as its label when the chain sets `.midichan()` |

Everything else (which sliders belong together) is shown by the order and the grouping
of the strips, not by cables. The `--vscode-charts-*` colors follow the theme and stay
apart in dark, light and high contrast themes (expected, to check in the screenshots of
each). The line style differs too, so the kinds stay apart for a reader who does not see
the colors.

The MIDI strips come with phase 5. Each output device that the song names gets a narrow
strip with its name and a light that blinks on the notes sent. A drag from a chain's
"midi" jack onto a device strip adds `.midi("device")`, or replaces the name in the one
it has. Pulling the cable off removes the call. Before phase 5 there are no MIDI strips
and no "midi" jack.

**What a cable means in Strudel.** `.duck("2,3,4")` on `$kick:` pulls down the volume of
the orbits 2, 3 and 4 on each kick. A chain is ducked when it plays on one of those
orbits with `.orbit(n)`. So a cable goes from the "duck" jack of the kick strip to the
strip of every chain on a ducked orbit, and carries the number of the orbit as its
label. Two chains on the same orbit both get a cable, and both are ducked together,
because the orbit is one bus. A ducked orbit with no chain on it gets no cable; the
kick's strip lists it under its jack as "orbit 5 (empty)".

**Editing a sidechain by cable.** Each gesture is one edit of the document, so undo
takes it back.

| Gesture | Edit |
|---|---|
| Drag "duck" of one strip onto another strip that has `.orbit(n)` | Add `n` to the `.duck("...")` of the first chain, or add `.duck("n")` |
| The same onto a strip with no `.orbit()` | That chain plays on orbit 1, which is everyone's default, so ducking 1 would duck most of the song. The target gets the next free orbit, `.orbit(k)`, and `k` is added to the duck list. The cable says so in a tooltip, because `room` and `delay` are shared per orbit and the target leaves the reverb of orbit 1 |
| Pull a cable off its target and drop it on nothing | Remove `n` from the duck list, and `.duck()` when the list is empty. When other chains are on orbit `n`, all their cables go, and the dialog in the tooltip says which |
| Drop on a strip whose `.orbit()` or `.duck()` is not a literal (`.orbit(pick(...))`) | Refused: the cable turns red and goes back |
| The settings of the duck (`duckattack`, `duckdepth`) | Not cables. They are calls on the ducking chain, and a slider in them shows as a fader of that chain |

A cable is never stored. After the edit the model is built again from the text and the
cables are drawn from the model.

**How cables are drawn.** Ported from ableton-rackutils as `src/webview/cables.ts`,
plain TypeScript and SVG, no framework: the physics, constants, sleeping loop and
pointer handling listed under "The cables of ableton-rackutils". One fixed SVG layer over
the Mixer, `pointer-events: none`. A cable leaves the bottom of its strip and ends at the
bottom of the other one, so it hangs under the faders and does not cross them. The color
and the line come from its kind, as in the table above; the plug at the start has a
small ring in the color of the chain, to show where it comes from.
`prefers-reduced-motion` turns the spring off.

### Engine

Three things need more than a client view can give: sound that goes on when the editor
changes, preview without an open song, and MIDI. They are separate problems and the plan
solves them in order of cost.

**Phases 1 to 3 change nothing here.** The engine is the `StrudelMirror` of the Strudel
editor or of the stage, as today. The host relays.

**MIDI goes through the extension host on desktop (phase 5).** The road is the one of
gugelhupf, with the extension host in the place of Max:

```
webview                                  extension host
scheduler -> our .midi() output          worker thread with an exact clock
  note {device, bytes, at}  ---------->    waits until `at`, sends with @julusian/midi
  sent about 150 ms early
  cc(n), kb()  <----------------------   input {device, bytes, at}
```

- Our own `midi`, `midin`, `midikeys`, `midicmd`, `midimaps` and `defaultmidimap` are
  registered in the webview under the upstream names, so a song written for strudel.cc
  runs. They do what `@strudel/midi` does, with the device calls replaced by messages.
  `@strudel/midi` itself needs WebMIDI and cannot be used.
- A note leaves the webview when the scheduler triggers it, which is about 100 ms before
  it sounds (the scheduler's lookahead; `latencyMs` of `.midi()` adds to it). The
  message carries the time it is due. The host does not send it on arrival.
- The host runs a `worker_thread` that keeps a queue ordered by time and waits with
  `Atomics.wait` up to the last millisecond, then spins. Whether that is exact enough is
  spike S5, already listed in `doc/TODO.md`. The bar is 2 ms.
- The two sides have different clocks. The host measures the offset with a ping every
  few seconds and keeps the smallest round trip. Events are placed by the rule of
  gugelhupf: one anchor, later events by pattern time, a new anchor only on a tempo
  change or when far off.
- Input goes the other way with no waiting: the host posts each message at once. A knob
  reaches the pattern within one scheduler tick (expected: under 50 ms on desktop).
- In Codespaces this road does not exist: the host cannot see the user's devices.

**The browser page is the road for Codespaces, and for the maintainer's idea of the IDE
as a dumb client (phase 7).** The same engine bundle is served as a normal web page by a
small server in the extension host, and opened in the user's browser. A normal page may
use WebMIDI and Web Audio, and upstream `@strudel/midi` works there unchanged. VS Code
then holds no engine: editor, Browser and Mixer talk to the page over a WebSocket, as
the Max devices talk to their worker. In Codespaces the port is forwarded and the page
is opened by the user, so it runs in their browser, with their devices.

- The drawer rejected a local server for *samples* in Codespaces, because a `fetch` from
  a webview to a forwarded port carries no login. A page that the user opens on that
  port is logged in, and its own requests are same-origin. Expected to work, spike E3.
- Cost: a second window, a click in it to start sound, and visuals that are in that
  window and not in the editor. The Strudel editor in VS Code would show no highlighting
  unless the page sends the events back.
- This is an addition, not a replacement. A user who needs no MIDI in Codespaces never
  sees it.

**One engine for all songs and views (phase 6).** Today a switch between the Strudel
editor and the native editor stops the sound, a preview needs an open song, and two open
songs are two engines. The target: one engine webview that lives as long as the window,
and editors that are views of it.

- Where it lives: the Mixer panel. It is a view that stays once shown, and with
  `retainContextWhenHidden` it keeps running when another panel tab covers it. Whether
  its sound and its timers go on while hidden is spike E1. The scheduler would run in a
  dedicated worker if timers are slowed, as gugelhupf does.
- What the editor loses: `StrudelMirror` has editor, scheduler and drawing in one page.
  With the engine elsewhere, the editor must get the events from it to highlight notes
  and to draw `_pianoroll`, and audio data to draw `_scope`. Two ways: the editor runs a
  silent copy of the pattern on a shared clock (the repl's `sync` option with
  `NeoCyclist` exists for windows of one origin; webviews have different origins, so we
  would feed the clock by message), or the engine sends the events and the editor draws
  them with upstream's draw functions. Spike E2 decides.
- This phase is the one that can fail. It goes last among the engine work and is gated
  by its spikes. If they fail, the smaller step stays: keep the engine per song, and on
  a mode switch start the new webview at the same cycle (option 1 of "Sound across a
  mode switch" in `doc/TODO.md`).

### Devices

Live shows the device of the selected track at the bottom of the screen. We show the
instruments that make their own sound outside superdough: every VIBE FM firmware that is
running, and the SHRUB editor. Each one gets a panel. Every panel can be folded, shown
alone in the whole view, and taken out into a tab of its own, which VS Code can then
maximize or move to another window like any editor.

**Why one view and not one view per device.** VS Code knows the views of an extension
from `package.json`, so their number is fixed when the extension is installed. A song
can run any number of firmwares. So there is one webview view, "Devices"
(`strdltn.devices`), in the bottom panel next to the Mixer, and the panels are drawn
inside it. A tab (`WebviewPanel`) can be made at run time, which is what "take out" uses.

```
+ Devices ---------------------------------------------------------------+
| v obervave  orbit 2   [_] [max] [out]                                  |
|   +----------------------+  CUTOFF  RESO   ENV   ...  (parameters)     |
|   |  480 x 320 display   |   (o)    (o)    (o)                         |
|   +----------------------+  prog 12          [store]                   |
| > sloop     orbit 4   [_] [max] [out]          (folded: one line)      |
| v SHRUB     editor    [_] [max] [out]                                  |
|   +--------------------------------------------------------------+     |
|   |  shrub.audio/editor in a frame                               |     |
+------------------------------------------------------------------------+
```

**A firmware panel.** One per running copy. A copy is a firmware on an orbit, because
each orbit runs its own copy (see "Channels" under "Firmware" in `doc/ARCHITECTURE.md`).
The panel appears with the first note of that copy and stays while the song names it.

| Part | Shows | Does |
|---|---|---|
| Header | Firmware name, version, orbit, the channel color of the chain that plays it | A click selects the chain in the Mixer and its line in the code. Fold, maximize, take out |
| Display | The firmware's 480 by 320 screen from `vibe_wasm_draw`, about 30 frames a second (step 11 of "Firmware Hub" in `doc/TODO.md`) | Mouse and wheel become the firmware's encoder and button events, if the SDK has events for them (spike F2) |
| Parameters | Every parameter from `vibe_wasm_param_info`: name, range, unit, steps, as knobs | A turn sets the parameter at once. "Copy as code" types `.vp(id, value)` (step 4 of "Firmware Hub"). Decision 10 is whether a turn also writes the code |
| Program | The program the song sent with `.progNum()` | - |
| Store | What the firmware saved with `vibe_host_store` | Saved to `.strdltn/firmware-store/<id>/` (step 8 of "Firmware Hub") |

The firmware runs in an `AudioWorkletNode` of the engine, and the Devices view is
another webview. Parameters and events are small messages and go through the host like
the Mixer's. The display is not small: a frame of 480 by 320 is 300 KB at two bytes a
pixel (the format is not known yet, spike F1), so 30 frames a second would be about 9 MB
a second through the host, and twice that over the network in Codespaces. The plan: the
worklet sends a frame only when it changed and only for panels that are open and not
folded, the frame goes as changed rectangles, and the rate drops when the view is
hidden. Spike F1 measures the frame format and what the relay can carry. When the engine
moves into one webview (phase 6), the panels can live in that webview and the display
costs nothing to move.

**The SHRUB panel.** The mockup that exists today (a tab with `shrub.audio/editor/` in a
frame) becomes a panel of the Devices view, with the same fold, maximize and take-out
buttons. Taken out, it is the tab of the mockup. Its limits stay what the drawer entry "A
panel with the SHRUB editor" says: its sound is its own, not in our mix and not in time,
and it has no MIDI. Two things are still not measured: whether the site lets itself be
framed, and whether it makes sound inside a webview (spike F3). A frame that is folded is
hidden with CSS, not removed, so its unsaved patches stay. If Xfer ever builds SHRUB as a
VIBE FM firmware (decision 15 of `doc/TODO.md`), it becomes a firmware panel like the
others.

**Fold, maximize, take out.**

| Button | Does | How |
|---|---|---|
| Fold | The panel shrinks to its header | Inside the view. The state is kept per firmware id in the webview's state |
| Maximize | The panel fills the Devices view and the others fold. Again to go back. A second click maximizes the whole bottom panel | Inside the view, and VS Code's command `workbench.action.toggleMaximizedPanel` for the bottom panel (expected, not tested from an extension) |
| Take out | The panel leaves the view and opens as a tab. The tab has VS Code's own maximize and "Move into New Window". Closing the tab puts the panel back | A `WebviewPanel` per device, created at run time |

Devices and Mixer are two views of one container in the bottom panel. VS Code gives each
view of a container a fold of its own, so the whole Devices view can also be folded
under the Mixer, and either can be dragged to another place.

### MIDI in the Browser and the Mixer

- Browser, category MIDI: outputs and inputs, as the list in `doc/TODO.md` says. A click
  on an output types `.midi("name")`. A click on an input types
  `const cc = await midin("name")`.
- Mixer: a chain with `.midi()` gets a purple MIDI cable to the strip of its device, see
  "Cables". A drag between a chain and a device strip writes or changes the call.
- MIDI learn: right click on a fader, mute or solo, "Learn", move a knob. The binding is
  kept in `strdltn.index.json` under the name of the controller. The demo song was
  written for an "MPK mini 3" with eight knobs as a mixer, and it is the first test.
- MIDI clock out and transport: `midicmd` through the bridge. Clock in (the song follows
  an outside clock) is not in this plan.

## Phases

Each phase ends with a build the maintainer can use, on a feature branch, with a pull
request. Sizes are guesses in working sessions of an agent, not promises.

### Phase 0: spikes

Under `tmp/`, each deleted when its answer is written down.

| # | Question | How | Answer goes to |
|---|---|---|---|
| D1 | Can we mark every event with the id of its chain by wrapping `Pattern.prototype.p` in `beforeEval`? | In the webview, with `demo.strudel`: log the ids seen in the trigger | ARCHITECTURE "Mixer". Only the activity light depends on it |
| D3 | How late is a message from one webview to another through the host, on desktop and in a Codespace? | Timestamps on 1000 messages | ARCHITECTURE "Measured" |
| D4 | Can text be dragged from a webview view into the native editor and into the Strudel editor? | A draggable row with `text/plain` | ARCHITECTURE "Browser". If not: click and Enter only |
| S5 | Can the extension host send MIDI on time? | As in `doc/TODO.md` | TODO "MIDI" |
| S6 | Can a webview list the sound cards by name? | As in `doc/TODO.md` | TODO "Sound card" |
| E1 | Does a webview view with `retainContextWhenHidden` keep playing and keep its timers when hidden? | Play in a panel view, switch to Terminal, record the scheduler's tick times | ARCHITECTURE "Engine" |
| E2 | Can the editor highlight and draw from events sent by another webview, with upstream's functions? | Send the events of the engine to a second `StrudelMirror` that does not play | ARCHITECTURE "Engine" |
| F1 | What is the frame format of `vibe_wasm_draw`, and how many frames a second can go from a worklet through the host to another webview, on desktop and in a Codespace? | Read the SDK headers, then send OBERVAVE's screen at 30 frames a second, whole and as changed rectangles | ARCHITECTURE "Firmware" |
| F2 | Which events does a firmware take for its encoders, buttons and touch screen? | The SDK headers and `vibe_sdk.c` | ARCHITECTURE "Firmware" |
| F3 | Does `shrub.audio/editor/` load in a frame of a webview view, and does it make sound there? | The existing mockup, moved into a webview view | The drawer entry, or ARCHITECTURE |
| E3 | Does the engine page work in a normal browser from a forwarded port, with WebMIDI? | Serve `dist/` from the host, open in Chrome on desktop and from a Codespace | ARCHITECTURE "Engine" |

D3 and D4 come first. They gate phases 1 to 3. D1 can wait for phase 3. F1 to F3 gate phase 4. S5 gates phase 5.
E1 to E3 gate phases 6 and 7 and can wait.

### Phase 1: index and Browser

1. `src/shared/tags.ts` and its test: the rules that tag a sound from its name, bank and
   type.
2. `scripts/build-index.mjs` and `pnpm index`: writes `media/index.json` from the
   default sound maps, the soundfont list, the synth list and `@strudel/reference`. Run
   after a Strudel update, like `pnpm reference`.
3. `src/extension/index.ts`: merges the three layers, watches `lib/`, `samples/`,
   `firmware/` and the songs, reads and writes `strdltn.index.json`.
4. `src/shared/search.ts` and its test: terms, `#tag`, chips.
5. The Browser webview: `src/browser/` as a second small bundle (`dist/browser.js`),
   plain TypeScript and CSS with the `--vscode-*` variables, no framework. Banner,
   search, Collections, Library, Places, chips, results as a virtual list (2300 rows).
6. Row actions through the existing commands: preview, insert, copy, open, `.bank()`.
7. Colors, the tag editor, saved searches.
8. Remove the views Files, Sounds, Snippets and logo, and their providers. Keep their
   commands. The old views stay behind a setting for one release if the maintainer
   wants a way back (decision 2).
9. The integration test records the Browser: the counts per category, one search, one
   color, a screenshot.
10. Docs: README, `doc/ABOUT.md`, `doc/ARCHITECTURE.md` ("Browser", "Index and tags"),
    the template's `AGENTS.md` (the new file `strdltn.index.json`), the drawer entry for
    the tree views.

Size: 4 to 6 sessions.

### Phase 2: Mixer, read only

1. `src/shared/chains.ts` and its test: chains with their ranges and names, mute and
   solo, slider calls, the constants they are assigned to, where each one is used and
   in which call, `.orbit(n)` and `.duck("...")`. Cases from `template/demo.strudel`
   (the table under "Mixer panel") and the examples.
2. The Mixer webview: `src/mixer/` as a third bundle. Strips, fold and unfold, faders
   with labels and values, the "global" strip.
3. `src/webview/cables.ts`: the duck cables drawn from the model, with the spring.
4. The stage loses its slider rows.
5. The integration test records the model of `demo.strudel` and takes a screenshot with
   every strip folded and one with bass unfolded.

Size: 2 to 3 sessions.

### Phase 3: Mixer, editing

1. Faders move the sound and write the code, through the existing `slider` message.
2. Mute and solo as edits. Every edit is one function in `src/shared/chains.ts`, tested
   on text.
3. Cable drag: the drag cable, the hit test on strips, connect, refuse, pull off, and the
   new orbit for a target on orbit 1.
4. The activity light, after D1.
5. Hand test by the maintainer: the table is written when the build exists.

Size: 2 to 3 sessions.

### Phase 4: Devices

1. The Devices view (`strdltn.devices`) in the bottom panel, beside the Mixer: a fourth
   small bundle, `src/devices/`.
2. Messages: `devices {list}` from the engine when a firmware copy starts or ends,
   `params {device, list}`, `param {device, id, value}` both ways, `event {device, ...}`
   for encoders and buttons, `frame {device, ...}` for the display, by the answer of F1.
3. `VibeCore`: read the parameter list once (it already can), call `vibe_wasm_draw`
   only while a panel of that copy is open, and send the frame by the rule of F1.
4. The firmware panel: header, display, knobs, program, store, "Copy as code".
5. Fold, maximize and take out, with the state kept per firmware id.
6. The SHRUB panel: the mockup moved into the view, behind the same setting until F3
   says it works.
7. The integration test plays `template/examples/07-vibefm1-obervave.strudel`, records
   the device list and the parameter count, and takes a screenshot of the view.
8. Docs: ARCHITECTURE "Devices", the drawer entry of the SHRUB panel, README.

Size: 3 to 4 sessions.

### Phase 5: MIDI on desktop

1. `@julusian/midi` as a dependency, pinned. Its prebuilt binaries in the `.vsix`
   (2.2 MB measured). The build permission goes in `pnpm-workspace.yaml`.
2. `src/extension/midi.ts`: devices, a watcher for plugged and unplugged devices, the
   sending worker thread with the clock of S5, input forwarding.
3. `src/webview/midi.ts`: our `midi`, `midin`, `midikeys`, `midicmd`, `midimaps`,
   `defaultmidimap`, with the clock offset.
4. Browser category MIDI. The MIDI strips, the "midi" jack and the MIDI cables of the
   Mixer. MIDI learn on faders, mute and solo.
5. Notes off on stop, on a closed window and on an error, so no note hangs.
6. Tests: a unit test for the queue and the clock rule. The integration test sends to
   "Microsoft GS Wavetable Synth" when it exists and records the lateness. A hand test
   with the maintainer's controller and `demo.strudel` with its `midin` lines back in.
7. In Codespaces the MIDI category says that devices need the browser page (phase 7) or
   desktop.

Size: 4 to 5 sessions.

### Phase 6: one engine

Only after E1 and E2. Steps are written when the spikes have answered. The outline:
engine module without CodeMirror, engine in the Mixer panel, the editor and the stage as
views, preview without a song, sound across a mode switch, one transport for the window
(play, stop, tempo in the Mixer's header).

Size: unknown until the spikes. Expected to be the largest phase.

### Phase 7: the engine as a browser page

Only after E3 and only if the maintainer wants it (decision 7). A server in the host for
`dist/` and the workspace files, a WebSocket with the same messages as the webview
protocol, a command "strdltn: Open engine in the browser", a status bar item that says
where the engine is.

Size: 3 to 4 sessions after phase 6, more without it.

## Decisions for the maintainer

| # | Question | Our recommendation |
|---|---|---|
| 1 | Strips side by side as in the Session view of Live, each unfolding sideways into its faders, or channels as rows under each other with horizontal faders? | Side by side. Faders are vertical, and the duck cables hang under the strips |
| 2 | Remove the tree views in the same release as the Browser, or keep them behind a setting for one release? | Remove them. Two browsers are worse than one |
| 3 | A chain with no slider: offer a button on its strip that writes `.gain(slider(1, 0, 1))` into it? | Yes, as a small "+ gain" on the empty strip |
| 4 | The user's tags and colors: in the project (`strdltn.index.json`, committed, travels with the songs), global for the user (kept by VS Code, the same in every project), or both? | Project. A color on a default sound then follows the project, not the person. Global can be added later as a fourth layer |
| 5 | Mute and solo from the Mixer write `_name:` and `Sname:` into the code. OK, or runtime only? | Write. It is upstream's own syntax and the song stays the truth |
| 6 | A slider used by two chains shows in both strips. Or only in the first one, with a note in the second? | Both. It is the truth of the song, and they move together |
| 7 | Is the browser page (phase 7) wanted? It is the only road to MIDI in Codespaces, and it is the "IDE as a dumb client" design | Yes, after phase 5, and before phase 6 if MIDI in Codespaces matters more than sound across a mode switch |
| 8 | The Mixer in the bottom panel, where the stage also opens "below the code". Both fit as two views of the panel, or the stage moves beside the code | Mixer in the bottom panel, stage where `strdltn.stage.position` says, as now |
| 9 | Order: Browser first, or Mixer first? | Browser. It has no open technical question, and the index is needed by the MIDI category later |
| 10 | A knob turned in a firmware panel: change the sound only, or also write `.vp(id, value)` into the code like the Mixer's fader? | Change the sound only, with "Copy as code". A firmware has dozens of parameters, and writing each turn would bury the song in calls |
| 11 | A firmware panel taken out into a tab: keep the firmware in the engine and relay the display, or move that firmware's copy into the tab? | Relay until phase 6. Decide with the measures of F1 |

## Risks

- **The wrapper of `p` (D1)** depends on how the repl puts `p` back at each evaluation.
  A Strudel update can change that. Only the activity light depends on it.
- **Grouping by parser.** A slider used through a function or a variable that is not a
  constant (`let`, an object, an argument) is not traced to its chain and lands in
  "global". The test cases decide how far the parser goes.
- **Edits from the Mixer** change the user's code. Every edit goes through the parser's
  ranges, is one undo step, and is refused when the parser is not sure. A chain the
  parser cannot read is shown locked.
- **One webview for the whole side bar** loses what VS Code gives a tree for free:
  keyboard navigation, the filter of Ctrl+F, screen reader support. We build the first
  two. The third needs ARIA roles on the list and a test with a reader.
- **Phase 6** can end with "not possible without rebuilding upstream's editor". The plan
  keeps every other phase independent of it.
- **The display of a firmware through the relay (F1)** may be too heavy in Codespaces.
  Then the display is only drawn when the engine and the panel are in one webview, and the
  Devices view shows parameters only.
- **`@julusian/midi` is native code.** A VS Code update with a new Electron can break
  its binary. The integration test loads it, so a break is seen before a release.

## Not in this plan

- Clips and scenes. The demo song has a `SECTION` slider that works like a scene. A row
  of scene buttons that sets it is a small step later, not a clip launcher.
- Audio plugins on a channel (WAM, VST3). `doc/TODO.md` has the notes.
- Tagging samples by listening to them, and "similar sounds".
- Recording audio or MIDI.
- MIDI clock in.
- An arrangement view.

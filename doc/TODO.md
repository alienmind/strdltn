# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

## State

**`main` holds everything, version 0.5.0, released as `v0.5.0` on 2026-11-22**, the first
release the workflow built by itself (with the user manual as a PDF). The version started again
for this project; the tag 1.0.0 is the vstrudel release. The extension is [str]dltn
Live[code]: id `strdltn.strdltn`, commands and settings `strdltn.*`, cache `.strdltn/`, so it
installs beside vstrudel without a clash. Settings of vstrudel (`vstrudel.*`) do not carry over.

After 0.5.0, the branch `feat/showcase-video` (merged on 2026-11-22, no version change): a
showcase video of the demo, captured as one take (`video/scripts/showcase.mjs`, the method in
`doc/VIDEO.md`, "Showcase"); the demo with OBERVAVE doubling the pad in the FINAL DROP;
`template/sea_of_souls.strudel`, the demo without its explanatory comments and with Hydra only
in the drops, which the video plays; the user manual opening with the logo.

The plan to make this a DAW is in `doc/DAW-PLAN.md`, with the order of work the
maintainer set ("Order of work"). Merged so far: phase 1, the Browser (PR #4); phases 2
and 3, the Music panel, the Mixer and the side bar views (PR #5, 0.2.0, never tagged);
phase 4, Devices, with Firmware Hub, the SHRUB editor panel and the demo as an
arrangement (PR #6, 0.3.0); phase 5, MIDI on desktop through the extension host, Render
and Record of a song to `.wav` and `.mp3`, level meters with a Master strip on the Mixer,
and the demo's new mix (PR #9, 0.4.0, never tagged); a double click that opens snippets,
the Browser opening files only in the Strudel editor, Songs and Snippets back in the
Library, and `strdltn.midi.highPriority` (PR #10, 0.4.1).

Merged as PR #11, version 0.5.0: MIDI knobs on every slider, the Mixer's Master and MIDI mappings, a user manual.

**In flight: `feat/firmware-marketplace`**, from `main` on 2026-11-22, item 4 below. Built: Plugins >
FM-1 Synths in the Library (it replaced Instruments), with Installed and Available. Available is the
Playground's `index.json` (the maintainer, 2026-11-24, which answers the "what list" part of decision
13). Every row shows a picture of the firmware's screen; a double click on an Available one installs
it into `firmware/<id>/`; Insert types a `$:` line; the screen popup runs any of them without sound.
Waiting for the hand test below. Item 20 (melody and drum-rack line actions) waits for the
maintainer's go.

Next in line:

| # | What | State |
|---|---|---|
| 19 | Line actions: a gutter left of the line numbers, in the Strudel editor and the native editor, with a knob button on every line that has a slider. A click captures the next knob (MIDI learn). Lines without an action keep an empty gap, so everything stays aligned; more line actions will come. The same knob button on every fader of the Mixer. Replaces Ctrl+Alt+K as the main way to learn a knob, which the maintainer finds too convoluted. On `feat/knobs`: the maintainer wants this branch to close with every MIDI feature in it (2026-11-22). See "Line actions" | Built on `feat/knobs`, waiting for the hand test |
| 14 | The Strudel editor takes VS Code's keybindings: Ctrl+F searches, and so on, as the user has bound them. See "Keybindings in the Strudel editor" | Ctrl+F and Ctrl+G passed the hand test; Ctrl+H, Ctrl+D, Ctrl+Shift+L built, waiting for it. Keys CodeMirror takes first do not follow a rebinding yet |
| 15 | Every slider also a knob: a slider on screen that a physical knob moves too, by a CC the user maps with MIDI learn. The way to use physical knobs (the maintainer, 2026-11-22). See "Sliders on knobs" | Built on `feat/knobs`, waiting for the hand test |
| 16 | A welcome tab on first start: each small feature as a short silent clip, zoomed in, made with the promo's pipeline, with a "Try it" button per card | Planned, not built. Spikes W1 to W4 first. See "Welcome screen" in `doc/DAW-PLAN.md` |
| 17 | Render a pattern to MIDI: a `.mid` file of a song or a chain, and later into the piano roll | Planned, not built. See "MIDI clips: render and record" in `doc/DAW-PLAN.md` |
| 18 | Record MIDI into a pattern, as Ableton does: arm, play a keyboard while the song plays, the notes written into the song | Planned, not built. Same section |
| 20 | More line actions: a melody button on every line that plays notes, which opens a piano roll fitted to that line and records notes from a MIDI keyboard, quantized to the tempo; and a drum rack button on every drum line, a grid of pads as Live's Drum Rack, each pad mapped to a note, with a record button per rack (the maintainer, 2026-11-22). Goes with items 18 and 7 | To plan, not designed. See "Line actions: melody and drums" |
| 1 | MIDI: devices in the Browser, playing through them, mappings. Next: MIDI routing in the Mixer, cables from a chain to the MIDI instrument it plays; its button "Show MIDI Routing" is in the Mixer's utility column, disabled until then (the maintainer, 2026-11-22) | Playing and inputs built on `feat/midi`, waiting for the hand test; the Browser and the Mixer next. Phase 5 of `doc/DAW-PLAN.md`. See "MIDI" |
| 2 | A list of sound cards to send the sound to | Not possible in the webview (S6: the microphone is refused, so no names or ids). Windows' per-app output does it by hand. See "Sound card" |
| 4 | Firmware Marketplace: the hub's firmwares in the Library, Installed and Available, install, a snippet into the code, a picture of each one's screen, the screen in a popup (the maintainer, 2026-11-22 and 2026-11-24) | Built on `feat/firmware-marketplace`, waiting for the hand test. See "Firmware Marketplace" under "Firmware Hub" |
| 5 | Songs as files in the Browser: "Create new track", rename, remove, reveal | Planned, not built, three questions open. See "Songs as files" in `doc/DAW-PLAN.md` |
| 6a | Songs: an "Insert at the cursor" button beside "Open", which types the song's code without its header | Built on `feat/knobs`, waiting for the hand test |
| 6b | Stacks in the Mixer: a chain made of `stack(...)` as a strip that groups strips | Designed, not built. See "Stacks" in `doc/DAW-PLAN.md` |
| 6 | Functions: an "Insert an example" button beside "Insert at the cursor" | Built on `feat/knobs`, waiting for the hand test |
| 6c | Dock and float for the stage and later windows (the Mixer has it) | The stage waits for phase 6 (decision 22). See "Dock and float" in `doc/DAW-PLAN.md` |
| 6e | Track colors: every chain gets a color by itself (the next of the palette), kept as `// @color <name>` on the line above the chain, changeable in the Mixer, used later by the session view | Planned, not built. Decision 24 answered: colored by themselves. See "Track colors" in `doc/DAW-PLAN.md` |
| 6d | Tutorial in the Reference, from the workshop and learn pages of strudel.cc | Planned, not built. Decision 23 answered: the workshop first, then the learn pages. See "Reference and tutorial" in `doc/DAW-PLAN.md` |
| 7 | Advanced sequencing: devices that write patterns from taps (drum pad, step sequencer, piano roll, slicer) | Planned as the last phase. See "Phase 11" in `doc/DAW-PLAN.md` |
| 8 | A promo video: a walkthrough of the features, captured from a real VS Code window, with voice-over and our own song | First cut rendered (36 s), not watched yet. See `doc/VIDEO.md` |
| 10 | Sample packs from the file system: drag files or a folder from the OS onto the Browser, or "Add folder", and the pack is imported and sorted by what each sound is (kick, snare, hat, ...) into a folder structure of its own | Asked for on 2026-11-21, not designed. See "Importing sample packs" |
| 11 | A wave editor panel: open a sample from the Browser or the project and edit it in the IDE (select, cut, copy, paste, trim, fade, normalize), saved back as a file | Asked for on 2026-11-21, not designed. Built on AudioMass, not written by us: decision 16. See "Wave editor" |

## Next: test by hand

`feat/firmware-marketplace`. Test on **desktop VS Code, the Extension Development Host
launched with F5**, folder `template/`.

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Library: Plugins, then FM-1 Synths under it | Results shows Installed (OBERVAVE, which the demo caches) and Available (the hub's other firmwares). Each row has a picture of the firmware's screen under its name. The pictures fill in over a minute or two the first time: each firmware is downloaded once (about 1 MB each) and run for a moment |
| 2 | Click a row | The details pane shows the picture, the description, version, author, license and where it comes from, without a scroll bar for a short description |
| 3 | Double click an Available row | A notification says it is installed in `firmware/<id>`; the row moves to Installed |
| 4 | In a song, cursor on an empty line, double click the row from 3, then Play | `$: note("c2 eb2 g2 bb2").s("vibefm1:<id>")` goes in, with no `firmware(...)` line, and it plays beside the other lines |
| 5 | Insert OBERVAVE (a cached one) into a song that does not load it, then Play | A `firmware('https://...obervave.wasm')` line goes in at the top, the `$:` line at the cursor, both instruments play |
| 6 | The screen button of an Available row | The screen tab runs it; its button says Install; after Install it says "Insert at the cursor" |
| 7 | F1 to F6 and the scroll wheel in the screen tab | The firmware's pages and values change |
| 8 | The Reference view | No Plugins or FM-1 Synths rows there |

`pnpm test:vscode` on 2026-11-24 with this: the step "firmware" all true (44 firmwares in
the hub's list, 44 pictures made and none failed, AISLING installed by a double click and
played from `firmware/`, OBERVAVE inserted with its load line once). 37 of 38 files with no
problem; `examples/09-midi-out.strudel` did not start because the MIDI keyboard "MPK mini 3"
was not connected (the run of 2026-11-23, with it connected, passed). Pictures:
`tmp/shots/firmware-*.png`.

Expected still broken: the README still says Instruments, because `README.md` holds the
maintainer's own uncommitted changes. An Available firmware that the hub updates gets a new
picture and a new download (the `?v=` stamp is part of its address); the old copy stays in
global storage.

## Open leads

### Integration test

A lead, not a known bug. On 2026-11-21 the typing cases of the integration test
started to fail now and then, a different case each time, after about 8 runs in a row
with none: 3 of 4 runs had one failure.

| Run | Case | What was wrong | Editor same as document |
|---|---|---|---|
| 1 | `typingWhileAFaderMoves`, `\r\n` song | One extra line break at the end of the file | Yes |
| 2 | `typingWhileTheHostEdits`, `\n` song | The line the test writes from the host is missing | Yes |
| 3 | `undo`, `\n` song | Ctrl+Z after typing `zz` did nothing | Yes |
| 4 (2026-11-22, `feat/open-snippets`) | `undo`, `\r\n` song | The same: `zz` still there after Ctrl+Z | Yes |

Editor and document always agreed, so it is not the text sync. The test now records
whether VS Code took the host's edit; in run 3 it did. What changed just before:
the Mixer is revealed when a song starts (`Place.reveal`), Play/Stop and BPM (now in
Music Controls), and Results opens by itself. Next step: run `pnpm test:quick` a few times with
the reveal on play switched off, and a few with it on, to see whether the failures follow
it.

## Decisions waiting for the maintainer

| # | Question | What we did meanwhile |
|---|---|---|
| 1 | Snippet header: is the form `// @title`, `@category`, `@details`, `@tags`, `@by`, `@credits` right, and the nine categories? | Built it this way |
| 3 | A sound in a bank types its full name (`RolandTR909_bd`). Or should it type the short name (`bd`) and leave the bank to the button? | Full name |
| 5 | The cache for remote packs is `.strdltn/cache/` in the workspace, not `tmp/`. A dot folder that ignores itself for git seemed safer than a folder a project may already use. OK? | `.strdltn/cache/` |
| 6 | A pack is copied whole. `github:eddyflux/crate` is 367 files and 175 MB. Copy everything, or only the files a song has played? | Everything, up to 600 files |
| 7 | MIDI: build the desktop bridge now, knowing it cannot work in Codespaces? | Not built |
| 8 | Sound across a mode switch (see "Open design questions") | Sound stops |
| 9 | Default editor for `.strudel`: the Strudel editor, or the native one with the stage? | Answered 2026-11-22: the Strudel editor, never the native one (item 13) |
| 10 | Marketplace: publisher id and token (see "Publishing") | Waiting |
| 11 | Should the test screenshots keep the title "[Extension Development Host]"? The debug text in the corner is gone, the status bar item replaced it | Kept |
| 12 | `algorave` examples by other people without a license (Switch Angel, Art Haus, the cover versions): we wrote our own versions and name them in `@credits`. Copy the originals too? | Not copied |
| 13 | Firmware Hub: write to the hub's author (zven@thefirmwarehub.com)? The hub's rules for app makers (`thefirmwarehub.com/kb/#catalog`, read 2026-11-22) offer only `catalog.json`, which lists FM-1 `.fwsc` packages we cannot play, and say: download from the makers' releases, not from the hub. The Playground's `index.json`, which has the VIBE FM builds, is not mentioned. Tell the author that we read it once a day with a User-Agent and download the `.wasm` from the Playground? | The maintainer chose `index.json` on 2026-11-24, and FM-1 Synths reads it. Nothing sent yet |
| 14 | Firmware Hub: a hap's own effects (`room`, `delay`, `lpf`, `pan`, `gain`) do not reach a firmware, only the orbit's (`djf`, ducking). Fine, or worth the work below? | As it is |
| 15 | SHRUB: write to Xfer and ask for a VIBE FM build? See "SHRUB" | Answered on 2026-11-21: Steve Duda prefers to keep SHRUB closed and has no time for it. We keep to open firmwares. The SHRUB editor panel stays as an experiment behind its setting; the fm1-emu way stays open. Its editor cannot reach a real FM-1 from VS Code: a webview has no MIDI, and a frame of another site cannot be given ours. In a browser ("Open in browser") it can, if VS Code does not hold the FM-1's port: a Windows MIDI port opens in one program at a time |
| 16 | The wave editor (item 11) builds on AudioMass, which is not on npm and has no releases or tags. How does it come in? | Answered 2026-11-22: from the maintainer's fork `alienmind/AudioMass`, pinned to a tag we make there. The tag `strdltn-1` is made. See "Wave editor" |
| 17 | MIDI: may the extension raise the process priority of the extension host (`os.setPriority`)? It removed MIDI's long outliers in S5, but it raises every extension in that host | Answered 2026-11-22: behind a setting, off. Built on `feat/open-snippets` as `strdltn.midi.highPriority`, passed the hand test |


## MIDI

### What we measured

- A webview may not use WebMIDI ("Midi has been disabled in this document by
  permissions policy"). So Strudel's own `.midi()`, `midin()` and `midikeys()` cannot
  work inside [str]dltn Live[code], on desktop or in Codespaces.
- A native MIDI module, `@julusian/midi` 3.9.0 (MIT), loads in the runtime the extension
  host uses (Electron 42 as Node). It ships prebuilt binaries for Windows, macOS and
  Linux, about 2.2 MB together, so nothing is compiled on install.
- It lists outputs and inputs. On the maintainer's machine it showed the output
  "Microsoft GS Wavetable Synth" and the input "Vienna Instruments MIDI". The M-Vave was
  not in the list at that moment.
- Sending a message takes 0.05 ms (the first one 41 ms).
- A timer in that runtime on Windows fires late: 10 ms in the middle, 16 ms at the 95th
  percentile, 80 ms at worst. A note sent from a plain timer would be audibly off.

### What follows

- Desktop is possible: devices are listed and played from the extension host. The
  webview gets its own `.midi()` that posts each note with its time to the host.
- The host must not use a plain timer to send. Spike S5 (2026-11-21) passed the 2 ms bar:
  a worker thread that sleeps with `Atomics.wait` to 17 ms before a note and spins from
  there sent to the UMC404HD at most 0.45 ms late in 1000 notes, with high process
  priority. Numbers and traps in "MIDI" in `doc/ARCHITECTURE.md`. Open: whether we may
  raise the priority of the whole extension host (without it, outliers of 20 to 80 ms),
  and the CPU the spin costs on a dense song.
- Codespaces is not possible this way: the extension host is remote and cannot see a
  device on the user's machine. No design yet.

### What to build

Built on `feat/midi` (2026-11-21): the bridge, `.midi()`, `midin()`, `midikeys()`,
`midimaps()`, `defaultmidimap()`, notes off on stop, and `examples/09-midi-out.strudel`
(ARCHITECTURE "MIDI"). Measured end to end through loopMIDI; not tested by hand with a
device yet ("Next: test by hand"). Left, in this order:

1. Built 2026-11-22: the MIDI category of the Library, outputs and inputs, kept current.
   Left: in a Codespace it is empty, and should say that devices need desktop.
2. The MIDI strips, the "midi" jack and the MIDI cables of the Mixer; MIDI learn on
   faders, mute and solo ("MIDI in the Browser and the Mixer" in `doc/DAW-PLAN.md`).
3. In Codespaces the MIDI category says that devices need desktop. Today `midin()` there
   fails after 5 s with "MIDI works on desktop VS Code only"; not tried in a Codespace.
4. The demo with its `midin` lines back in, for the maintainer's MPK mini 3.
5. Mappings set up in the side bar, so a song needs no setup code: which CC of which
   controller drives what, and which control of a synth is which CC. Strudel already
   has the pieces to target (`midimaps`, `defaultmidimap`, `midin`), see below.

### How Strudel uses MIDI

From the upstream documentation (`learn/input-output`) and `@strudel/midi`. This is what
the bridge has to offer under the same names.

Sending:

| Call | Does |
|---|---|
| `.midi(output?, options?)` | Sends the pattern to a device, by name or number. Without a name, the first output |
| options | `isController` (no notes, only controls), `latencyMs` (default 34, to line MIDI up with the audio), `midichannel` (1 to 16), `midimap`, `midiport` |
| `.midiport(name)` | Picks the device, and can be a pattern that switches between devices |
| `.midichan(n)` | Picks the channel. Default 1 |
| `.ccn(n).ccv(v)` or `.control([n, v])` | Sends a control change. `ccv` is 0 to 1 |
| `.progNum(n)` | Program change, to switch presets |
| `.midibend(v)`, `.miditouch(v)` | Pitch bend (-1 to 1) and aftertouch (0 to 1) |
| `.sysex(id, data)` | System exclusive bytes |
| `midicmd("clock*48,<start stop>/2")` | MIDI clock and transport |

Mapping names to control changes, so a song says `lpf` and the synth gets CC 74:

| Call | Does |
|---|---|
| `defaultmidimap({ lpf: 74 })` | The map used when a pattern names none |
| `midimaps({ mysynth: { lpf: 74 } })` | Named maps, picked with `.midimap('mysynth')` |
| `midimaps({ mysynth: { lpf: { ccn: 74, min: 0, max: 20000, exp: 0.5 } } })` | The same with a range and a curve |
| `midimaps('github:user/repo')` | Loads `midimap.json` from a repository |

Receiving:

| Call | Does |
|---|---|
| `const cc = await midin('MPK mini 3')` | Opens a controller. `cc(1)` is a pattern with the last value of CC 1, 0 to 1. `cc(1, 2)` only listens on channel 2 |
| `cc(7).range(0, 5)` | The usual way to scale a knob |
| `const kb = await midikeys('KeyStep')` | Opens a keyboard. `kb()` is a pattern of the notes being played, with velocity |

The maintainer's `demo.strudel` was written for an "MPK mini 3" with eight knobs as a
mixer. Its `midin` lines are commented out and sliders stand in for the knobs. When the
bridge exists, that file is the first test.

## Importing sample packs

The maintainer already wrote this sorting once. The latest version is `patchbay`
(`../patchbay/scripts/fetch_samples.py`, last commit 2026-08-01, MIT, by AlienMind). Its
rules started from an older one in `../trackster` (`src/utils/autoTag.ts`, which tags
instead of copying, plus MFCC k-means in `src/utils/clustering.ts`; that repo has no
license). `../ableton-rackutils` has none. What patchbay does:

- Classifies by names only, in stages, the first answer wins: the enclosing folder says
  loop, break or sequence; then regexes over the file name (with `_-.()[]` as spaces);
  then the same regexes over the parent folders, nearest first.
- Categories in rule order: loop, ohat, hat, clap, rim, snare, kick, tom, misc (perc,
  cymbals, glitch), fx (vox, synth, risers, bass). `\d{2,3}\s?bpm` in a file name means a
  loop. The key in a name is not read.
- Copies to `<target>/<category>/<category>_NNN.<ext>`, numbering on from the highest
  number there, never renames or deletes, logs each copy to `manifests/reorg_log.csv`.
  A SHA-1 match skips a duplicate. Unknowns are reported and left. Loops are recognised
  but not placed. Only `.wav`, `.aif`, `.aiff`, `.flac`. Dry run unless `--apply`.

For us: the rules ported to TypeScript in `src/shared/`, with unit tests from patchbay's
cases (it is the maintainer's own MIT code, so the rules may come over as they are). The
target is a folder the Browser already reads as a pack, with a `strudel.json`, so the
sorted sounds play as `s("mypack_kick:3")` or a bank. Open: whether the numbered names
(`kick_001`) are right for Strudel, where index order already numbers them; whether
loops get a folder of their own; whether audio features (trackster's k-means, or
patchbay's planned "third stage") come in later for files with names that say nothing.
Dragging from the OS onto a webview view: not measured yet.

## Wave editor

A panel to edit a sample's wave in the IDE: select, cut, copy, paste, trim, fade,
normalize, and save back. The maintainer does not want to write a wave editor; the base
is AudioMass (audiomass.co, github.com/pkalogiros/AudioMass, MIT, "bundled third-party
libraries keep their own licenses", see its `THIRD_PARTY_NOTICES.md`). It is plain
JavaScript on wavesurfer.js with its regions plugin, and has a multitrack mode, effects,
LUFS, an EQ, markers, a recorder, a tempo estimator, a denoiser (RNNoise in wasm), and
WAV, MP3 and FLAC encoders. It is not on npm and has no releases or tags, so it comes from
the maintainer's fork `github.com/alienmind/AudioMass` at the tag `strdltn-1` (commit
`21f5ee1` of the branch `production`, made on 2026-11-22; decision 16). A newer AudioMass
gets a new tag `strdltn-<n>` on the fork. Expected, not tested: pnpm takes it as
`github:alienmind/AudioMass#strdltn-1`, so no submodule and no copy. Expected, not tested: it runs in a webview panel, with its file loading
and saving replaced by messages to the host. First spike: load AudioMass in a webview,
open a WAV from the workspace, save one back.

## Firmware Hub

The goal: play the firmwares of The Firmware Hub (thefirmwarehub.com) as instruments in
a song, in time with the rest of it. A Firmware view in the side bar lists them, and a
click puts one in the song. This is a cheaper and better route than "Plugins on Strudel
channels" and "Native VST3 on desktop" below: the firmwares are already wasm, built from
source, and they run in a browser.

How it works today, and what was measured, is under "Firmware" in `doc/ARCHITECTURE.md`.
In short: a `.wasm` in the workspace's `firmware/` folder plays as
`note("c2 eb2").s("vibefm1:<id>")`, through our own AudioWorklet host, with notes on their
exact frame and the song's tempo and play state passed on. Tested in Chrome, not yet in
VS Code.

### What we know about the hub

Read from the hub's pages on 2026-11-20. Not tested.

- The hub builds each FM-1 firmware from its own source into a VIBE FM firmware: one
  `.wasm` and a `firmware.json`, packed in a `.zip` (for example
  `thefirmwarehub.com/fw/vibe/boom-native-vibe.zip`). Each zip carries its license and
  source.
- Licenses: most firmwares are GPL-3.0, some MPL-2.0, M-VAVE's own V15 is Apache-2.0. The
  SDK is Apache-2.0. The VIBE FM VST and the browser emulator are closed, all rights
  reserved: we may not copy, embed or host them. [str]dltn Live[code] is AGPL-3.0.
- The Playground (`play.thefirmwarehub.com/?fw=<id>`) reads its list from
  `firmware/index.json` on that host. We could not fetch it from our sandbox, so its
  shape and its CORS headers are unknown. The hub documents no public catalog API.

### Steps left

| # | Step | Done when |
|---|---|---|
| 1 | Catalog: done 2026-11-22, see "The hub's catalogs" in `doc/ARCHITECTURE.md`. What we may use waits for decision 13 | |
| 2 | The hub's catalog in the host: fetched and kept for a day, works offline from the last copy. A firmware picked from it goes through `firmware(url)` and the cache that exists, with a SHA-256 check when the catalog has one | `pnpm test:unit` covers the unpack and the cache paths |
| 3 | Check the transport with a firmware that has its own sequencer (SLOOP) | It follows play, stop and `setcps` |
| 4 | `.vp()` for parameters by their id, through `VIBE_EV_PARAM`. `VibeCore` already reads the list and has the event | A slider moves a firmware parameter |
| 5 | Replaced by "Firmware Marketplace" below. Was: the Firmware view: groups "In this project" and the hub's list by device; name, version, author, license; a click types `s("vibefm1:<id>")` and starts the download; buttons for the hub page, the cheat sheet, the parameters and a test note; a filter box; "Add firmware..." for a `.zip` or `.wasm` from disk | The hand test of the view passes |
| 7 | `.midi("vibefm1:...")`, once the webview's own `.midi()` from "MIDI" exists: names that start with `vibefm1:` go to the firmware, CCs and `midimaps` work too | Code written for an FM-1 over MIDI plays the firmware |
| 8 | Store: `vibe_host_store` writes go to `.strdltn/firmware-store/<id>/` through the host, and come back on load | Save a sound in a firmware, reload, it is there |
| 9 | A snippet in `lib/` for a firmware part | |
| 10 | README and `doc/ABOUT.md`, once the view exists | |
| 11 | Later: the 480 x 320 display in the stage, from `vibe_wasm_draw` at 30 fps | |

### Firmware Marketplace

The plan for the next branch, asked by the maintainer on 2026-11-22: a place to find the
hub's firmwares, download them, have them by name and add them to the code. It takes the
place of step 5 above (the Firmware view) and grows steps 2 and 9.

Built (2026-11-24): Plugins > FM-1 Synths in the Library, with two groups. **Installed** is
the firmwares in `firmware/` folders of the project and in the cache. **Available** is the
Playground's `index.json` (the maintainer chose it on 2026-11-24, as the hub's own
catalog.json has no VIBE FM builds), read at most once a day. Each row shows a picture of the
firmware's screen. A double click on Available installs it into `firmware/<id>/` with a
`firmware.json`; Insert types `$: note("c2 eb2 g2 bb2").s("vibefm1:<id>")`, and the song's
`firmware('<url>')` line for a cached one. How it works: ARCHITECTURE, "FM-1 Synths".

Left:

- No SHA-256 check: `index.json` has none.
- Not decided: whether the snippet should carry `.progNum()`. We left it out, because a
  program number means something else in each firmware and a program change reloads a sound.
- An Available firmware's copy in global storage is never deleted, also after an update of
  the hub. A "clear" command, as for the sample packs, would do it.
- More kinds of plugins under Plugins (the maintainer, 2026-11-24): none designed yet.

Native VIBE firmwares (6 on 2026-11-22, `thefirmwarehub.com/fw/natives.json`) publish
their `.wasm`, a `.zip`, sometimes `SHA256SUMS` and a screenshot on their own GitHub
releases. That would follow the hub's rule "download from the makers' releases", but covers
only those 6, not the 35 converted ones, which exist only on the Playground.

### Effects on a firmware

A hap's effects need the sound to pass through the hap's own chain. A firmware is one
stream, so today it skips that chain. One way to try: per hap, return a gain node fed
from the firmware's output and gated by the hap's duration, the way superdough's own
`bus` sound works. Then `room`, `lpf`, `pan` apply. The cost: two overlapping haps on
the same firmware pass its whole output twice, so a chord is three times as loud. Maybe
right for monophonic lines only. Decision 14.

### Risks and open questions

- Firmwares built with two flows (`VIBE_PARALLEL_AUDIO`) or worker jobs (`VIBE_JOBS`,
  shared memory, `--enable-multi-thread`) may expect a host that calls draw and jobs on
  other threads. OBERVAVE plays without either. To check with a firmware that uses jobs.
- A firmware that traps stops for good and logs "firmware ... stopped". It starts again
  only with a reload of the webview.
- Some firmwares make sound on their own (a sequencer that plays from start). A stopped
  song sends "play off", but a firmware may ignore it.
- A firmware is GPL-3.0: we download it at run time and never ship it inside the `.vsix`.
  The examples in `template/` load it from GitHub, they do not contain it.
- Named patches, `vibefm1:shrub:lead` was asked for. Strudel reads a second colon as gain
  (`bd:3:0.5`, checked: `vibefm1:shrub:lead_saw` gives `gain: "lead_saw"`). `.progNum()`
  works today. A name needs each firmware's list of program names, which the wasm does
  not give a host. A firmware could put it in `firmware.json`; ask on the SDK issues.

### SHRUB

SHRUB is Xfer's stripped-down Serum for the FM-1: firmware for the device, an editor in
the browser (`shrub.audio/editor/`) and a VST3. It is closed ("All rights reserved"). It
cannot play in `vibefm1`: its `SHRUB.fwsc` is native code for the FM-1, see the drawer.
The ways it could reach a song, best first:

1. Xfer builds SHRUB as a VIBE FM firmware with the SDK. Then it is one more `vibefm1`
   firmware, with patches through `.progNum()`. Only Xfer can do it: ask
   steve@xferrecords.com (decision 15).
2. A real FM-1 with SHRUB installed, played through the MIDI bridge of "MIDI" above
   (desktop only). Patches by program change, if SHRUB takes them.
3. A panel with the editor in a webview, as asked. Possible only if the site allows
   framing. It would be a second, separate synth: its own audio, not in our mix and not in
   time, and no MIDI (a webview, and a frame inside it, may not use WebMIDI). It would be a
   browser tab inside VS Code, good for editing patches for a real FM-1 and nothing else.
   The maintainer wants it as a panel of the Devices view of `doc/DAW-PLAN.md`, so it is
   in that plan (phase 4, spike F3) with these limits. A mockup exists, off by default: the setting
   `strdltn.experimental.shrubEditor` and the command "strdltn: Open SHRUB editor
   (experimental)". Spike F3 answered: the site loads in a webview view and plays after a
   click inside its frame.
4. An emulator of the FM-1's chip that plays the `.fwsc` as it is. One exists:
   fm1-emu (`github.com/joakimeriksson/fm1-emu`, MIT, Rust built to wasm, with a JIT that
   turns the firmware's hot code into wasm). It plays 200 FM-1 firmwares and M-VAVE's stock
   firmware. Measured on 2026-11-21 with fm1-emu's own `fm1_web.wasm` (its GitHub Pages
   deploy of that day) and its headless `web/bench.mjs` in Node 24 on the maintainer's
   Windows PC: SHRUB V1.11 (`SHRUB-V1.11.fwsc`, from the maintainer) boots and its default
   chord sounds, but it runs at 0.76x real time at 240 MHz, 0.84x at 160 and 0.88x at 120,
   with most 128-frame blocks over their 2.9 ms. Felucca 1.8.2 in the same setup runs at
   2.7x. So SHRUB in wasm would drop out on this PC; in Chrome it is expected to be about
   the same, not measured. How late its sound is and Xfer's terms for running it in an
   emulator are not known. Spike F4 in `doc/DAW-PLAN.md`.

### Coverage of the hub's firmwares

Asked by the maintainer on 2026-11-21, for later: for every firmware of the hub, know how it
can play here, and test it. Started, then put aside for fm1-emu. What we know, read on
2026-11-21:

- `thefirmwarehub.com/catalog.json`: 281 FM-1 firmwares, each with `source` (all on GitHub),
  `lic` (233 GPL-3.0, 36 MPL-2.0, 6 MIT), the `.fwsc` package (`pkg`, `sha256`) and the
  author's own emulator page (`play`). Also SMK-37 firmwares and M-VAVE's stock package.
- `play.thefirmwarehub.com/firmware/index.json`: the 43 VIBE FM builds the Playground plays.
  35 of them are hub firmwares; 8 exist only for VIBE FM (VALVE, BOOM, HALO, PLAYER, VOX,
  DOOM, Performance Garden, KRACHT). `thefirmwarehub.com/fw/natives.json` lists the native
  ones with their repos. `index.json` sends no CORS header, `natives.json` does since
  2026-11-22 (see "The hub's catalogs" in ARCHITECTURE).
- A VIBE FM build is either converted (the hub's `thefirmwarehub.com/convert` compiles the
  unchanged source against an imitated FM-1, 8 ms buffer) or native (the author ports to the
  SDK, 4 ms). Both need source. See the SDK's `FROM-FM1.md`.
- A scan of the 281 repos through the GitHub API: 260 in C, 5 Rust, 31 forks, none
  archived; 42 have VIBE FM files, 58 a `.wasm` in the tree, 6 no license file.

The plan when it comes back: a script that joins the two catalogs and, per firmware, says
which way plays it (VIBE FM build, convertible from source, fm1-emu only), and a test that
loads each VIBE FM build in `VibeCore` in Node, plays a note and checks for sound and no
trap. Coverage of the wasm builds cannot be ensured by us: it depends on the authors and
the hub's converter. Only an emulator of the chip covers every `.fwsc`.

### Two ways to play a firmware

The maintainer decided on 2026-11-21: `vibefm1` stays. A firmware with a VIBE FM build (wasm
compiled from its source) plays there: light, and on time. An emulator like fm1-emu would be a
second way, only for firmwares that exist only as a `.fwsc` (SHRUB, M-VAVE's own), because
emulating the chip costs CPU and may add latency. Its worklet runs up to 1024 frames ahead of
the audio (`AHEAD_FRAMES` in its `web/worklet.js`), about 21 ms at 48 kHz, and its plugin
reports a delay to the DAW for that reason; expected from the code, not measured here.


## Sound card

Spike S6 ran on 2026-11-22 (ARCHITECTURE "Measured"): VS Code refuses the microphone to a
webview, so the page sees one output without a name or an id, and `setSinkId` has nothing
to switch to. The editor's page cannot pick its own sound card. What is left:

- Windows' per-app output (Settings, System, Sound, Volume mixer): moves VS Code's sound
  alone, not all of Windows. Works today, by hand.
- The browser page of phase 7 (`doc/DAW-PLAN.md`): a real browser tab may ask for the
  microphone and then pick an output. Not tried.
- A Chrome device id cannot be made in the extension host: Chrome salts it per origin.

The maintainer wants it now (2026-11-22): the M-VAVE FM-1 is a USB sound card too, and
playing SHRUB on it by MIDI next to Strudel's sound on the computer's card splits the
mix in two. Until this is built, Windows can send VS Code alone to the FM-1: Settings,
System, Sound, Volume mixer, the output device of Visual Studio Code.

Seen by the maintainer the same day: with SHRUB on it, the FM-1 is not listed as a sound
card; with the stock firmware it is, and works. So SHRUB's firmware seems to leave out the
USB audio. For later: a spike with another firmware on the FM-1 (stock, or one of the
hub's), and asking Xfer again (decision 15) whether SHRUB can keep the FM-1's USB audio.

## Sliders on knobs

The maintainer asked (2026-11-22) that every slider work with MIDI too: a slider on screen
that a knob of a controller also moves, by a CC the user maps by clicking the slider's
number. The point is to play with physical knobs. In their words, an overlay of
`slider()` that we put in the code as a snippet and that takes both the CC and the
slider, if possible. Not designed, not tried. What upstream allows (read in
`@strudel/transpiler` and `@strudel/codemirror` 1.3.0):

- Only a call named exactly `slider` becomes the widget. The transpiler rewrites it to
  `sliderWithID(id, value, min, max)`, the id being the offset of its first argument;
  the widget reads value, min, max and step (the 4th argument). More arguments are
  ignored.
- The live value is `sliderValues[id]`, which a `cm-slider` message to the window
  sets, as a drag does. So a CC can move a slider without any change upstream.

The way the maintainer chose (2026-11-22): the song defines the function itself, from a
snippet we insert at the top the first time a knob is used, so the song stays standard
Strudel and runs on strudel.cc too:

```
const knobs = await midin('MPK mini 3')
register('knob', (ccn, pat) => ...)   // the slider or CC ccn, whichever moved last
$bass: note("c2*8").lpf(slider(800, 200, 4000).knob(74))
```

- The `slider(...)` call stays where it is used: only a call written `slider` gets the
  widget, and its id is the offset of its first argument, so a `knob()` that called
  `slider()` inside would give every knob the same one. Hence a method on the slider,
  made with `register` (as the demo's `acid`).
- On strudel.cc the knob changes the sound; the widget and the number do not follow.
- In [str]dltn more follows: our `sliderWithID` marks the pattern with its id, a CC
  posts `cm-slider` for that id (the widget moves) and writes the number in the code as
  the Mixer's fader does. A click on the number starts MIDI learn: the next CC that moves
  is written into `.knob(...)`.

Answered by the maintainer on 2026-11-22:

- Pickup, not last-moved-wins: a knob takes over only once it passes the slider's value,
  so touching a knob that sits elsewhere does not make the sound jump.
- No device name in the snippet: it listens to every MIDI input, so the song runs on a
  machine with another controller, and plays without knobs on one with none. Our
  `midin()` takes the first input when no name is given and throws when there is no
  input at all (`openInput()` in `src/webview/midi.ts`), so the snippet cannot be a plain
  `midin()`. Upstream's `midin()` without a name: not read yet.
- A knob writes the number in the code as the Mixer's fader does, at most every 150 ms.
- The snippet goes in once, at the top, the first time a knob is used.

Built on `feat/knobs`, waiting for the hand test (ARCHITECTURE "Sliders on knobs"). One
change from the design above: on strudel.cc the knob does nothing, it does not change
the sound. The snippet cannot use `midin()` (see above), and a knob there would not know
the slider's range.

## Line actions

Asked by the maintainer on 2026-11-22, high priority after `feat/knobs`. A column of
buttons left of the line numbers, one per line that has an action, an empty gap on the
others so everything stays aligned. The first action is a knob button on every line with
a `slider(...)`: a click captures the next knob, as Ctrl+Alt+K does now. More actions
will come in the same column. It must work in both the Strudel editor and the native
editor. Lines are not contiguous on screen: inline scopes and other widgets sit between
them, and the button belongs beside its line number, not beside the widget.

- Strudel editor: a CodeMirror `gutter()` of our own, added with `Prec.highest` so it
  comes before upstream's line numbers, with a `lineMarker` per line that holds a slider
  and `domEventHandlers` for the click. CodeMirror lays a gutter out per line block, so a
  block widget between two lines leaves a gap in the gutter, as the picture of the
  maintainer wants. Expected, not tried.
- Native editor: VS Code's glyph margin is left of the line numbers, and a decoration
  with `gutterIconPath` draws an icon there. The API gives no click on it. Spike first:
  does a click in the glyph margin move the cursor or the selection
  (`onDidChangeTextEditorSelection` with `kind == Mouse`), so the click can be told from
  it? Fallbacks, in order: the line number context menu (`editor/lineNumber/context`, a
  right click), then a CodeLens above the line. Neither is a button in the gutter.
- The icon: a small knob drawn by us, in the theme's colors. A knob already mapped shows
  its CC.
- The Mixer too (the maintainer, 2026-11-22): the same knob button on every fader of every
  strip. A click captures the next knob for the slider behind that fader. The fader knows
  where its slider's number starts (`MixerSlider.from`), so the host asks the page for
  MIDI learn at that place, and `knobEdits` puts `.knob(cc)` on the slider call itself,
  wherever it is written: inline in the chain, or in `const KICK_VOL = slider(...)` when the
  chain uses a constant. A fader already mapped shows its CC. Must work with the song in
  the native editor too, so learn has to work on the stage, not only in the Strudel
  editor.
- Same rules as now: `sliderAt` for the slider of the line (the first one when a line has
  two; open: a button per slider then?), `knobEdits` for the edit.

## Line actions: melody and drums

Asked by the maintainer on 2026-11-22, to plan, not designed. More icons in the column of
line actions (see "Line actions"), beside the knob button, on the lines they fit.

- **Melody.** A line that plays notes (`note(...)`, `n(...)` with a `.scale(...)`, and
  the like) gets a melody button. It opens a piano roll fitted to that line: its range,
  its scale, its length in cycles. It listens to a MIDI keyboard and writes the notes it
  hears into the line, quantized to the song's tempo, in the form the line already uses.
  To discuss, and the maintainer wants options: notes written absolute (`c3 e3 g3`) or
  relative to the scale of the line (`0 2 4` under `.scale("C:minor")`); what happens to
  the notes already there (replace, overdub, a new variation); the quantize grid (a
  sixteenth by default, or the line's own subdivision); a note held across a step.
- **Drums.** A line that plays a drum kit (`s("bd sd hh")`, a `.bank(...)`) gets a drum
  rack button. It opens a grid of pads as Live's Drum Rack (the maintainer's picture: four
  by four, each pad named by its note, C1 to D#2, the sample's name on a pad that has one,
  M and S and a play button on each). Each pad is mapped to a note of a MIDI controller,
  and the mapping can be changed. Each rack has a record button: arm it, play the pads while
  the song plays, and the hits are written into the line, quantized.
- Goes with item 18 (record MIDI into a pattern) and phase 11 of `doc/DAW-PLAN.md`
  (devices that write patterns from taps: drum pad, step sequencer, piano roll). Those are
  the same need, reached from the line of code instead of from a device.
- Open: how a line is recognized as a melody or a drum line (the parser of
  `src/shared/chains.ts` reads calls already); a line with both; lines that build their
  notes from functions (`irand`, `.rib(...)`), which a piano roll cannot write back into.

## Keybindings in the Strudel editor

The maintainer asked (2026-11-22) that the Strudel editor answer VS Code's keys as the
user has bound them: Ctrl+F opens the search, and the same for the other editing
actions. A user can change the keys, so the mapping must follow the actions, not fixed
keys. Not designed, not measured. What we know and what we expect:

- VS Code has no API that tells an extension which keys a command has. The user's
  `keybindings.json` can be read from the profile folder, but it holds only the changes,
  not the defaults, and profiles, Settings Sync and remote hosts move it. Expected
  fragile; not tried.
- Expected, not measured here: a key a webview does not handle goes on to the workbench,
  which runs its own keybinding for it (that is how Ctrl+P works inside a webview).
  CodeMirror's keymap takes Ctrl+F first today.
- The way that follows the actions: our own commands (`strdltn.editor.find`,
  `.replace`, `.gotoLine`, `.selectNextOccurrence`, `.toggleComment`, ...) with the same
  default keys as VS Code's, under `when: activeCustomEditorId == strdltn.editor`. The
  webview lets those keys go through (they leave CodeMirror's keymap), VS Code runs our
  command, and the command tells the webview which CodeMirror action to run. A user
  rebinds them in Keyboard Shortcuts like any command. What this does not do: follow a
  rebinding of VS Code's own `actions.find` by itself.
- Read in `@strudel/codemirror` 1.3.0: upstream binds no Ctrl+F and no Ctrl+G. Its
  `searchKeymap` is commented out, and `search()` too, so nothing is to be removed.
- The spike, built on `feat/knobs` as the first piece of the real thing: the commands
  `strdltn.editor.find` (Ctrl+F) and `strdltn.editor.gotoLine` (Ctrl+G) under
  `activeCustomEditorId == strdltn.editor`. The webview runs `openSearchPanel` and
  `gotoLine` of `@codemirror/search` 6.7.2 (the copy upstream already uses, now a pinned
  dependency of ours). The host writes `[keys] find: the key reached VS Code` to the
  Output strdltn, so the hand test shows which way the key went. Passed the hand test
  on 2026-11-22 (ARCHITECTURE "VS Code's keys in the Strudel editor").
- Left: the list of actions to map. Keys CodeMirror's `defaultKeymap` already takes with
  VS Code's own default (Alt+Up moves a line, Ctrl+/ comments, Ctrl+Shift+K deletes a
  line, Ctrl+[ and Ctrl+] indent, Ctrl+Alt+Up adds a cursor) work today but do not follow
  a rebinding: CodeMirror takes the key first. Not tried: whether a key CodeMirror handled
  still reaches VS Code. Ctrl+H (replace), Ctrl+D (select the next match) and
  Ctrl+Shift+L (select every match) are built the same way as Ctrl+F, waiting for the
  hand test.

## Open design questions

**Sound across a mode switch.** Each webview has its own engine, so a switch stops the
sound. Upstream `StrudelMirror` keeps editor, scheduler and drawing in one page, which
makes a separate engine webview costly: highlighting and scopes need the haps and the
analyser data where the editor is. Options to try:
1. Accept the gap and restart playback in the new webview at the same cycle position.
2. One long-lived panel that holds the engine and is moved or shown differently, instead
   of two webview kinds.
3. A separate hidden engine webview, with the editor webview running a silent copy of
   the pattern for visuals.

A new webview also needs a new click before it may play. Option 1 would show the
overlay on every switch. That counts against it.

**How `lib/` is reused.** Today a snippet is pasted. Strudel has no module system for
local files. A second way to reuse code would be a prelude that evaluates the
`function` snippets before the song, so that their functions are global.

**Where the template lives.** It is the folder `template/` in this repo for now, so F5
and the test have something to open. It should become its own GitHub template repo
before M5. `template/.devcontainer/` is already written for that.

## Publishing

Decided: music projects get the extension from the VS Code Marketplace. The pipeline
already has the publish step. It does nothing until the repository has a `VSCE_PAT`
secret. What is left, in order:

1. The maintainer creates a publisher on the Marketplace and a token for it. Only the
   maintainer can do this.
2. Set `publisher` in `package.json` to that publisher id. This changes the extension
   id, which is `<publisher>.strdltn`. The id is also written in `src/test/m0.ts`.
3. Add the token to the GitHub repository as the secret `VSCE_PAT`.
4. Tag a release. The pipeline publishes it.
5. Change the three devcontainer files to install by id
   (`customizations.vscode.extensions`) and drop the `.vsix` download.

Until then the devcontainers install the `.vsix` from a GitHub release. Open VSX is not
planned yet.

## Open questions

- Does a real key press in the native editor count as a click for the stage? A command
  sent by the test does not.
- Does the scheduler keep exact time in a hidden tab? The test only saw that it kept
  running.
- Does a second install of the same version leave the old side bar title and icon in a
  running window, and does a version of its own cure it? Seen once, not confirmed.
- Does the pack cache work in Codespaces, where the workspace is remote?

## Known gaps

- A firmware that changes source restarts, with a short silence. That happens when a
  song loads a firmware by address and the same id is added to or removed from the
  `firmware/` folder while it plays. Seen by the maintainer. The two files can be the
  same bytes, so the running firmware could be kept when they are.

- Undo in the Strudel editor is CodeMirror's own history. It should go through VS Code
  so there is one history across both modes. Measured with real keys: typing `zz` and
  Ctrl+Z takes both back, as expected.
- Cursor and scroll position are not carried across a mode switch.
- Notes that are playing are not highlighted in the native editor.
- A sample that was deleted stays in the Browser until the editor is reloaded.
- Before a `.strudel` file is open, the Browser shows the sound list the last engine
  reported. It can name a sample that was deleted since, and preview needs an open
  file.
- An error in the code shows no squiggle in the Strudel editor, only in the Problems
  view and in the status bar.
- The place of an error is found by rule from its message. For a name that is written
  more than once it can be the wrong place. An error no rule places is on line 1.
- A sound that is not found while the pattern plays is not a problem of the file. It
  only goes to Output > `strdltn`.
- The theme of the Strudel editor does not follow the VS Code theme.
- The list of themes in `package.json` is a copy of upstream's. Nothing checks it when
  `@strudel/codemirror` is updated.
- A sound with more than 64 variations only shows the first 64.
- A snippet is a whole file. Several snippets in one file are not possible.
- Inline completion of Copilot does not read the instruction files. Only Chat and agents
  do.
- The Songs of the Browser have no button to play a song and none to create one.
- The Browser is a webview: a screen reader gets no list roles from it yet, and its
  keyboard handling is our own (arrows, Enter, Space, 1 to 7). Not tested with a reader.
- The tags of samples come from their names. 20 of the 1649 sounds on the maintainer's
  list get no Drums or Sounds tag (the tabla syllables `ka`, `dhin`, and `jazz`, `metal`).
- In the Browser a row cannot be dragged into the editor yet (spike D4 of
  `doc/DAW-PLAN.md`). Enter, a double click (not on a snippet or a song, which open) or
  the insert button types it.
- The samples of a map written in the song (`samples({...}, 'github:...')`) are not
  listed and not cached before the song has played once.
- Not cached: a map where a sound has its own `_base`, an address with a query (what
  `shabda:` resolves to), and a pack over the file limit. See "What is not cached" in
  `doc/ARCHITECTURE.md`.
- The integration test does not clear the pack cache. Clearing is only tested by hand.
- A kick that ducks an orbit logs "duck target orbit 2 does not exist" once, when it
  hits before anything has played on that orbit. It comes from upstream and is harmless.
- The grammar only reuses JavaScript highlighting. Mini-notation is not highlighted in
  the native editor.
- The integration test does not run in CI. A runner has no sound card and needs a
  virtual display. It also takes about ten minutes now, because it plays every file of
  the template.
- The integration test leaves `demo.strudel` marked as changed in its own window. It
  does not save, so the file on disk is untouched.
- The default sound packs need the network. Offline, only synths, ZZFX, local samples
  and cached packs play.

## Milestones

| Milestone | Content |
|---|---|
| M2 | Native mode feedback: note highlighting through decorations, sliders in the stage with write-back, one undo history |

## Spikes to run

Each spike answers one question. Do it under `tmp/`, write the answer where the last
column says, then delete the spike. None of these is started unless it says so.

| # | Question | How | Record | Write the answer in |
|---|---|---|---|---|
| S1 | How fast does a small model run in the webview on the maintainer's machine, on the GPU and on the CPU? | Load one model with transformers.js in the webview through `pnpm test:vscode`. Run it once with WebGPU and once with WebAssembly. Start with Gemma 3 270M, then 1B, then a code model (CodeGemma 2B or Qwen2.5-Coder 1.5B) | Tokens per second, time to the first token, memory, size of the download, and whether our Content Security Policy needs a new rule | "Measured" in `doc/ARCHITECTURE.md`, and "Which model" below |
| S2 | Can the weights be served from `tmp/strdltn-models/` through `asWebviewUri`, or does the runtime insist on its own download? | Same spike as S1, with the files fetched by the extension host first | Works or not, and what had to be configured | "Local model" below |
| S3 | Does a completion extension with a local server complete `.strudel` files? | Install llama.cpp (or Ollama) on the host and `llama.vscode` (or Continue) in the test profile. Type in a `.strudel` file in the native editor | Whether it offers anything, whether it needs `.strudel` mapped to JavaScript, tokens per second on the CPU | "Completion from another extension" below |
| S4 | Do local reference files change what stock completion offers? | With Copilot on, type the start of a rare function in a `.strudel` file, first without and then with a reference file open in another tab, then with it only on disk | What was offered in each of the three cases | "Strudel's documentation as local examples" below |
| S7 | Does the pack cache work in Codespaces? | Open `examples/05-coastline.strudel` in a Codespace | Whether the files arrive in `.strdltn/cache/` and play from there | "Measured" in `doc/ARCHITECTURE.md` |

Already done, with their answers in `doc/ARCHITECTURE.md` and the drawer: sound in a
webview, WebMIDI in a webview (refused), WebGPU in a webview (works), a native MIDI
module in the extension host (works, but a plain timer is too late), sending MIDI on
time from a worker thread (S5, passed), audio outputs seen by a webview (one, without a
name), the microphone in a webview to name them (S6, refused).
## Local model

Planned, not started. No code until the maintainer says so. The goal: completion and
the smart features below from a model that runs on the user's own machine, with no
network, and that also works when the project is opened in a container.

### What the maintainer decided

Said on 2026-11-20. These are settled, do not ask again.

- The plan below is wanted. It moved from "noted for later" to planned.
- Model files are cached under `tmp/` of the workspace, which git ignores.
- The size of the model is whatever the maintainer's machine runs well. That machine is
  an Intel Core Ultra 7 258V (8 cores) with an Intel Arc 140V built-in GPU and 31.5 GB
  of memory. The GPU has no memory of its own, it shares the system's.
- There should be a fallback to the CPU, so that it also works in Codespaces.
- The maintainer wants to open the project in a container on this machine and work with
  no network, with completion and the smart features still working.
- A second extension may be recommended in the workspace to give completion from a
  local model.

Not decided yet, the maintainer was asked and has not answered: which of the eight uses
below matter most, and the open points at the end of this section.

### Where the model runs

Two places are possible, and they are good at different things.

| | In the webview | A local server (llama.cpp, Ollama) |
|---|---|---|
| Uses the Intel GPU | Yes, through WebGPU. Measured: the webview gets a hardware adapter | Not by default. Ollama does not use an Intel GPU. llama.cpp can with a Vulkan or SYCL build |
| Falls back to the CPU | Yes, the same runtime runs as WebAssembly | Yes |
| Codespaces | Works: the webview runs in the user's browser, on the user's GPU or CPU | Runs on the Codespace's few CPU cores. Slow |
| A container on this machine | Works, the webview is outside the container | Works. The server runs on the host or in a second container |
| Other extensions can use it | No | Yes. This is what a third-party completion extension needs |
| Our own features can use it | Yes | Yes, from the extension host |

Proposal: our own features use the webview, because one runtime covers the GPU, the CPU
and Codespaces. A local server is only added for the third-party completion extension
(see "Completion from another extension"). Our code talks to "a model" through one small
interface, so the place can change.

Runtime to try first in the webview: transformers.js (ONNX Runtime Web), which has both
WebGPU and WebAssembly. WebLLM is the alternative, faster on a GPU but with no CPU
fallback. To be confirmed by the spike, this is from knowledge and not measured.

### Which model

Two jobs need two kinds of model:

- **Completion while typing** needs a model trained to fill in the middle of code.
  General Gemma models are not. Candidates: CodeGemma 2B (the Gemma family's code
  model), Qwen2.5-Coder 0.5B, 1.5B and 3B.
- **Everything else** (explain, write from a description, name things) is chat. A
  general Gemma works: Gemma 3 270M and 1B to start, 4B if the machine keeps up.

Size is decided by measuring, not by guessing. The spike runs each candidate in the
webview on this machine and records tokens per second on WebGPU and on WebAssembly, the
time to first token, and the memory used. Proposed bar: completion needs 20 tokens per
second or more to feel like typing. Expected, not measured: 1B to 2B models pass on this
GPU, 4B is usable for chat, and on the CPU only the smallest ones pass.

The weights are downloaded once by the extension host into `tmp/strdltn-models/` and
given to the webview through `asWebviewUri`, the way the pack cache works. That keeps
them out of the browser's own storage, which a webview does not keep reliably.

### What it is used for

In the order we would build them:

1. **Smart insert, without a model.** A key opens a quick pick with fuzzy search over
   everything the panels know: sound names, banks, snippets, functions. Most of the
   value, no download, the same in both editors. Proposed key: Alt+I ("insert"). It is
   free in VS Code, does not depend on the keyboard layout, and is not a character of
   the language. `/` is the divide sign and is used in mini-notation, Ctrl+Space is VS
   Code's completion, Ctrl+I its inline chat. A typed trigger as a second way in: `,,`
   and then the text.
2. **Search by meaning.** A small embedding model finds a snippet from its description
   ("a bass that pumps with the kick") and a function from what it does.
3. **Completion while typing**, from our own `InlineCompletionItemProvider`. It gives
   the model what a general tool cannot know: the sound names that exist, the snippets
   of the project, the reference of the functions near the cursor. It works in the
   native editor through the VS Code API and needs a bridge for the Strudel editor.
4. **Explain the selection**: what this pattern does, in words.
5. **A pattern from a description**: "four on the floor with an off beat hat" becomes
   code, built from the project's own snippets where one fits.
6. **A variation** of the selected pattern.
7. **Better names in the stage** when the rules in `context.ts` fall back to showing
   code.
8. **Headers for snippets**: propose `@title`, `@category`, `@details` and `@tags` for a
   file that has none.

### Completion from another extension

A quick way to get completion in the native editor before we build our own: recommend
an extension that turns a local model into inline completion, in
`.vscode/extensions.json` and in the devcontainer. Candidates: `llama.vscode` (from the
llama.cpp project) and Continue. Both talk to a local server, so this path needs one.
The names and their settings are from knowledge and have to be checked.

What it will not do: it only works in the native editor, not in the Strudel editor,
which is a webview. It knows nothing about our sounds and snippets. And `.strudel` is a
language it has never heard of, so it may need to be told to treat it as JavaScript.

### Strudel's documentation as local examples

The idea: put every function of Strudel into the workspace as a small `.strudel` file
with its description and examples, so that completion has more to learn from.

What we expect, not measured:

- Stock inline completion (GitHub Copilot) reads the file being edited and a few open or
  related tabs. It does not read the whole workspace. Files on disk that are not open
  help it little. VS Code's own word suggestions only use open documents.
- It helps a great deal everywhere else: an agent or a chat searches the workspace and
  finds them, our own completion and search by meaning can use them as their source, and
  the help panel can show them.

So the files are worth making, as the source for our own features more than for stock
completion. The data exists: `@strudel/reference` has every function with its
parameters and examples. The tutorial pages of the Strudel site can be converted later.

Open: where the files live. In the template (`reference/`), they are part of every
project and every tool sees them. Generated into `tmp/`, they stay out of git, but
agents and search tools often skip ignored folders.

### Working without a network

Possible, with these pieces. None of it is tested.

| Piece | Today | Needed |
|---|---|---|
| The extension | Installed from a `.vsix` | Nothing |
| Our own model | Not built | Weights in `tmp/strdltn-models/`, fetched once |
| The model server for another extension | Not set up | llama.cpp or Ollama on the host, reached from the container as `host.docker.internal`, or a second container with the weights in a volume |
| The completion extension itself | Installed from the Marketplace | Installed once while online, or its `.vsix` kept in the image |
| Default sounds | Maps from the network at every start, audio on first play | Kept in the cache like remote packs |
| Hydra | Loaded from unpkg.com | Bundled |
| Soundfonts | From the network on first use | Kept in the cache |

A container on this machine does not change where our model runs: the webview stays
outside the container, on the real GPU. Docker is installed here. Ollama is not.

### Open points

- Runtime in the webview: transformers.js or WebLLM. The spike decides.
- Which model for each job, by the measurements above.
- The license of the weights. Gemma has its own terms of use, which are not an open
  source license. We download weights, we do not ship them, but the terms still apply to
  the user.
- How to tell a good completion from a bad one. A small set of Strudel lines with the
  end cut off, scored by whether the result evaluates.
- The pack cache is in `.strdltn/cache/` and the models go to `tmp/`. One place would
  be simpler. See decision 5.
- Whether the weights in `tmp/` are shared between projects or downloaded for each one.

### Order of work

1. Spike: one small model in the webview on this machine, WebGPU and WebAssembly,
   numbers written into `doc/ARCHITECTURE.md`.
2. Smart insert without a model (use 1).
3. The reference as local examples.
4. Search by meaning (use 2).
5. Our own completion (use 3).
6. The chat features (uses 4 to 8).
7. The recommended completion extension and the offline container, as its own piece of
   work, since it needs a server.
## Noted for later, not planned

**Ideas from openDAW.** openDAW (opendaw.org, github.com/andremichelle/openDAW, AGPL-3.0,
TypeScript) is a DAW in the browser. AGPL means we take ideas from it, not code. From
its device list (read 2026-11-21), the ones that fit a Strudel DAW: Playfield (a sample
drum computer with an effect chain per pad, close to our drum pad of phase 11); Composite
and FX Composite (several instruments or effect chains under one set of notes, mixed
dry/wet, like our Stacks in the Mixer); Frequency Split and Stereo Split (an effect chain
per band or per side); Maximizer (a brickwall limiter on the master, which would have
caught the demo's clipping); Revamp (an equalizer with a spectrum); Apparat, Werkstatt and
Spielwerk (an instrument, an effect and a MIDI effect scripted in JavaScript); Tone3000
(Neural Amp Modeler); a vocoder and autotune. It also hosts WebCLAP plugins (CLAP built
to wasm) with their own windows and automation, which is an option beside WAM for
"Plugins on Strudel channels" below. And Live Rooms, a shared session.

**Pictures of the drum machines.** The maintainer asked for a hover on each drum machine
bank that shows the real instrument: a diagram of the device from above, all devices at
one size. The details pane of the Browser can show an image that ships with the extension. The work is the pictures. There are 134
banks. A photo by somebody else needs a license that allows it, so the plan is our own
drawings (SVG), one per device. Open: who draws them, how true to the device they must
be, and whether a drawing of a commercial product needs anything from its maker. A first
step is five or six of the best known machines, to see the size and the style.

**Help and tutorials inside VS Code.** A structured manual beside the code: every
function with its parameters and examples, and the Strudel tutorial. The text exists now
in `template/reference/`, made for AI assistants. What is left is a view that shows it,
with each example as a snippet that can be played.

**Plugins on Strudel channels.** Load an audio plugin with something like
`.vst("name")` and insert it on that pattern's orbit. In the Strudel editor the call
renders as a block with the plugin name and small sliders for its macros, and a click
opens the plugin's own window. The plugin format in a webview is WAM (Web Audio Modules
2): wasm DSP with a web GUI. First question: does superdough let us insert a node on
one orbit, or does that need a change upstream?

**Native VST3 on desktop.** Only possible outside the webview: a sidecar host process,
with audio streamed out and back. Large, adds latency, never works in Codespaces.

**A skill that ports open-source VST3 plugins to WAM.** From source (JUCE, iPlug2, DPF,
Faust), not from a binary. See the drawer for why not from a binary.

**Engine channel.** A setting to load the engine bundle from a CDN at run time, to get
new Strudel releases without an extension release. Breaks offline use.

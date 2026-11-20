# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

## State

**Released:** 0.1.0, tag `v0.1.0` on `main`. The GitHub release has the `.vsix`, the
maintainer's own VS Code runs that build (`pnpm promote`), and the home page shows it.

**In flight:** Firmware Hub, on branch `feat/firmware-hub`, draft pull request #3.
Firmwares from a `firmware/` folder or from an address (`firmware(url)`, cached for
offline use) play in a song as `vibefm1:<id>`, with `.progNum()` for their sounds. Next:
the hand test under "Firmware Hub", then the hub's catalog and the Firmware view. The
version stays 0.1.0 until the maintainer asks for a release.

Next in line:

| # | What | State |
|---|---|---|
| 1 | MIDI: devices in the Sounds view, playing through them, mappings | Spike done, not built. See "MIDI" |
| 2 | A list of sound cards to send the sound to | Probed, not built. See "Sound card" |
| 3 | The hand test below | Waiting for the maintainer |
| 4 | Firmware Hub: VIBE FM firmwares as synths in a song, with a Firmware view | Plays from a local folder, works in Chrome. Waiting for a hand test in VS Code. See "Firmware Hub" |

## Next: test by hand

`pnpm test:vscode` passes in VS Code 1.130 and we looked at its screenshots. It cannot
hear, and it cannot feel whether a click does what you expect.

Target: **desktop VS Code, F5 on this repo** (opens `template/`).

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Open `demo.strudel`, click in the code, press Ctrl+Enter | Your Sea of Souls mix plays, with the vocals from `samples/sos-vocals` |
| 2 | Drag the sliders at the top of the code | Parts come in and out |
| 3 | Click the vstrudel icon. Open "Drum machines", then a bank | Banks by name, each with a drum icon. Sounds inside are `bd`, `cp`... |
| 4 | Put the cursor inside a `s("...")` and click a sound | The full name is typed at the cursor, and you hear the sound |
| 5 | Press the speaker button at the top of Sounds, click another sound | The name is typed, no sound. The button changed |
| 6 | Press the button on a bank | `.bank("...")` is typed |
| 7 | In Snippets, click a snippet | A card opens under it: fields, colored code, two buttons |
| 8 | Press "Insert at cursor" | Only the code is inserted, not the header |
| 9 | Double click a snippet | Its file opens in the native editor |
| 10 | Type in the filter box of Snippets | The list narrows, on title, description and tags |
| 11 | Open `examples/05-coastline.strudel` | A group `github:eddyflux/crate` appears in Sounds, with a bank `crate`. The status bar shows the download |
| 13 | Switch `demo.strudel` to the native editor and press Ctrl+Enter | The stage lists Sliders (kick vol, snare vol...) and Visuals (kick, snare...), each with its name |
| 14 | Drag a slider in the stage | The part gets louder or quieter, and the number in the code changes |
| 12 | Play it, then turn the network off, reload the window and play it again | It still plays |

Expected still broken: sound stops on every mode switch, no MIDI.

Report the result by check number. When something fails, add the content of Output >
`vstrudel`.

## Decisions waiting for the maintainer

| # | Question | What we did meanwhile |
|---|---|---|
| 1 | Snippet header: is the form `// @title`, `@category`, `@details`, `@tags`, `@by`, `@credits` right, and the nine categories? | Built it this way |
| 2 | A click on a sound types its name every time. Good while writing, noisy while only browsing. Keep it, or type on double click? | Click types |
| 3 | A sound in a bank types its full name (`RolandTR909_bd`). Or should it type the short name (`bd`) and leave the bank to the button? | Full name |
| 4 | Where the Snippets view lives: in the vstrudel side bar, or behind its own icon? | In the vstrudel side bar. Any view can be dragged elsewhere |
| 5 | The cache for remote packs is `.vstrudel/cache/` in the workspace, not `tmp/`. A dot folder that ignores itself for git seemed safer than a folder a project may already use. OK? | `.vstrudel/cache/` |
| 6 | A pack is copied whole. `github:eddyflux/crate` is 367 files and 175 MB. Copy everything, or only the files a song has played? | Everything, up to 600 files |
| 7 | MIDI: build the desktop bridge now, knowing it cannot work in Codespaces? | Not built |
| 8 | Sound across a mode switch (see "Open design questions") | Sound stops |
| 9 | Default editor for `.strudel`: the Strudel editor, or the native one with the stage? | The Strudel editor |
| 10 | Marketplace: publisher id, token, and an icon without the VS Code logo (see "Publishing") | Waiting |
| 11 | Should the test screenshots keep the debug text in the corner and the title "[Extension Development Host]"? | Kept |
| 12 | `algorave` examples by other people without a license (Switch Angel, Art Haus, the cover versions): we wrote our own versions and name them in `@credits`. Copy the originals too? | Not copied |
| 13 | Firmware Hub: write to the hub's author (zven@thefirmwarehub.com) before building? We would ask for a catalog feed with CORS, and say that we host the `.wasm` with our own code, not with his emulator | Nothing sent |
| 14 | Firmware Hub: a hap's own effects (`room`, `delay`, `lpf`, `pan`, `gain`) do not reach a firmware, only the orbit's (`djf`, ducking). Fine, or worth the work below? | As it is |
| 15 | SHRUB: write to Xfer (steve@xferrecords.com) and ask for a VIBE FM build? See "SHRUB" | Nothing sent |

## MIDI

### What we measured

- A webview may not use WebMIDI ("Midi has been disabled in this document by
  permissions policy"). So Strudel's own `.midi()`, `midin()` and `midikeys()` cannot
  work inside vstrudel, on desktop or in Codespaces.
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
- The host must not use a plain timer to send. To try: a worker thread that waits with
  `Atomics.wait`, or sending a little early and spinning for the last millisecond.
- Codespaces is not possible this way: the extension host is remote and cannot see a
  device on the user's machine. No design yet.

### What to build

1. A "MIDI devices" group in the Sounds view with two folders, outputs (instruments)
   and inputs (controllers). A click types the device name.
2. `.midi()` for outputs through the bridge.
3. `midin()` and `midikeys()` for inputs through the bridge, in the other direction.
4. Mappings set up in the side bar, so a song needs no setup code: which CC of which
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

### Hand test

Target: **desktop VS Code, F5 on this repo** (opens `template/`). Checks 1, 2 and 8 need
a firmware in `template/firmware/`: `obervave.wasm` and `obervave.json` from the
`firmwares/` folder of `github.com/Vibe-FM-SDK/vibe-fm-sdk`. Do not commit them (GPL-3.0,
800 KB). The examples load OBERVAVE from GitHub by themselves.

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Open the Sounds view, group "Firmware" | `vibefm1`, and under it `vibefm1:obervave` |
| 2 | Click `vibefm1:obervave` with the speaker button on | `vibefm1:obervave` is typed, a note of OBERVAVE plays |
| 3 | In a new file, play `note("c2 eb2 g2 bb2").s("vibefm1:obervave")` with `s("bd*4")` beside it | It sounds, on the beat with the kick |
| 4 | Open `examples/07-vibefm1-obervave.strudel` and play it | Drums, a deep bass ducked by the kick, a dark pad, an arp |
| 5 | Open `examples/08-vibefm1-patterns.strudel` and play it | The lead changes its sound every cycle |
| 6 | Change the sound to `vibefm1:nosuch` and play | Output > `vstrudel` says "no such firmware" once and lists `obervave` |
| 7 | Stop | The firmware is silent at once |
| 8 | Delete `obervave.wasm` and add it again | The group empties and comes back without a reload |
| 9 | Play example 07 once, then turn the network off, reload the window and play it again | It still plays. `.vstrudel/cache/firmware/` holds `obervave.wasm` |

Expected still broken: no Firmware view, no catalog of the hub, `.room()` and other effects
on the firmware's line do nothing. Report by check number, with Output >
`vstrudel` when one fails.

### What we know about the hub

Read from the hub's pages on 2026-11-20. Not tested.

- The hub builds each FM-1 firmware from its own source into a VIBE FM firmware: one
  `.wasm` and a `firmware.json`, packed in a `.zip` (for example
  `thefirmwarehub.com/fw/vibe/boom-native-vibe.zip`). Each zip carries its license and
  source.
- Licenses: most firmwares are GPL-3.0, some MPL-2.0, M-VAVE's own V15 is Apache-2.0. The
  SDK is Apache-2.0. The VIBE FM VST and the browser emulator are closed, all rights
  reserved: we may not copy, embed or host them. vstrudel is AGPL-3.0.
- The Playground (`play.thefirmwarehub.com/?fw=<id>`) reads its list from
  `firmware/index.json` on that host. We could not fetch it from our sandbox, so its
  shape and its CORS headers are unknown. The hub documents no public catalog API.

### Steps left

| # | Step | Done when |
|---|---|---|
| 1 | Catalog: find a list we may use. Try `play.thefirmwarehub.com/firmware/index.json` from Node, look at the hub's pages, ask the author (decision 13). Write the result in `doc/ARCHITECTURE.md` | We know the URL, the fields and how often it changes |
| 2 | The hub's catalog in the host: fetched and kept for a day, works offline from the last copy. A firmware picked from it goes through `firmware(url)` and the cache that exists, with a SHA-256 check when the catalog has one | `pnpm test:unit` covers the unpack and the cache paths |
| 3 | Check the transport with a firmware that has its own sequencer (SLOOP) | It follows play, stop and `setcps` |
| 4 | `.vp()` for parameters by their id, through `VIBE_EV_PARAM`. `VibeCore` already reads the list and has the event | A slider moves a firmware parameter |
| 5 | The Firmware view: groups "In this project" and the hub's list by device; name, version, author, license; a click types `s("vibefm1:<id>")` and starts the download; buttons for the hub page, the cheat sheet, the parameters and a test note; a filter box; "Add firmware..." for a `.zip` or `.wasm` from disk | The hand test of the view passes |
| 7 | `.midi("vibefm1:...")`, once the webview's own `.midi()` from "MIDI" exists: names that start with `vibefm1:` go to the firmware, CCs and `midimaps` work too | Code written for an FM-1 over MIDI plays the firmware |
| 8 | Store: `vibe_host_store` writes go to `.vstrudel/firmware-store/<id>/` through the host, and come back on load | Save a sound in a firmware, reload, it is there |
| 9 | A snippet in `lib/` for a firmware part | |
| 10 | README and `doc/ABOUT.md`, once the view exists | |
| 11 | Later: the 480 x 320 display in the stage, from `vibe_wasm_draw` at 30 fps | |

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
   Not worth building.


## Sound card

Measured in the webview: `enumerateDevices()` returns one audio output with no label,
and `AudioContext.setSinkId` exists. A browser only gives the real list, with names,
to a page that may use the microphone. We have not asked for that permission yet, so we
do not know whether VS Code lets a webview have it.

To try, in this order:
1. Ask for the microphone once in the webview and list the outputs again. If it works,
   the list goes in the side bar and a click calls `setSinkId`. superdough already has
   `getAudioDevices()` and an audio device setting for this.
2. If VS Code refuses, there is no way from the webview. The extension host cannot
   route the webview's sound.

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
   id, which is `<publisher>.vstrudel`. The id is also written in `src/test/m0.ts`.
3. Add the token to the GitHub repository as the secret `VSCE_PAT`.
4. Add an `icon` to `package.json`: a PNG of at least 128 by 128 pixels. The Marketplace
   restricts the use of the VS Code logo in an extension's icon, and `doc/logo.jpg`
   contains it, so the icon needs its own picture.
5. Tag a release. The pipeline publishes it.
6. Change the three devcontainer files to install by id
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

- Undo in the Strudel editor is CodeMirror's own history. It should go through VS Code
  so there is one history across both modes.
- Cursor and scroll position are not carried across a mode switch.
- Notes that are playing are not highlighted in the native editor.
- A sample that was deleted stays in the Sounds view until the editor is reloaded.
- The Sounds view is empty until a `.strudel` file is open.
- A sound with more than 64 variations only shows the first 64.
- The Sounds view has no search box of its own. The tree filter of VS Code (Ctrl+F in
  the view) works.
- A snippet is a whole file. Several snippets in one file are not possible.
- The pack cache only knows `samples('github:...')`. A full `https://` address, and a
  `github:` name as the second argument of `samples()`, stay on the network.
- The pack cache has no way to see its size or to clear it, other than deleting
  `.vstrudel/`.
- A kick that ducks an orbit logs "duck target orbit 2 does not exist" once, when it
  hits before anything has played on that orbit. It comes from upstream and is harmless.
- `stop` stops every session, not only the active one.
- The grammar only reuses JavaScript highlighting. Mini-notation is not highlighted in
  the native editor.
- The editor font and theme are Strudel's defaults, not VS Code's.
- The status text in the corner of the editor ("editor | audio running | playing") is a
  debugging aid and should become a status bar item.
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
| M1 | Solid core: settings for theme and font, eval errors as diagnostics, status bar |
| M2 | Native mode feedback: note highlighting through decorations, sliders in the stage with write-back, one undo history |
| M3 | MIDI through the bridge, sound card choice, the Strudel reference in the side bar |
| M4 | Language support in the native editor: completion, hover, signature help, mini-notation grammar and diagnostics |
| M5 | Ship: Marketplace, template as its own repo, Renovate for `@strudel/*` |

## Noted for later, not planned

**Help and tutorials inside VS Code.** A structured manual beside the code: every
function with its parameters and examples, and the Strudel tutorial. The function
reference can come from `@strudel/reference` (the data behind the reference on
strudel.cc). The tutorial is harder: upstream writes it as web pages with live
examples, so it has to be converted, with each example as a snippet that can be played.

**Smart insert with a local model.** A key opens a small prompt. You type free text and
it offers the best matches from everything the panels know: sound names, drum machine
banks, snippets (matched on their description), MIDI devices, functions. A model that
runs in the webview ranks the matches, with the GPU when there is one (WebGPU works in
the webview, measured) and without it otherwise.

A first version needs no model: a VS Code quick pick with fuzzy search over the same
lists gives most of the value, works the same in both editors, and costs no download.
Then a small embedding model for matching by meaning, then a generative model such as
Gemma for writing code. A generative model is a download of several hundred megabytes
and is slow without a GPU.

Proposed key: **Alt+I** ("insert"). It is free in VS Code, it does not depend on the
keyboard layout, and it is not a character of the language. `/` is the divide sign and
is used in mini-notation, Ctrl+Space is VS Code's own completion, Ctrl+I is its inline
chat. A typed trigger as a second way in: `,,` followed by the text. Two commas in a
row mean nothing in Strudel code and are easy to type on every layout.

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

# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

## State

**Released:** 0.1.0, tag `v0.1.0` on `main`. The GitHub release has the `.vsix`, the
maintainer's own VS Code runs that build (`pnpm promote`), and the home page shows it.

**In flight:** nothing. New work starts on a new feature branch and reaches `main`
through a pull request. The version stays 0.1.0 until the maintainer asks for a
release.

Next in line:

| # | What | State |
|---|---|---|
| 1 | MIDI: devices in the Sounds view, playing through them, mappings | Spike done, not built. See "MIDI" |
| 2 | A list of sound cards to send the sound to | Probed, not built. See "Sound card" |
| 3 | The hand test below | Waiting for the maintainer |
| 4 | Firmware Hub: VIBE FM firmwares as synths in a song, with a Firmware view | Planned, not built. See "Firmware Hub" |

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
| 13 | Firmware Hub: write to the hub's author (zvenson@thefirmwarehub.com) before building? We would ask for a catalog feed with CORS, and say that we host the `.wasm` with our own code, not with his emulator | Nothing sent |
| 14 | Firmware Hub: the call in a song. `s("vibe:obervave")` (a sound like any other), `.vibe("obervave")` (its own function), or both? | Plan uses both, `s()` first |

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

### What we know

Read from the hub's pages and from the VIBE FM SDK source
(`github.com/Vibe-FM-SDK/vibe-fm-sdk`, Apache-2.0) on 2026-11-20. Nothing here is tested
in vstrudel yet.

- The hub hosts open firmware for the M-VAVE FM-1 and other small devices. For the FM-1
  it builds each firmware from its own source into a VIBE FM firmware: one `.wasm` and a
  `firmware.json`, packed in a `.zip` (for example `thefirmwarehub.com/fw/vibe/boom-native-vibe.zip`).
  The same `.wasm` runs in the VIBE FM VST plugin (VST3, AU, CLAP), in the browser
  Playground (`play.thefirmwarehub.com/?fw=<id>`) and on the VIBE FM hardware. It is not
  an emulator of the FM-1 chip.
- Licenses: most firmwares are GPL-3.0, some MPL-2.0, M-VAVE's own V15 is Apache-2.0.
  Each zip carries its license and source. The SDK is Apache-2.0. The VIBE FM VST and the
  browser emulator (`emulator/` in the SDK repo) are closed, all rights reserved: we may
  not copy, embed or host them. vstrudel is AGPL-3.0.
- The `.wasm` is freestanding: no libc, static memory, no code at load time. It imports
  three functions from module `env`: `vibe_host_log(ptr, len)`, `vibe_host_request(what)`
  and `vibe_host_store(op, name, nameLen, data, len)` (storage: 0 read, 1 write, 2 size,
  3 delete, 4 list, 5 read at offset).
- What a host calls (exports, from `sdk/src/vibe_sdk.c`): `vibe_sdk_version()`,
  `vibe_wasm_init(sampleRate)`, `vibe_wasm_io()` (a pointer to four float buffers of
  `VIBE_MAX_BLOCK` = 256: in, out_l, out_r, in2), `vibe_wasm_audio(frames, hasInput)`,
  `vibe_wasm_event(type, id, down, value, midi)`, `vibe_wasm_param_count/info/value/set`,
  `vibe_wasm_transport()`, `vibe_wasm_midi_out()`, `vibe_wasm_draw()` (480 x 320 RGB565).
- Sample rate and block size belong to the host. `frames` may be 1 to 256 and the SDK
  says to split blocks at events. So a note can start on its exact frame.
- Events that matter for us: `VIBE_EV_MIDI = 5` (`midi` = the three raw bytes packed
  little-endian), `VIBE_EV_NOTE = 9` (id = note, value = velocity 0..1, `midi[0]` =
  channel), `VIBE_EV_PARAM = 10` (id = parameter index, value in min..max),
  `VIBE_EV_TRANSPORT = 8` (play, stop, tempo). Firmwares with tracks, such as OBERVAVE
  (4 tracks), take the track from the MIDI channel.
- The Playground instantiates the `.wasm` inside an `AudioWorkletProcessor` and calls
  `vibe_wasm_audio` from `process()`. It reads its list from `firmware/index.json` on
  `play.thefirmwarehub.com`. We could not fetch that file, so its shape and its CORS
  headers are unknown. The hub documents no public catalog API.
- Our CSP already allows wasm (`'unsafe-eval'`) and AudioWorklets from `data:` and `blob:`.

### Design

Everything runs in the webview, so it works on desktop and in Codespaces alike, and
needs no MIDI bridge. The extension host only downloads and caches.

```
Firmware view (host) --click--> types s("vibe:obervave") in the song
packs-style cache (host): hub zip -> .vstrudel/cache/firmware/<id>/<version>/{fw.wasm, firmware.json, LICENSE}
webview: asWebviewUri(fw.wasm) -> WebAssembly.compile -> VibeNode (AudioWorkletNode, our own processor)
superdough: registerSound("vibe:<id>") -> onTrigger(t, value) posts {frame, note, on/off, vel, chan} to VibeNode
VibeNode output -> the orbit's bus, so the firmware is in the same mix as everything else
scheduler: cps -> VIBE_EV_TRANSPORT tempo, start/stop -> play/stop
```

Decisions inside the design:

- **One node per firmware and orbit, not per note.** A firmware is a whole poly synth,
  often with its own sequencer. superdough's `onTrigger` returns a node per hap and wires
  it into that hap's effects chain. For a firmware the per-hap node is a silent stub, and
  the firmware's own node goes to the orbit's bus. So orbit effects (`room`, `delay`,
  ducking) apply, per-hap effects (`lpf`, `pan` per note) do not. The same limit as
  MIDI synths in Strudel. To check in the spike: how superdough 1.3.0 exposes an orbit's
  input to connect to.
- **Sample-exact notes.** superdough schedules ahead by about 100 ms. The webview posts
  each note with its target frame (`Math.round(t * sampleRate)`). The processor keeps a
  queue sorted by frame and splits each 128-frame block at the events, calling
  `vibe_wasm_audio` for each piece. Note off comes from the hap's duration.
- **Our own processor.** Written from the SDK headers and `vibe_sdk.c` (Apache-2.0), not
  from `emulator/js/worklet.js`, which is closed. Version one implements: the three
  imports (log to our output channel, `request` ignored, store in memory), init, audio,
  events, parameters. No display, media, SysEx, workers, CV.
- **Version check.** Refuse a firmware whose `vibe_sdk_version()` we do not know, with a
  message in the output channel, the same way the Playground does.

### In a song

```js
// A firmware is a sound. Notes, velocity and channel go to it.
note("c2 eb2 g2").s("vibe:obervave").velocity(0.8).midichan(2)

// Its parameters by their id in vibe_params(), patternable
note("<c3 g2>").s("vibe:obervave").vp({ cutoff: sine.range(0.2, 0.8) })

// Virtual MIDI: the same firmware as a MIDI output, for code written for hardware
note("c3 e3").midi("vibe:obervave")
```

`.midi("vibe:...")` belongs with the webview's own `.midi()` from "MIDI" above: names
that start with `vibe:` go to the firmware in the webview, all others to the host bridge.
CCs (`ccn`/`ccv`) and `midimaps` then work too, as `VIBE_EV_MIDI`. This also makes a
firmware usable in Codespaces, where the MIDI bridge is not.

### Firmware view

A tree in the vstrudel side bar, next to Sounds and Snippets.

- Groups: "In this project" (cached or in a `firmware/` folder of the workspace), then
  the hub's list grouped by device (FM-1 native ports, VIBE FM native, other devices).
- Each item: name, version, author, license as its description; the hub's description
  as its tooltip; a cloud icon until it is downloaded.
- Click: types `s("vibe:<id>")` at the cursor (with the same rule as a sound click, see
  decision 2). The first use downloads the zip, with progress in the status bar.
- Buttons on an item: open its page on the hub, open its cheat sheet, show its
  parameters (to copy ids for `.vp()`), play a test note (with the preview button of
  Sounds).
- A filter box, like Snippets, on name, author and description.
- "Add firmware..." in the title bar: pick a `.zip` or `.wasm` from disk, for a firmware
  you built yourself. It is copied to `firmware/` in the workspace.
- `samples()`-like line for songs that should load by themselves:
  `vibe('github:<user>/<repo>')` or `vibe('https://thefirmwarehub.com/fw/vibe/x.zip')`,
  cached the same way as packs.

### Steps

| # | Step | Done when |
|---|---|---|
| 0 | Spike in `tmp/`: our minimal processor plays `obervave.wasm` in a plain page (`pnpm smoke`) on one note | A note sounds, the processor has none of the closed code |
| 1 | Catalog: find a list we may use. Try `play.thefirmwarehub.com/firmware/index.json` from Node, look at the hub's pages, ask the author (decision 13). Write the result in `doc/ARCHITECTURE.md` | We know the URL, the fields and how often it changes |
| 2 | `src/extension/firmware.ts`: catalog fetch (cached for a day, works offline from the last copy), zip download and unpack into `.vstrudel/cache/firmware/`, SHA-256 check when the catalog has one. Unzip with a small MIT library (`fflate`), pinned | `pnpm test:unit` covers the unpack and the cache paths |
| 3 | `src/webview/vibe-worklet.ts` and `vibe.ts`: the processor, the node, the event queue with frame-exact splitting | The spike's note plays from the extension |
| 4 | `registerSound("vibe:<id>")` for each cached firmware, so the Sounds view lists them in a group "Firmware" with their own icon | `s("vibe:obervave")` plays in `demo.strudel` |
| 5 | Transport and tempo from the scheduler | A firmware with its own sequencer (SLOOP) follows play, stop and cps |
| 6 | `.vp()` for parameters, and `VIBE_EV_PARAM` | A slider moves a firmware parameter |
| 7 | The Firmware view | The checks below pass |
| 8 | `.midi("vibe:...")`, once the webview's `.midi()` exists | Code written for an FM-1 over MIDI plays the firmware |
| 9 | Store: `vibe_host_store` written to `.vstrudel/firmware-store/<id>/` through the host, so a firmware's saved sounds survive a reload | Save a sound, reload, it is there |
| 10 | A snippet `lib/firmware/` and an example in `template/examples/` that uses a GPL firmware by download, not by copy | Plays in `pnpm test:vscode` |
| 11 | Docs: `doc/ARCHITECTURE.md` (the parts, the message protocol, measured CPU), README, `doc/ABOUT.md` | |
| 12 | Later: the 480 x 320 display in the stage, from `vibe_wasm_draw` at 30 fps off the audio thread | |

### Risks and open questions

- Firmwares built with two flows (`VIBE_PARALLEL_AUDIO`) or worker jobs (`VIBE_JOBS`,
  shared memory, `--enable-multi-thread`) may expect a host that calls draw and jobs on
  other threads. Without workers we expect jobs to run inline. To check in the spike with
  one of each.
- CPU: the hub says "a few % of one core" per firmware in the plugin. In a webview, with
  superdough beside it, unknown. Measure with 1, 2 and 4 firmwares.
- An AudioWorklet's `process()` gets 128 frames. Splitting at events only makes the
  pieces shorter, so latency stays one block. To measure: the offset between a firmware
  note and a sample on the same beat, from a recording.
- The catalog has no documented API (step 1). If none can be had, the view shows only
  firmwares the user adds, plus a link to the hub.
- Some firmwares make sound on their own (a sequencer that plays from start). That is
  fine with transport, but a stopped song must send stop.
- A firmware is GPL-3.0: we download it at run time into the user's cache and never ship
  it inside the `.vsix`. The example in `template/` names it, it does not contain it.

### Hand test, when built

Target: **desktop VS Code, F5 on this repo**, and once in **Codespaces**.

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Open the Firmware view | The hub's firmwares, grouped, with author and license |
| 2 | Click OBERVAVE with the cursor in the code | `s("vibe:obervave")` is typed, the status bar shows the download |
| 3 | Play `note("c2 eb2 g2").s("vibe:obervave")` with the demo's drums | It sounds, on the beat with the drums |
| 4 | Change the tempo with `setcps` while it plays | The firmware's arp or sequencer follows |
| 5 | Add `.room(0.5)` to the firmware's line | Reverb on the firmware |
| 6 | Turn the network off, reload, play | It still plays from the cache |

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

# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

## State

**Released:** 0.1.0, tag `v0.1.0` on `main`. The GitHub release has the `.vsix`, the
maintainer's own VS Code runs that build (`pnpm promote`), and the home page shows it.

**In flight:** the branch `feat/m1-solid-core`, not merged and not released. It holds:
errors in the code as problems of the file, a status bar item, settings for theme and
font, stop for the song in front, the sound list before a file is open, and the cache
for `https://` packs and for maps with a remote base, with commands to see its size and
to clear it. The version stays 0.1.0 until the maintainer asks for a release.

`README.md` and `doc/ABOUT.md` still describe 0.1.0. They get these features at the
release (step 1 of "Release" in `doc/ARCHITECTURE.md`).

Next in line:

| # | What | State |
|---|---|---|
| 1 | MIDI: devices in the Sounds view, playing through them, mappings | Spike done, not built. See "MIDI" |
| 2 | A list of sound cards to send the sound to | Probed, not built. See "Sound card" |
| 3 | The hand test below | Waiting for the maintainer |

## Next: test by hand

`pnpm test:vscode` passes in VS Code 1.147 and we looked at its screenshots. It cannot
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
| 15 | In the native editor, add the line `$: s("bd").lfpx(200)` and press Ctrl+Enter | A red squiggle under `lfpx`, one entry in Problems, and the status bar item is red: "vstrudel: playing, error in the code". The song keeps playing |
| 16 | Type a space on another line | The squiggle goes. The status bar stays red, with the message in its tooltip |
| 17 | Remove the line and press Ctrl+Enter | The status bar says "vstrudel: playing" |
| 18 | Click the status bar item twice | The song stops, then plays |
| 19 | Look at the font of the Strudel editor | The same font and size as the native editor |
| 20 | In Settings set `vstrudel.editor.theme` to `githubLight` | The Strudel editor turns light at once, without a reload |
| 21 | Play `demo.strudel` and an example in two tabs. Press Ctrl+. twice | The first press stops only the song in front. The second stops the other |
| 22 | Play both again and run "vstrudel: Stop all" | Both stop |
| 23 | Run "Developer: Reload Window", close every tab, and open the Sounds view | The list is there before a file is open |
| 24 | Run "vstrudel: Show sample pack cache size" | A message with the size, the number of files and the pack names, and a "Clear cache" button |
| 25 | Press "Clear cache", then "Delete" in the dialog | `.vstrudel/cache` is gone. An open song that uses a pack still plays, from the network |

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
| 11 | Should the test screenshots keep the title "[Extension Development Host]"? The debug text in the corner is gone, the status bar item replaced it | Kept |
| 12 | `algorave` examples by other people without a license (Switch Angel, Art Haus, the cover versions): we wrote our own versions and name them in `@credits`. Copy the originals too? | Not copied |

| 13 | The Strudel editor now takes its font and size from VS Code (`editor.fontFamily`, `editor.fontSize`) unless `vstrudel.editor.*` says otherwise. Before it was Strudel's own 18 px monospace. OK as the default? | VS Code's font |
| 14 | The theme stays Strudel's own (`strudelTheme`) by default. Should it follow a light or dark VS Code theme, for example `vscodeLight` and `vscodeDark`? | Does not follow |
| 15 | Ctrl+. stops the song in front, and the song in another tab when nothing plays in front. "Stop all" has no key. Should it have one? | No key |
| 16 | An edit removes the squiggle of an error, and the status bar keeps the message (see the drawer). OK? | Removed on edit |
| 17 | After "Clear sample pack cache", a pack is downloaded again the next time a song that loads it is opened or edited. Or should a cleared pack stay away until asked for? | Downloaded again |

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
- Before a `.strudel` file is open, the Sounds view shows the list the last engine
  reported. It can name a sample that was deleted since, and preview needs an open
  file.
- An error in the code shows no squiggle in the Strudel editor, only in the Problems
  view and in the status bar.
- The place of an error is found by rule from its message. For a name that is written
  more than once it can be the wrong place. An error no rule places is on line 1.
- A sound that is not found while the pattern plays is not a problem of the file. It
  only goes to Output > `vstrudel`.
- The theme of the Strudel editor does not follow the VS Code theme.
- The list of themes in `package.json` is a copy of upstream's. Nothing checks it when
  `@strudel/codemirror` is updated.
- A sound with more than 64 variations only shows the first 64.
- The Sounds view has no search box of its own. The tree filter of VS Code (Ctrl+F in
  the view) works.
- A snippet is a whole file. Several snippets in one file are not possible.
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
| M3 | MIDI through the bridge, sound card choice, the Strudel reference in the side bar |
| M4 | Language support in the native editor: completion, hover, signature help, mini-notation grammar and diagnostics |
| M5 | Ship: Marketplace, template as its own repo, Renovate for `@strudel/*` |

## Spikes to run

Each spike answers one question. Do it under `tmp/`, write the answer where the last
column says, then delete the spike. None of these is started unless it says so.

| # | Question | How | Record | Write the answer in |
|---|---|---|---|---|
| S1 | How fast does a small model run in the webview on the maintainer's machine, on the GPU and on the CPU? | Load one model with transformers.js in the webview through `pnpm test:vscode`. Run it once with WebGPU and once with WebAssembly. Start with Gemma 3 270M, then 1B, then a code model (CodeGemma 2B or Qwen2.5-Coder 1.5B) | Tokens per second, time to the first token, memory, size of the download, and whether our Content Security Policy needs a new rule | "Measured" in `doc/ARCHITECTURE.md`, and "Which model" below |
| S2 | Can the weights be served from `tmp/vstrudel-models/` through `asWebviewUri`, or does the runtime insist on its own download? | Same spike as S1, with the files fetched by the extension host first | Works or not, and what had to be configured | "Local model" below |
| S3 | Does a completion extension with a local server complete `.strudel` files? | Install llama.cpp (or Ollama) on the host and `llama.vscode` (or Continue) in the test profile. Type in a `.strudel` file in the native editor | Whether it offers anything, whether it needs `.strudel` mapped to JavaScript, tokens per second on the CPU | "Completion from another extension" below |
| S4 | Do local reference files change what stock completion offers? | With Copilot on, type the start of a rare function in a `.strudel` file, first without and then with a reference file open in another tab, then with it only on disk | What was offered in each of the three cases | "Strudel's documentation as local examples" below |
| S5 | Can the extension host send MIDI on time? | A worker thread that waits with `Atomics.wait`, or sends early and spins for the last millisecond. Measure with the silent "all notes off" message, as the first MIDI spike did | How late a send is: middle, 95th percentile, worst. The bar is 2 ms | "MIDI" above |
| S6 | Can a webview list the sound cards by name? | Ask for the microphone once in the webview, then call `enumerateDevices()` again | Whether VS Code allows the request, and the list that comes back | "Sound card" above |
| S7 | Does the pack cache work in Codespaces? | Open `examples/05-coastline.strudel` in a Codespace | Whether the files arrive in `.vstrudel/cache/` and play from there | "Measured" in `doc/ARCHITECTURE.md` |

Already done, with their answers in `doc/ARCHITECTURE.md` and the drawer: sound in a
webview, WebMIDI in a webview (refused), WebGPU in a webview (works), a native MIDI
module in the extension host (works, but a plain timer is too late), audio outputs seen
by a webview (one, without a name).
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

The weights are downloaded once by the extension host into `tmp/vstrudel-models/` and
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
| Our own model | Not built | Weights in `tmp/vstrudel-models/`, fetched once |
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
- The pack cache is in `.vstrudel/cache/` and the models go to `tmp/`. One place would
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

**Help and tutorials inside VS Code.** A structured manual beside the code: every
function with its parameters and examples, and the Strudel tutorial. The function
reference can come from `@strudel/reference` (the data behind the reference on
strudel.cc). The tutorial is harder: upstream writes it as web pages with live
examples, so it has to be converted, with each example as a snippet that can be played.

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

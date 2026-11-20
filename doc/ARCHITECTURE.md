# Architecture

How vstrudel is built, and what we know about the platform. Each fact says whether it
was measured or is only expected.

## Goal

A VS Code extension that makes VS Code an IDE for Strudel. It has to run in desktop VS
Code and in GitHub Codespaces. A second project, the template, is what a user clones to
start writing music.

## Rules the design follows

**The sound is made in a webview.** In Codespaces the extension host runs on a remote
machine with no sound card. A webview runs in the user's browser. So the engine lives in
the webview and the same design works on desktop and in Codespaces.

**The extension host is the backend.** It reads the workspace with `workspace.fs` and
hands files to the webview through `asWebviewUri`. There is no HTTP server and no
database. Strudel's own backend only shares patterns publicly, which we do not need.

**We host upstream, we do not rebuild it.** The webview runs the upstream
`StrudelMirror` from `@strudel/codemirror`. Editor, engine, highlighting, inline widgets
and visuals are all upstream code. A new visual in a later Strudel release should arrive
with a version bump and no work here.

**The file is a real VS Code `TextDocument`.** The Strudel editor is a
`CustomTextEditorProvider`. VS Code owns save, reload from disk, the dirty marker and
hot exit. Anything that edits the document (another editor, git, an agent) reaches the
webview as a change event.

## Parts

```
extension host (Node, may be remote)          webview (browser)
+--------------------------------+            +---------------------------------+
| extension.ts                   |            | main.ts                         |
|   commands, custom editor,     |  messages  |   StrudelMirror (upstream)      |
|   stage panel, mode toggle     | <--------> |     CodeMirror editor           |
| session.ts                     |            |     repl + scheduler            |
|   one webview <-> one document |            |     superdough (Web Audio)      |
| samples.ts                     |  files via |     @strudel/draw, hydra        |
|   samples/ -> sample map       | asWebviewUri   dock for widgets in stage     |
+--------------------------------+            +---------------------------------+
```

| File | Job |
|---|---|
| `src/extension/extension.ts` | Registers the custom editor `vstrudel.editor` and the commands. Owns the list of sessions. |
| `src/extension/session.ts` | Binds one webview to one document. Text sync, sample scan, HTML and CSP. |
| `src/extension/samples.ts` | Turns the samples folder into the map upstream `samples()` accepts. |
| `src/extension/sounds.ts` | The Sounds view: groups the sound list that the engine reports. |
| `src/extension/snippets.ts` | The Snippets view: reads the `.strudel` files under `lib/` and owns the view's webview. |
| `src/snippets-view/main.ts` | The page of the Snippets view: folders, cards, code colors. Built as `dist/snippets-view.js`. |
| `src/shared/snippet.ts` | Splits a snippet file into header fields and code. |
| `src/shared/context.ts` | The rules that name a slider or a visual from the code around it. `context.test.ts` holds the cases. |
| `src/extension/packs.ts` | Downloads the remote sample packs a song loads into `.vstrudel/cache/`. |
| `src/shared/packs.ts` | Finds `samples('github:...')` in a song and resolves the name to an address. |
| `src/shared/protocol.ts` | Message types and `diffText`, used by both sides. |
| `src/webview/main.ts` | Creates `StrudelMirror`, syncs text, handles play and stop, fills the stage dock. |
| `src/extension/firmware.ts` | Lists the VIBE FM firmwares in the `firmware/` folder. See "Firmware" |
| `src/webview/vibe/core.ts` | Hosts one firmware `.wasm` and renders its sound. No Web Audio in it, so the tests run it. `core.test.ts` holds the cases |
| `src/webview/vibe/worklet.ts` | The AudioWorklet processor around `core.ts`. Built as `dist/vibe-worklet.js` |
| `src/webview/vibe/index.ts` | Registers each firmware as a superdough sound and sends it notes, clock and transport |
| `scripts/build.mjs` | esbuild: `dist/extension.cjs` (Node, CommonJS), `dist/webview.js` (browser, ESM) and `dist/vibe-worklet.js` (an AudioWorklet script). |
| `scripts/smoke/` | The webview bundle in a plain browser with a fake `acquireVsCodeApi`. Muted. |
| `src/test/m0.ts` | Integration test that runs inside VS Code and records what happened. |
| `scripts/test-vscode.mjs` | Starts VS Code with that test and prints the result. |

## Layouts

One webview bundle runs in two layouts. The layout is the `mode` field of the `init`
message.

| Layout | Where | What shows |
|---|---|---|
| `editor` | Custom editor tab for the `.strudel` file | Code in CodeMirror, widgets inline in the text |
| `stage` | Panel beside the native text editor | No code. Widgets in a dock, global visuals behind |

The toggle command (`vstrudel.toggleMode`, title bar button, Ctrl+Alt+M) runs
`vscode.openWith` on the same file with the other editor type. Opening the Strudel
editor closes the stage of that file, so one file never has two engines.

Each webview has its own engine today. Switching layout destroys one webview and creates
another, so the sound stops on a switch. See `doc/TODO.md` for the open question.

## Messages

| Direction | Message | Meaning |
|---|---|---|
| webview -> host | `ready` | The page loaded and wants its content |
| host -> webview | `init {text, mode, samples}` | Document text, layout and the sample map |
| webview -> host | `edit {text}` | The user changed the code in CodeMirror |
| host -> webview | `update {text}` | The document changed from somewhere else |
| host -> webview | `play`, `stop` | A VS Code command was run |
| host -> webview | `samples {samples}` | The samples folder changed. Register the new map |
| host -> webview | `packs {packs}` | The remote sample packs of the song, with the cached copy of the ones we have |
| host -> webview | `preview {name, index}` | Play one sound once |
| host -> webview | `insert {text}` | Insert at the cursor of the Strudel editor |
| host -> webview | `slider {index, value}` | Move a slider of the stage, as a drag would |
| webview -> host | `sounds {sounds}` | The engine's sound list, sent after loading and after every change |
| webview -> host | `started {started}` | The scheduler started or stopped |
| webview -> host | `log {level, message}` | Goes to the `vstrudel` output channel |

## Text sync

Both sides send the whole text and apply only the difference. `diffText` finds the one
smallest replacement between two texts, so a change far from the cursor does not move
the cursor.

The host remembers the text the webview is known to hold (`Session.known`). A document
change equal to that text is our own echo and is not sent back. The webview sets a flag
while it applies a remote change, for the same reason.

Edits from the webview are applied one at a time through a promise queue. Each edit is a
diff against the document. A second diff computed before the first has landed would
corrupt the text.

## Samples

`scanSamples` reads the folder named by the setting `vstrudel.samplesFolder` (default
`samples`). We take the one nearest to the file: beside it, or in a parent folder, up to
the workspace root. A song in a subfolder of a bigger repo then still finds its own
samples. A subfolder is a sound name and its
audio files are the numbered variations. An audio file directly in the folder is a sound
named after the file. The URLs come from `asWebviewUri`.

A watcher on the samples folder sends a new map to every open webview when files are
added or removed, so a new sample works without a reload. A removed sample stays
registered in the engine until the webview is reloaded.

## Default sounds

The webview loads the sounds strudel.cc loads. The list is the one upstream publishes
in `@strudel/repl` (`prebake.mjs`, 1.3.0): synths, ZZFX, the General MIDI soundfonts
from `@strudel/soundfonts`, and six sample maps from `raw.githubusercontent.com`
(`tidal-drum-machines`, `piano`, `Dirt-Samples`, `vcsl`, `mridangam`, `uzu-drumkit`),
plus the drum machine aliases. We add the tag `drum-machines` to two of them, as the
website does, so the view can group them. The list is ours to keep in step with
upstream.

Only the maps are downloaded at start. An audio file is fetched when it is first played.

The first play waits for the packs for up to 6 seconds. Without the wait, the first play
on a slow network said `sound bd not found`. With the cap, offline use still starts.
Each pack gets three tries, and a try that has no answer after 15 seconds is given up.
One run without retries lost every pack until the window was closed.

## Sounds view

superdough keeps every sound it can play in `soundMap`. The webview sends that list to
the host after loading and again whenever it changes (300 ms after the last change,
because a pack registers hundreds of sounds one by one). The view never has a list of
its own, so it shows exactly what can be played, including the workspace samples.

`SoundsProvider` sorts the list into groups: local samples, one group per remote pack,
samples, drum machines, synths, soundfonts, wavetables, other. A sound with numbered
variations opens into `name:0`, `name:1` and so on, up to 64.

Drum machines and remote packs have one more level, the bank. Such a sound is named
`<bank>_<sound>`, for example `RolandTR909_bd` or `crate_bd`, and the bank is everything
before the last underscore. Under a bank the row shows the short name `bd`. A prefix
that only one sound has is not a bank, and that sound stays a plain row.

A click on a sound types its full name at the cursor (`RolandTR909_bd`, which is valid
anywhere). When preview is on, the click also plays the sound once through
`superdough()`, with the note `a3` for anything that is not a plain sample list, as the
sounds tab of strudel.cc does. The speaker button at the top of the view turns preview
on and off. It is two commands that swap on the context key `vstrudel.previewSounds`,
and the choice is kept in `globalState`. The play button on a row plays without typing.
The button on a bank types `.bank("RolandTR909")`.

The icons are our own files in `media/icons/`: a drum, a keyboard, a wave for samples,
a note for soundfonts. VS Code's icon set has no drum. A tree draws an icon as an image,
so it cannot take the color of the theme, and each icon exists as a light and a dark
file.

The view is empty until a `.strudel` file is open, because the list lives in an engine.

Measured in VS Code 1.130: 151 samples, 1347 drum machine sounds in 138 banks, 25
synths and 125 soundfonts are listed, and one sound of each group plays.

## Snippets view

`SnippetsView` lists every `.strudel` file under a folder named by `vstrudel.libFolder`
(default `lib`), anywhere in the workspace. One file is one snippet. A watcher refreshes
the list when a file is added, removed or saved.

The view is a webview view, not a tree. A tree row is one line of plain text, and a
snippet needs a card: the header fields as a table, the code in color, and buttons. The
page (`src/snippets-view/main.ts`) groups the snippets by the folder they are in, with a
filter box on top. A click opens the card in place. A double click opens the file in the
native editor. "Insert at cursor" inserts the code without the header.

The colors of the code come from a regular expression that knows comments, strings,
numbers, keywords, `$name:` labels and function calls. VS Code does not let a webview
use the editor's highlighter, and a preview does not need a parser.

Inserting goes to the Strudel editor when it is the active tab, and to the native
editor otherwise. `window.activeTextEditor` is undefined while the Strudel editor is
active, because it is a webview.

### Snippet header

A snippet describes itself in comments at the top of the file. The form is the one
Strudel uses for the metadata of a song, so a snippet is still an ordinary Strudel
file:

```
// @title Four on the floor
// @category drums
// @details Kick on every beat, clap on 2 and 4, open hat on the off beat.
// @tags house, techno, 909
// @by alienmind
// @credits Switch Angel
s("bd*4, ~ cp ~ cp, [~ oh]*4").bank("RolandTR909")
```

`parseSnippet` reads `// @name value` lines, the same lines inside one block comment,
and the older upstream form `// "title" @by author`. The header ends at the first line
that is neither. A file whose top comment has no field has no header, and the comment
stays in the code. Every field is shown in the card. `@title` names the row, `@category`
picks the color, `@tags` become chips. The categories are `drums`, `bass`, `melody`,
`chords`, `texture`, `effect`, `function`, `song` and `visual`.

## Remote sample packs

A song can load a pack by name: `samples('github:eddyflux/crate')`. Three things happen
around that call, none of which change upstream.

**The pack is found before the song plays.** The host scans the text of the document
for `samples('github:...')` (`findPackSources`), on open and 1.5 seconds after the last
edit, and tells the webview. The webview registers the pack at once, so its sounds can
be browsed and previewed before the first play.

**The pack gets a group in the Sounds view.** The song's scope has our own `samples`
(`taggedSamples`), put after `@strudel/webaudio` in `evalScope`. It calls the real one
and adds the pack's name as the `tag` when the first argument is a name. The view makes
a group of every tag that starts with `github:`.

**The pack is copied into the workspace.** `PackCache` downloads the sample map and
every file it names into `.vstrudel/cache/github/<user>/<repo>/<branch>/`, six at a
time, with progress in the status bar. A file `.complete` is written last, and only a
folder that has it is used. Then the webview is told again, with the map and the
webview address of the folder. Upstream lets us answer for a prefix
(`registerSamplesPrefix('github:', ...)`): a cached pack is answered from the workspace,
any other is fetched as upstream would.

`.vstrudel/` has its own `.gitignore` with `*` in it, so the cache is never committed
and the `.gitignore` of the project is not touched.

A pack is left on the network when it has more files than
`vstrudel.remoteSamples.maxFiles` (default 600), or when its map uses more than one
base address. `vstrudel.remoteSamples.cache` turns the cache off.

Not covered: a pack loaded through a full `https://` address, and a `github:` name used
as the second argument of `samples()` with a map written in the song.

## The template

`template/` is what a user starts from, and what every test opens.

| Path | Holds |
|---|---|
| `demo.strudel` | "Sea of Souls (club mix)" by the maintainer. The test plays it on every run. It uses the vocals in `samples/sos-vocals/` |
| `examples/` | Songs to learn from: three of ours, Hydra visuals, `coastline` from Strudel's own examples, and "Array (Lil Data Edit)" |
| `lib/` | Snippets by category, one folder each |
| `samples/` | Local samples |

Rules for what goes in:

- A file by somebody else is only copied when it has a license that allows it. Its
  header keeps the author and the license. A change we made is said in a comment
  (`06-array-lil-data-edit.strudel` lost two calls that only exist on strudel.cc).
- A technique learned from somebody without a license on their code is written again
  as our own code, and the snippet names the person in `@credits`.
- The integration test plays every file in `lib/` and `examples/`. That is how we know a
  function or a sound name exists in the pinned Strudel version.
## Starting audio

A webview does not start an `AudioContext` without a real click inside it. Measured in
VS Code 1.130: after a play that came from a VS Code command, `context.resume()` never
resolves and `navigator.userActivation` is false. The Chromium switch
`--autoplay-policy=no-user-gesture-required` did not change that. `initAudio()` from
superdough resolves without resuming the context, so we call `resume()` ourselves.

So `withAudio()` in the webview tries to resume for 1.5 seconds. If the context is still
suspended it shows the overlay "Click to enable audio" and remembers what was asked. The
click on the overlay is the gesture, and the remembered action runs. Play and sound
preview both go through it. This happens once per webview. Playing with Ctrl+Enter
inside the Strudel editor does not need it, because the user has already clicked in the
code.

Not measured: whether a real key press in the native editor counts as a gesture for the
stage. The test sends commands, which is not a key press.

## The stage

In the stage the code is hidden, so what the code would show inline is laid out as rows
in two groups: **Sliders**, then **Visuals**. Each row has a label on the left and the
slider or the canvas on the right.

### Visuals

Inline widgets (`._scope()`, `._pianoroll()`) draw on a canvas they look up by id and
create only when it is missing. Upstream then gives that canvas to CodeMirror. So:

1. Before the code runs, we transpile it ourselves with the same options, get the
   widget ids with `getWidgetID`, and put a canvas with that id in each row. A canvas
   that is already there is kept, so an update does not flash.
2. After the code runs, we clear CodeMirror's widget decorations with `updateWidgets`
   and move each canvas back to its row.

Step 2 must clear the decorations first. Moving a canvas out while CodeMirror still owns
it does not hold, see `doc/DRAWER_OF_FAILED_IDEAS.md`.

### Sliders

The transpiler reports every `slider(value, min, max, step)` with the position of its
first argument. Upstream keeps the value of a slider under the id `slider_<position>`
and listens for a window message `cm-slider` to change it. A slider row in the stage
does the two things the inline slider does:

- It posts `cm-slider`, so the sound changes at once.
- It writes the new number into the code: a change in the hidden editor, which travels
  to the VS Code document like any other edit. This is held back for 150 ms, because a
  drag fires an event per pixel and each one would be an edit in the document.

The position of each number is kept up to date with `ChangeSet.mapPos` on every change
of the document, ours or anyone's.

The host can move a slider too (`slider {index, value}`). The test uses it, and a MIDI
controller mapped to a slider will.

### Labels

A label has to say which part of the song a row belongs to, and the language has no
name for that. `src/shared/context.ts` works one out from the code around the widget.
It is guessing by rule. The rules are written at the top of that file in the order they
are tried, and every label carries the name of the rule that gave it, which the stage
shows as a tooltip.

For a visual: the name of the pattern (`$kick:` or `kick:`), else the name of a
variable, else the comment right above the expression, else the start of the code.

For a slider: the variable it is assigned to (`const KICK_VOL = slider(...)` gives
"kick vol"), else the property it is the value of, else the call it is an argument of
(`.lpf(slider(...))` gives "lpf", with the name of the pattern in front when there is
one), else a comment, else the line.

A comment only counts when it reads as words: a banner drawn with characters, a ruler
of dashes and a `@field` line are skipped.

To tune a rule, add the code that got a wrong label to `src/shared/context.test.ts`
first, then change `context.ts`. `pnpm test:unit` runs the cases.
## Firmware

A VIBE FM firmware from thefirmwarehub.com plays as a sound: `note("c2 eb2").s("vibe_obervave")`. A firmware is one
`.wasm`, built from its own C source with the VIBE FM SDK. The same file runs in the VIBE FM VST plugin, the hub's
browser Playground and the VIBE FM hardware. We host it ourselves in the webview, so it needs no MIDI and works in
Codespaces.

**Where firmwares come from.** `scanFirmware` reads the folder named by `vstrudel.firmwareFolder` (default
`firmware`), found the same way as the samples folder: beside the song or in a parent folder. Two layouts:
`<id>.wasm` with `<id>.json` beside it (the SDK repo's `firmwares/`), or `<id>/*.wasm` with `firmware.json` (an
unzipped package from the hub). The json gives name, author, version and license. The `.wasm` goes to the webview
as an `asWebviewUri` address, like a sample. A watcher sends the list again when the folder changes. Downloading
from the hub is not built yet, see `doc/TODO.md`.

**The sound name** is `vibe_` and the id, with everything but `a-z0-9` turned into `_` (`firmwareSound`). It has to be
one word: mini-notation reads `vibe:obervave` as the sound `vibe` with variation `obervave`. We tried that first.

**The host.** `VibeCore` is written from the SDK's Apache-2.0 headers and `sdk/src/vibe_sdk.c`. The SDK's browser
emulator (`emulator/`) is closed, all rights reserved, and nothing comes from it. The contract we use:

| Part | What |
|---|---|
| Imports, module `env` | `vibe_host_log(ptr, len)`, `vibe_host_request(what)` (ignored), `vibe_host_store(op, name, nameLen, data, len)` |
| Store ops | 0 read, 1 write, 2 size, 3 delete, 4 list (names, one per line), 5 read at the offset in the first 4 bytes. Kept in memory. 6 and up (media) answer -1 |
| Start | `vibe_sdk_version()` must be 1 to 8 (it is the host protocol, 7 in SDK 27), then `vibe_wasm_init(sampleRate)` |
| Audio | `vibe_wasm_io()` points at four float buffers of 256 frames: in, out L, out R, in 2. `vibe_wasm_audio(frames, 0)` fills out L and R. `frames` may be 1 to 256 |
| Events | `vibe_wasm_event(type, id, down, value, midi)`. We send type 5 (MIDI, the three bytes packed little-endian in `midi`), 8 (transport: id 0 play, id 1 tempo) and 10 (parameter) |
| Parameters | `vibe_wasm_param_count/info/value/set`. The info is a struct on wasm32: id, name (pointers), min, max, def (floats), unit (pointer), steps |
| Position | `vibe_wasm_transport()` points at a table we fill before every block: has, playing, bpm, time signature, beat (quarter notes), bar start |

`VibeCore.render` cuts a block at every queued event, so a note starts on its own frame. That is what the SDK asks a
host to do. It also remembers which notes are on, so that `stop()` can end them: a firmware does not have to know CC
123.

**In the webview.** One `AudioWorkletNode` runs one firmware on one orbit. superdough's `onTrigger` for a firmware
returns nothing, and superdough then skips the hap's own effects chain. The hap only sends a note on at
`round(t * sampleRate)` and a note off at the end of its duration, in context frames. The node is connected to the
orbit's `summingNode`. So the orbit's filter (`djf`) and ducking apply, a hap's own effects (`room`, `delay`, `lpf`,
`pan`, `gain`) do not. `note`, `n` with `scale`, `freq`, `velocity` and `midichan` (the track of a firmware with
tracks) are read. The compiled `WebAssembly.Module` is passed to the worklet in `processorOptions`.

**Clock.** With each note and on play and stop, the page sends the scheduler's cycle at the current context frame and
its cps. The worklet turns that into the firmware's position: one cycle is a bar of four quarter notes, so the tempo
is `cps * 240` BPM. On stop the page empties the firmware's queue, ends its notes and sends "play off".

## Content Security Policy

The webview CSP is relaxed in five places. Each one has a reason:

| Rule | Reason |
|---|---|
| `script-src 'unsafe-eval'` | Strudel evaluates the user's code |
| `script-src data:` | superdough loads its AudioWorklets from `data:` URLs |
| `script-src https://unpkg.com` | Upstream `initHydra()` imports `hydra-synth` from there at run time |
| `style-src 'unsafe-inline'` | CodeMirror and the Strudel themes inject style elements |
| `connect-src https:` | Sample packs from the network |

## Upstream facts

Read from the 1.2.6 / 1.3.0 packages in `node_modules`:

- Every `@strudel/*` dist imports its siblings as external packages, so the bundle has
  one copy of `@strudel/core` as long as the versions line up. We pin exact versions for
  that reason. A second copy of core would break pattern registration.
- The inline widgets are registered in `@strudel/codemirror` (`widget.mjs`), not in the
  website. That is why hosting `StrudelMirror` gives us all of them.
- `StrudelMirror` calls its `beforeEval` option with no arguments. The code has to be
  read from `mirror.code`.
- `StrudelMirror` sets an inline `display: block` on its root. Hiding the root needs
  `!important`.
- `StrudelMirror` builds the editor state itself and takes no extra extensions. We add
  our change listener afterwards with `StateEffect.appendConfig`.
- `@strudel/core` has a `SharedWorker` clock that is only used with the `sync` option.
  We do not use it.
- `initHydra()` creates its own canvas through `getDrawContext` and takes a `src` option
  for where to load `hydra-synth` from.

## Measured

In VS Code 1.130.0 on Windows (Electron 42, Chrome 148), with `pnpm test:vscode`:

| What | Result |
|---|---|
| The webview loads under our CSP and shows the document | Works |
| AudioWorklets load from `data:` URLs | Works |
| Audio starts after a click in the webview | Works |
| Audio starts from a command with no click | Does not. See "Starting audio" |
| A sample from `samples/` is fetched through `asWebviewUri` and decoded | Works (`blip`, 15.5 KiB in 16 ms) |
| Samples from `github:tidalcycles/dirt-samples` load | Works |
| Inline scope and piano roll are created in the editor | Works |
| The engine keeps running while its tab is hidden for 6 seconds | Works. Timing was not measured |
| `vscode.openWith` swaps the tab in place, both directions | Works. The command returns in 110 to 140 ms |
| Stage: opens on play from the native editor, widgets in the dock | Works |
| An edit to the document reaches the stage | Works |
| Hydra: `hydra-synth` loads from unpkg.com and creates its canvas | Works |
| `canPlayType` for wav, mp3, ogg, opus, flac, aac | All supported |
| `crossOriginIsolated` | false. `SharedArrayBuffer` is not available |
| WebMIDI (`navigator.requestMIDIAccess`) in the webview | Refused: "Midi has been disabled in this document by permissions policy" |
| WebGPU (`navigator.gpu.requestAdapter`) in the webview | Works, with a hardware adapter |
| The Sounds view lists the default packs and the local samples | Works |
| Preview of a local sample, a sample, a drum machine sound, a synth and a soundfont | Works |
| A new folder under `samples/` appears in the list without a reload | Works |
| Insert a sound name into the Strudel editor, and a snippet into the native editor | Works |
| Audio outputs seen by the webview (`enumerateDevices`) | 1, without a label. `AudioContext.setSinkId` exists |
| A native MIDI module (`@julusian/midi`) in the extension host's runtime | Loads, lists inputs and outputs, sends in 0.05 ms |
| A 20 ms timer in the extension host's runtime, Windows | Late by 10 ms in the middle, 16 ms at the 95th percentile, 80 ms at worst |
| Drum machine banks in the Sounds view | 138 |
| Every file in `template/lib` and `template/examples` plays | 27 files, no error |
| A song with `samples('github:eddyflux/crate')`: sounds listed before the first play | Works, 18 sounds |
| The same pack copied to `.vstrudel/cache/` and then answered from there | Works: 367 files, 175 MB |

The test cannot hear or see. "Works" for audio means the `AudioContext` is running, the
scheduler started and the samples decoded. It does not prove sound came out of the
speakers, or that a canvas shows the right picture.

In headless Chrome 148 on Linux, with the webview bundle in a page like `pnpm smoke`, and `obervave.wasm` from the
VIBE FM SDK repo (OBERVAVE 3.4, GPL-3.0), on 2026-11-20:

| What | Result |
|---|---|
| A firmware compiled in the page and passed to an AudioWorklet in `processorOptions` | Works |
| `note("c2 eb2 g2 bb2").s("vibe_obervave")` through superdough to the output | Sounds: peak 0.218. Silent after stop |
| OBERVAVE's start | Host protocol 7, 236 parameters, logs "OberVave 3.4 (native VIBE)" |
| A note sent for frame 24000, rendered offline | First sample above 1e-4 at frame 24005 |
| CPU, rendered offline, each firmware holding a 4-note chord, Xeon at 2.1 GHz | 1 firmware: 1.1% of real time. 4 firmwares: 5.0% |

Not measured yet: inside VS Code, and in Codespaces.

In Chrome, with `pnpm smoke`: the editor, inline widgets, slider, note highlighting,
text sync in both directions and the stage dock were also checked by looking at the
page.

Looked at in screenshots of the same test: the Sounds view with its icons and banks, a
snippet card with its table and colored code, the inline scope, piano roll and slider,
the outlines on playing notes, and Hydra shapes behind the code.

In Codespaces, by hand, with version 0.0.1: a new Codespace installs the extension by
itself and `demo.strudel` plays with sound in the browser.

## Integration test

`pnpm test:vscode` builds the extension and runs `src/test/m0.ts` inside VS Code, in a
throwaway profile. The test drives the extension through its commands and reads the logs
of the webviews through the object that `activate` returns. It records facts instead of
asserting them and prints them as JSON.

It downloads a stable VS Code into `.vscode-test/` once. Set `VSCODE_EXE` to use one you
already have. An installed VS Code with an update pending refuses to start a second
instance.

Nobody can click the audio overlay in a test. The runner clicks it through the Chrome
DevTools Protocol (`--remote-debugging-port`), with `Runtime.evaluate` and
`userGesture: true`. It first looks for the overlay without `userGesture`. An evaluation
with `userGesture` gives the page user activation even when it clicks nothing, and that
hid the fact that a click was needed.

The test can ask for a picture of the whole window. It drops a `<name>.request` file,
the runner takes a screenshot with `Page.captureScreenshot` and writes
`tmp/shots/<name>.png`. This is how we look at the UI without a person. The pictures in `doc/` that
`doc/ABOUT.md` shows are copies of these.

## Build pipeline

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests and on tags. It
installs with pnpm, type checks, runs the unit tests, and builds the `.vsix`, which it
uploads as an artifact. On a tag `v*` it also checks that the tag matches the version in
`package.json` and creates a GitHub release with two files: `vstrudel-<version>.vsix`
and `vstrudel.vsix`. The second has a fixed name so that
`releases/latest/download/vstrudel.vsix` always works.

The integration test does not run in CI yet.

## Codespaces

The extension is not on the Marketplace, so a devcontainer installs the `.vsix` itself.

| File | For | Gets the extension from |
|---|---|---|
| `.devcontainer/devcontainer.json` | Working on the extension | Builds it from the checkout |
| `.devcontainer/template/devcontainer.json` | Trying the template from this repo. Opens `template/` | The latest GitHub release |
| `template/.devcontainer/devcontainer.json` | The template once it is its own repo | The latest GitHub release |

All three install with `code --install-extension` in `postAttachCommand`, because the
`code` command needs a connected editor. Measured in Codespaces: the command runs there
and reaches the installer ("Installing extensions on Codespaces").

The source configuration uses `scripts/codespace-install.sh`. `build` makes the `.vsix`
in `postCreateCommand`, and `install` installs it on attach and builds first when the
file is missing. The `.vsix` is kept in the home folder. The two template configurations
do the same in one command with `curl`.

Measured by hand: in an existing Codespace, `bash scripts/codespace-install.sh install`
built the `.vsix` and installed the extension. A new Codespace then came up with the
extension installed and played `demo.strudel` with sound. We did not record which of
the configurations that new Codespace used.

## Tooling

- pnpm 11 ignores the `pnpm` field in `package.json`. Build scripts are allowed in
  `pnpm-workspace.yaml` under `allowBuilds`.
- `package.json` has `"type": "module"`, so the extension host bundle is written as
  `dist/extension.cjs`.
- `vsce package` is run with `--no-dependencies` because everything is bundled.
- `vsce package` stops and asks a question in a terminal when `package.json` has no
  `repository` field. In a Codespace that hangs the container build. Keep the field.

## Public page

`doc/ABOUT.md` is shown at <https://www-alienmind.vercel.app/vstrudel/index.html>. The
home page repo, `alienmind-www`, has this repo as the git submodule `projects/vstrudel`.
Its `scripts/build-docs.ts` turns `doc/ABOUT.md` into `public/vstrudel/index.html` and
copies the images that sit in `doc/`. The card on the front page is an entry in
`src/App.tsx` there, with `public/vstrudel.png` as its picture.

The generated page is committed in `alienmind-www`, so a change here does not show by
itself. To publish a new `doc/ABOUT.md`:

```
cd ../alienmind-www
git submodule update --remote projects/vstrudel
pnpm build:docs
git add projects/vstrudel public/vstrudel
git commit -m "chore: refresh the vstrudel page"
git push
```

Vercel deploys on the push. It was live 40 seconds after the first one.

## Two copies of the extension

A maintainer's machine has two copies, so that work in progress never changes the
editor the maintainer is working in.

| Copy | Where | Who loads it | Changes when |
|---|---|---|---|
| Work in progress | `dist/` | Only an Extension Development Host: F5, or `pnpm test:vscode` with its throwaway profile | Any build, at any moment |
| Promoted | `.bin/vstrudel.vsix`, installed into the maintainer's VS Code | Every normal VS Code window | Only when `pnpm promote` runs |

`pnpm promote` makes a production build, packages it into `.bin/`, installs it with
`code --install-extension --force`, and puts the development build back in `dist/`.
`.bin/PROMOTED.txt` records which build that was. `.bin/` is not in git.

The installed copy is a copy. VS Code unpacks the `.vsix` into its own extensions
folder, so later builds in `dist/` do not reach it. A running window keeps the old copy
until "Developer: Reload Window". Nothing outside VS Code can trigger that.

A build that is not exactly a release tag is packaged as `<version>-dev.<time>`, for
example `0.0.3-dev.20261120051037`. `package.json` in the repo is not changed. We do
this because of what we saw once: a second install of the same version, 0.0.3 over
0.0.3, was correct on disk, but after "Restart Extension Host" the window still showed
the old side panel title and icon. We expect that VS Code treats an extension with the
same id and version as unchanged. Not proven, and not yet confirmed that the unique
version cures it.

In a development host the work in progress wins over the installed copy, because VS
Code prefers the extension under development with the same id.

To see which copy a window runs: the first line of Output > `vstrudel`, or the command
"vstrudel: Show version and build". It shows the version, the `git describe` of the
build, and `production` or `development`.

For fast work on the work in progress: `pnpm watch`, press F5 once, and use "Developer:
Reload Window" in the development host after a change.

## Release

The maintainer decides when there is a release. Work between releases is committed
without changing the version, without a tag and without `pnpm promote`.

1. Set the new version in `package.json`. Update `doc/ABOUT.md` and `README.md` when a
   user can do something new.
2. `pnpm typecheck`, `pnpm test:unit` and `pnpm test:vscode` pass.
3. Commit and push the feature branch, and open a pull request. The maintainer merges
   it. Then tag `v<version>` on `main` and push the tag. The pipeline builds the GitHub
   release.
4. `pnpm promote`, so the maintainer's own VS Code gets the same build. It warns when
   the checkout is not exactly the tag. Tell the maintainer to run "Developer: Reload
   Window".
5. When `doc/ABOUT.md` changed, refresh the home page (see "Public page").

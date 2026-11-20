# Drawer of failed ideas

Approaches we tried or designed and then dropped, with the reason. Check here before
starting a spike.

Each entry says whether the idea was **tried** (we ran it) or **designed** (we dropped
it on paper).

## Sound engine in the extension host

Designed. In Codespaces the extension host runs on a remote machine with no sound card.
The engine has to be in the webview, which runs in the user's browser.

## A local HTTP server for samples

Designed. `@strudel/sampler` or our own server on a port works on desktop. In Codespaces
a forwarded port needs an authenticated request, and a `fetch` from the webview does not
carry that. `asWebviewUri` serves workspace files in both places with no port.

## A database for storage

Designed. The idea was a backend in a web worker with pglite. Strudel's backend only
shares patterns publicly. Everything else it stores is browser storage for settings and
user samples. In vstrudel the workspace files are the storage, so there is nothing for
a database to hold.

## The gugelhupf fork of Strudel

Designed. `m4l-gugelhupf` uses `github.com/alienmind/strudel`, which carries patches
for Max for Live. We use upstream `@strudel/*` from npm, with no fork and no submodule,
so new Strudel releases reach us with a version bump.

## Our own visuals panel

Designed. The first plan was a companion panel beside the native editor that rendered
scopes, piano rolls and sliders with our own code. Every new upstream visual would have
needed work here. Hosting upstream `StrudelMirror` gives all of them for free, in the
editor layout and, through the dock, in the stage layout.

## The whole strudel.cc website in a webview

Designed. `m4l-gugelhupf` overlays the built website REPL with a shim. That brings its
own file handling, settings and layout, which fight with VS Code owning the files. The
packages give the editor and engine without the site.

## Moving widget canvases out of CodeMirror

Tried, in Chrome with `pnpm smoke`. In the stage layout we moved the widget canvases
from the hidden editor to the dock after each evaluation. They ended up back in
`.cm-content` and the dock stayed empty: CodeMirror restores the DOM of its own
decorations. What works is clearing the widget decorations with `updateWidgets(view,
[])` first and then moving the canvases.

## Turning a VST3 binary into wasm

Designed. The idea was to drop a `.vst3` file on the extension and have it converted to
wasm. A VST3 is compiled native code tied to the operating system (its GUI, threads and
file access). There is no practical translator from that binary to wasm. The wasm route
needs the plugin's source, recompiled.

## A skill that decompiles commercial VST3 plugins into WAM

Designed. Two reasons. Technically, a decompiler plus a model can recover a small piece
of DSP such as a filter, but not megabytes of optimized code and a GUI framework, so the
result would be an approximation. Legally, most plugin licenses forbid reverse
engineering, the result is likely a derivative work, and many plugins have copy
protection. We will not build it for plugins we do not hold the rights to. The useful
version is porting open-source plugins from source, see `doc/TODO.md`.

## Starting audio without a click

Tried, in VS Code 1.130 with `pnpm test:vscode`. A play that comes from a VS Code
command has no user gesture inside the webview, and `AudioContext.resume()` never
resolves. We started VS Code with the Chromium switch
`--autoplay-policy=no-user-gesture-required`. VS Code passed it on with a warning and
the result did not change. Even if it had worked, a user cannot be asked to start VS
Code with a switch. The overlay that asks for one click stays.

## Playing before the default sample pack has loaded

Tried. The first version started loading `github:tidalcycles/dirt-samples` and did not
wait, as strudel.cc does. On a slow network the first play logged `sound bd not found`.
The first play now waits for the packs, for at most 6 seconds.

Waiting was not enough either. In one run every pack failed to load and nothing tried
again, so `bd` stayed missing until the window was closed. Each pack now gets three
tries.

## Testing in the installed VS Code by default

Tried. Starting a second instance of the installed VS Code failed with "Code is
currently being updated" while an update was pending. The test runner downloads its own
stable build unless `VSCODE_EXE` is set.

## Passing the .vsix from create to attach through /tmp

Tried, in the first Codespace. `postCreateCommand` built the `.vsix` and copied it to
`/tmp/vstrudel.vsix`, and `postAttachCommand` installed from there. On attach the file
did not exist (`ENOENT`). The cause showed up later: `vsce package` asked "Do you want
to continue? [y/N]" because `package.json` had no `repository` field, and nobody answers
a question during create. CI did not ask, so the pipeline passed. `package.json` now has
the field. The install step also builds or downloads the file itself when it is missing,
and keeps it in the home folder.

## Loading a .vsix from a folder through .vscode settings

Designed. The idea was a folder such as `.bin/` whose `.vsix` the editor loads by
itself, set up in `.vscode/`. VS Code has no such setting. `.vscode/extensions.json`
only recommends extensions by Marketplace id. We keep the folder and add an install
step (`pnpm promote`).

## The promoted copy as a local workspace extension

Designed. VS Code 1.89 and later offers an unpacked extension under
`.vscode/extensions/<name>/` for install in that workspace. That is the closest thing
to loading from a folder. We did not use it because it only applies to windows opened on
this repo, and the maintainer also writes music in other folders. We did not test how it
picks up a changed copy.

## Linking the source folder into the VS Code extensions folder

Designed. A link from `~/.vscode/extensions/` to this checkout makes every build live
in the maintainer's editor. That is the opposite of what we want: an agent's half
finished build would break the editor the maintainer is working in.

## WebMIDI in the webview

Tried, in VS Code 1.130 with `pnpm test:vscode`. `navigator.requestMIDIAccess()` in
the webview fails with `SecurityError: Midi has been disabled in this document by
permissions policy`. VS Code builds the frame of a webview and does not allow `midi` in
it. An extension cannot change that. So upstream `.midi()` cannot work inside our
webview, and MIDI devices cannot be listed from there. MIDI needs a bridge outside the
webview, see `doc/TODO.md`.

## Sending MIDI from a plain timer in the extension host

Tried, as part of the MIDI spike. The idea was that the webview posts each note with its
time and the extension host sends it with `setTimeout`. In the host's runtime on Windows
a 20 ms timer fired 10 ms late in the middle and 80 ms late at worst. That is audible. A
bridge needs a better clock, see "MIDI" in `doc/TODO.md`.

## Copying other people's examples that have no license

Designed. The maintainer's `algorave` repository has songs and helper code by other
people, kept with their names but without a license from them. A name is not a
permission, so we did not copy those files. We copied what has a license (`coastline`
from Strudel's own examples, "Array (Lil Data Edit)" under CC BY-NC-SA) and the
maintainer's own song. For the rest we wrote our own snippets with the same techniques
and put the name in `@credits`.

## One sound per firmware

Tried, in Chrome with the webview bundle. The first plan registered each firmware as its own sound,
`s("vibe:obervave")`. Mini-notation reads the colon as the variation: the sound `vibe`, number `obervave`, and
superdough said "sound vibe not found". We then named each sound `vibe_obervave`, which worked, but every firmware was
a separate sound and the firmware could not be a pattern value. Now there is one instrument, `vibefm1`, and the colon
does what it does for samples: `vibefm1:obervave` picks the firmware.

## FM-1 update packages (`.fwsc`) in vibefm1

Designed, with a fake file to check the message. The idea was to play SHRUB (Xfer's stripped-down Serum for the FM-1)
through `vibefm1` from `https://shrub.audio/editor/firmware/SHRUB.fwsc`. A `.fwsc` is the update package the FM-1's
updater writes to the device: M-VAVE's own firmware ships as `FM-1.fwsc`, and ChoralRoot ships a one-core and a
two-core `.fwsc` for the FM-1's processor. That is native code for the FM-1's chip, not wasm, and only the hub's
converter turns an FM-1 firmware into a VIBE FM `.wasm`, from its source. SHRUB's source is closed ("copyright 2026 Xfer
Inc. All rights reserved"), so nobody but Xfer can make that build. Playing a `.fwsc` would need an emulator of the
FM-1's chip. `firmware()` now says what the file is instead of failing on it as broken wasm. We could not fetch the
SHRUB file from our sandbox to look at its bytes; the claim rests on how the other `.fwsc` files are described.

## midichan as OBERVAVE's tracks

Designed, and wrong. The first hand test said `.midichan("<1 2>")` would switch between OBERVAVE's tracks. Its source
says otherwise: with its MIDI setting on OMNI, the default, every channel plays the selected track. Separate sounds come
from separate orbits.

## A panel with the SHRUB editor

Designed, and dropped. The idea was a webview panel that shows `shrub.audio/editor/`, so patches are made beside the
song. The editor would be a second synth with its own audio: not in our mix, not in time with the song, and with no MIDI
in or out, because a webview, and any frame inside it, may not use WebMIDI. It would be a browser tab inside VS Code,
only useful to edit patches for a real FM-1. We do not know if the site allows framing. A VIBE FM build of SHRUB
would make the panel unnecessary, see "SHRUB" in `doc/TODO.md`.

## Named patches after a second colon

Designed, and dropped. `vibefm1:shrub:lead_saw` was asked for. Strudel reads a second colon as gain, as in `bd:3:0.5`:
checked, `vibefm1:shrub:lead_saw` gives `{ s: 'vibefm1', n: 'shrub', gain: 'lead_saw' }`. Using gain as a patch name
would break `.gain()` on the same line. `.progNum(n)` picks a patch by number today. Names need each firmware to say
which name is which program, and the wasm gives a host no such list.

## Room and delay on a firmware through its orbit

Designed, and wrong. The first plan said a firmware on an orbit would get the orbit's `room` and `delay`. In superdough
1.3.0 those are sends that each hap sets up in its own chain, and a firmware has no chain per hap. Only what sits on the
orbit itself reaches it: its filter (`djf`) and ducking. See "Effects on a firmware" in `doc/TODO.md`.

## Starting every firmware of the folder at once

Designed, and dropped. To make a switch of firmware instant, the first plan started every firmware the first time
`vibefm1` played. A running firmware costs CPU even when silent (1.1% of real time for OBERVAVE with a chord, measured).
Now every firmware is only compiled then, which is the slow part of a first load, and runs from its first note.

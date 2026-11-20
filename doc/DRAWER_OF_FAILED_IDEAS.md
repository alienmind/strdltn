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

## `vibe:<id>` as the sound name of a firmware

Tried, in Chrome with the webview bundle. The plan said `s("vibe:obervave")`. Mini-notation reads the colon as the
variation: the sound `vibe`, number `obervave`, and superdough said "sound vibe not found". A firmware's sound name is
now one word, `vibe_obervave`, the same form as the `gm_` soundfonts.

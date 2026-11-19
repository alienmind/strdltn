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

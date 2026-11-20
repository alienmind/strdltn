# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

## In flight: 0.0.4

Work for the next release collects on the branch `feat/0.0.4`. The version stays 0.0.3
until the maintainer asks for the release.

| # | Feature | Size | State |
|---|---|---|---|
| 1 | README rewrite: say first that vstrudel is a VS Code extension that turns the editor into a Strudel IDE for `.strudel` files. Then the panels, then Codespaces as a way to keep music projects (fork the repo, open it in a Codespace) | Small | Not started |
| 2 | Icons in the Sounds view: a drum for drum machines, a keyboard for synths, and one each for samples, soundfonts and MIDI. Our own SVG files, because the VS Code icon set has no drum | Small | Not started |
| 3 | Drum machines grouped by bank: Drum machines -> RolandTR909 -> bd, cb, cr. The bank is the part of the name before the last `_` | Small | Not started |
| 4 | A click on a sound types its name at the cursor, and also plays it when preview is on | Small | Not started |
| 5 | Preview toggle: a button at the top right of the Sounds view, tooltip "Preview sound on click". The choice is remembered | Small | Not started |
| 6 | Snippets as a rich view: a click opens a card in place with a table of the header fields, the code with syntax colors, and an "Insert at cursor" button. A double click opens the file. This needs a webview view, a tree cannot show colored code or a table | Medium | Not started |
| 7 | Snippet headers: comment lines at the top of the file that the view reads and hides from the code preview. See "Snippet header" below | Small | Not started |
| 8 | MIDI devices as a group in the Sounds view, a click types the device name | Large | Blocked, see "MIDI" below |

### Snippet header

Proposed, not decided. Strudel already has a convention for metadata in comments
(`// @title`, `// @by`, `// @details`, `// @genre`). We use the same form, so a snippet
is still a normal Strudel file, and add two fields of our own. To check against the
upstream documentation before building.

```
// @title Four on the floor
// @category drums
// @details House beat with an open hat on the off beat.
// @tags house, 909
// @by alienmind
s("bd*4, ~ cp, [~ oh]*4").bank("RolandTR909")
```

Categories, a fixed list so the view can group and color them: `drums`, `bass`,
`melody`, `chords`, `texture`, `effect` (a chain to put on a pattern), `function` (a
helper to call), `song` (a starting point for a whole piece), `visual`.

### MIDI

Measured: a webview may not use WebMIDI. So neither a device list nor Strudel's own
`.midi()` works from our webview, on desktop or in Codespaces.

What could work, to try as a spike before promising the feature:
- Desktop: a native MIDI module in the extension host lists the devices and sends the
  notes. The webview gets a `.midi()` output that posts each note with its time to the
  host. Needs prebuilt binaries for every platform inside the `.vsix`.
- Codespaces: the extension host is remote and cannot see a device on the user's
  machine. The only route is a page outside the webview, in the user's browser, that
  owns WebMIDI. No design yet.

Listing devices without being able to play them is of little use, so the list and the
bridge are one piece of work.

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
## Next: test by hand

`pnpm test:vscode` passes in VS Code 1.130 and we looked at its screenshots (see
"Measured" in `doc/ARCHITECTURE.md`). It cannot hear. Version 0.0.1 was heard on
desktop and in Codespaces. Version 0.0.2 adds the Sounds and Snippets views, and nobody
has listened to those.

Target: **desktop VS Code, F5 on this repo**, or **a new Codespace on `main`** with the
configuration "vstrudel template (released extension)".

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Open `demo.strudel`, click in the code, press Ctrl+Enter | Sound, as before |
| 2 | Click the vstrudel icon in the activity bar | A Sounds view with groups and counts, and a Snippets view with `drums` |
| 3 | Open "Drum machines" and click a few sounds | Each one is heard once |
| 4 | Open "Soundfonts" and click `gm_piano` | A piano note |
| 5 | Open "Local samples", click `blip` | The blip |
| 6 | Put the cursor inside a `s("...")`, press the insert button on a sound | The name is typed at the cursor |
| 7 | Copy a folder with a few `.wav` files into `samples/` | It appears under "Local samples" in a few seconds, and plays |
| 8 | Put the cursor on an empty line, click `drums` in Snippets | The text of `lib/drums.strudel` is inserted |
| 9 | Press the swap button, then Ctrl+Enter in the native editor | The stage opens. Note whether it plays at once or asks for a click |

Expected still broken: sound stops on every mode switch, and sliders are missing in the
stage.

Report the result by check number. When something fails, add the content of Output >
`vstrudel`.

## Open questions

- Does a real key press in the native editor count as a click for the stage? A command
  sent by the test does not. Check 9 answers it.
- Does the scheduler keep exact time in a hidden tab? The test only saw that it kept
  running.
- Which devcontainer configuration did the working new Codespace use? Both should work,
  only one was seen.

## Open decisions

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

**Default editor for `.strudel`.** Today the Strudel editor is the default
(`priority: default`). Planned: a setting `vstrudel.defaultEditor: strudel | native`.

**Publishing.** Decided: music projects get the extension from the VS Code Marketplace.
The pipeline already has the publish step. It does nothing until the repository has a
`VSCE_PAT` secret. What is left, in order:
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

**How `lib/` is reused.** Today a snippet is a file whose text is pasted. Strudel has no
module system for local files. A second way to reuse code would be a prelude that
evaluates every file in `lib/` before the song, so that its functions are global. Not
decided.

**Where the template lives.** It is the folder `template/` in this repo for now, so F5
and the test have something to open. It should become its own GitHub template repo
before M5. `template/.devcontainer/` is already written for that.

## Known gaps

- Undo in the Strudel editor is CodeMirror's own history. It should go through VS Code
  so there is one history across both modes.
- Cursor and scroll position are not carried across a mode switch.
- Sliders do not appear in the stage.
- Notes that are playing are not highlighted in the native editor.
- A sample that was deleted stays in the Sounds view until the editor is reloaded.
- The Sounds view is empty until a `.strudel` file is open.
- A sound with more than 64 variations only shows the first 64.
- The Sounds view has no search box of its own. The tree filter of VS Code (Ctrl+F in
  the view) works.
- A snippet is a whole file. There is no way to put several in one file or to give one
  a description.
- `stop` stops every session, not only the active one.
- The grammar only reuses JavaScript highlighting. Mini-notation is not highlighted in
  the native editor.
- The editor font and theme are Strudel's defaults, not VS Code's.
- The status text in the corner of the editor ("editor | audio running | playing") is a
  debugging aid and should become a status bar item.
- The integration test does not run in CI. A runner has no sound card and needs a
  virtual display.
- The integration test leaves `demo.strudel` marked as changed in its own window. It
  does not save, so the file on disk is untouched.
- The default sound packs need the network. Offline, only synths, ZZFX and local samples
  play.

## Milestones

| Milestone | Content |
|---|---|
| M1 | Solid core: settings for theme and font, eval errors as diagnostics, status bar |
| M2 | Native mode feedback: note highlighting through decorations, sliders in the stage with write-back, one undo history |
| M3 | What is left of the side panels: the Strudel reference (from `@strudel/reference`), search in the Sounds view |
| M4 | Language support in the native editor: completion, hover, signature help, mini-notation grammar and diagnostics |
| M5 | Ship: Marketplace and Open VSX, template as its own repo, Renovate for `@strudel/*` |

## Ideas for later

**Plugins on Strudel channels.** Load an audio plugin with something like
`.vst("name")` and insert it on that pattern's orbit. In the Strudel editor the call
renders as a block with the plugin name and small sliders for its macros, and a click
opens the plugin's own window. The widget mechanism is the same one `slider()` uses.
The plugin format in a webview is WAM (Web Audio Modules 2): wasm DSP with a web GUI.
First question to answer: does superdough let us insert a node on one orbit, or does
that need a change upstream?

**Native VST3 on desktop.** Only possible outside the webview: a sidecar host process,
with audio streamed out and back. Large, adds latency, never works in Codespaces. A user
can already get there today by sending orbits to separate outputs with `.channels()`
into a DAW.

**A skill that ports open-source VST3 plugins to WAM.** From source (JUCE, iPlug2, DPF,
Faust), not from a binary. See the drawer for why not from a binary.

**Engine channel.** A setting to load the engine bundle from a CDN at run time, to get
new Strudel releases without an extension release. Breaks offline use.

# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

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

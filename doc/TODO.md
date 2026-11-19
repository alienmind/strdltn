# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

## Next: test by hand on desktop

`pnpm test:vscode` already passes in VS Code 1.130 (see "Measured" in
`doc/ARCHITECTURE.md`). It cannot hear or see, so these checks are what is left.

Target: **desktop VS Code, F5 on this repo** (opens `template/`).

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Open `demo.strudel`, click in the code, press Ctrl+Enter | You hear drums, a bass line and a blip. The scope and piano roll move. Playing notes are outlined |
| 2 | Drag the slider in the code | The filter changes while it plays, and the number in the code changes |
| 3 | Open another tab for 30 seconds while it plays | The sound keeps going, in time |
| 4 | Press the swap button in the title bar (or Ctrl+Alt+M) | The same tab becomes the native editor. The sound stops |
| 5 | In the native editor press Ctrl+Enter | A stage opens beside the code. Note whether it plays at once or shows "Click to enable audio" |
| 6 | Open `hydra.strudel` in the Strudel editor, click in the code, press Ctrl+Enter | Hydra shapes behind the code, and sound |

Expected still broken: sound stops on every mode switch, and sliders are missing in the
stage.

Report the result by check number. When something fails, add the content of Output >
`vstrudel`.

## Next: test in Codespaces

Target: **a new Codespace on `alienmind/vstrudel`, branch `main`, opened in Chrome**.
Create it from "New with options" and choose the configuration "vstrudel template
(released extension)". The plain "Create codespace" button takes the other
configuration, which builds from source.

The first try used the source configuration and failed: the `.vsix` was not at
`/tmp/vstrudel.vsix` on attach. We do not know why the build step left no file. The
install now builds on attach when the file is missing, so a build error shows in the
terminal.

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Wait for the Codespace to finish starting, then look at the Extensions view | `vstrudel` is installed |
| 2 | Only if check 1 failed: copy the terminal output of the attach command | It shows where it stopped |
| 3 | Open `demo.strudel`, click in the code, press Ctrl+Enter | Sound in your browser, with the `blip` sample |
| 4 | Press the swap button, then Ctrl+Enter in the native editor | The stage opens. Note whether it needs a click |

Expected still broken: the same as on desktop. Nothing has been measured in Codespaces,
so any of these can fail.

Report the result by check number, plus Output > `vstrudel` and, for check 1, the
terminal output of the attach command.

The default configuration, "vstrudel (built from source)", builds the extension inside
the Codespace. Use it to try a branch that has no release.

## Open questions

- Does a real key press in the native editor count as a click for the stage? A command
  sent by the test does not. Desktop check 5 answers it.
- Does the install on attach finish in Codespaces? The command runs there, but the
  first try had no file to install.
- Why did `postCreateCommand` leave no `.vsix` in the first Codespace?
- Does a webview in Codespaces start audio after a click, like on desktop?
- Does the scheduler keep exact time in a hidden tab? The test only saw that it kept
  running.

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

**Publishing.** The devcontainers install the `.vsix` from a GitHub release, because
the extension is not on the Marketplace. Publishing to the VS Code Marketplace and Open
VSX would let a devcontainer install it by id. That needs a publisher account, and the
`publisher` in `package.json` is a placeholder until then.

**How `lib/` is reused.** Strudel has no module system for local files. Recommended for
a first version: a palette that inserts snippets, plus an optional prelude that
evaluates every file in `lib/` before the song. Not decided.

**Where the template lives.** It is the folder `template/` in this repo for now, so F5
and the test have something to open. It should become its own GitHub template repo
before M5. `template/.devcontainer/` is already written for that.

## Known gaps

- Undo in the Strudel editor is CodeMirror's own history. It should go through VS Code
  so there is one history across both modes.
- Cursor and scroll position are not carried across a mode switch.
- Sliders do not appear in the stage.
- Notes that are playing are not highlighted in the native editor.
- The sample map is built once, when the webview loads. New files need a reload.
- `stop` stops every session, not only the active one.
- The grammar only reuses JavaScript highlighting. Mini-notation is not highlighted in
  the native editor.
- The editor font and theme are Strudel's defaults, not VS Code's.
- The integration test does not run in CI. A runner has no sound card and needs a
  virtual display.
- The integration test leaves `demo.strudel` marked as changed in its own window. It
  does not save, so the file on disk is untouched.
- The `.vsix` is 543 KB with a 1.9 MB webview bundle. Not looked at.

## Milestones

| Milestone | Content |
|---|---|
| M0 | Spike proven by hand on desktop and in Codespaces. The two tables above |
| M1 | Solid core: settings for theme and font, eval errors as diagnostics, status bar, sample map refresh |
| M2 | Native mode feedback: note highlighting through decorations, sliders in the stage with write-back, one undo history |
| M3 | Side panels: Strudel reference (from `@strudel/reference`), sample browser with preview, snippet palette over `lib/` |
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

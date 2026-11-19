# TODO

What is in flight, what is undecided, and what to try next. Finished work is deleted
from here.

## Next: M0 test in desktop VS Code

The spike is built. It needs a person, because sound and VS Code cannot be checked from
the terminal. Target: **desktop VS Code, F5 on this repo** (opens `template/`).

| # | Do this | Should happen |
|---|---------|---------------|
| 1 | Open `demo.strudel` | Strudel editor opens with the code, not the native editor |
| 2 | Click in the code, press Ctrl+Enter | Sound. Inline scope and piano roll move. Playing notes are outlined |
| 3 | Drag the slider in the code | The filter changes while it plays, and the number in the code changes |
| 4 | Listen for the third pattern | The `blip` sample from `samples/blip/` is heard |
| 5 | Press Ctrl+. | Sound stops |
| 6 | Play, then open another tab so the editor is hidden for 30 seconds | Sound keeps going, in time |
| 7 | Press the swap button in the title bar (or Ctrl+Alt+M) | The same tab becomes the native editor. No second tab |
| 8 | In the native editor press Ctrl+Enter | A stage opens beside the code and plays. If it shows "Click to enable audio", note it and click |
| 9 | Type in the native editor, press Ctrl+Enter again | The stage plays the new code |
| 10 | Toggle back to the Strudel editor | The stage closes. The code has the edits from step 9 |
| 11 | Edit `demo.strudel` from outside (another program, or `git checkout`) while the Strudel editor is open | The editor shows the new text |
| 12 | Open `hydra.strudel`, press Ctrl+Enter | Hydra visuals behind the code, and sound |

Expected still broken: sound stops on every mode switch (steps 7 and 10), and sliders
are missing in the stage.

Report the result by check number, plus the content of Output > `vstrudel`. Its first
lines hold the user agent, the codec support and the AudioContext state, which answer
the codec question without listening.

After desktop passes, run the same table in Codespaces. That needs the extension
installed there, see "Codespaces install path" below.

## Questions M0 answers

| Question | Check |
|---|---|
| Does a webview start audio from a click inside it? | 2 |
| Does a play command from VS Code start audio with no click in the webview? | 8 |
| Do AudioWorklets load from `data:` URLs under our CSP? | 2, and no error in the log |
| Does `fetch` of an `asWebviewUri` URL work for samples? | 4 |
| Which codecs does the VS Code build decode? | The `codecs:` line in the log |
| Does the scheduler keep time when the tab is hidden? | 6 |
| Does `vscode.openWith` swap the tab in place? | 7 |
| How long does a mode switch take? | 7, by feel for now |
| Does Hydra load from unpkg.com and get WebGL? | 12 |

## Open decisions

**Sound across a mode switch.** Each webview has its own engine, so a switch stops the
sound. Upstream `StrudelMirror` keeps editor, scheduler and drawing in one page, which
makes a separate engine webview costly: highlighting and scopes need the haps and the
analyser data where the editor is. Options to try after M0:
1. Accept the gap and restart playback in the new webview at the same cycle position.
2. One long-lived panel that holds the engine and is moved or shown differently, instead
   of two webview kinds.
3. A separate hidden engine webview, with the editor webview running a silent copy of
   the pattern for visuals.

**Default editor for `.strudel`.** Today the Strudel editor is the default
(`priority: default`). Planned: a setting `vstrudel.defaultEditor: strudel | native`.

**Codespaces install path.** Recommended: publish to the VS Code Marketplace and Open
VSX, then `devcontainer.json` installs by id. Alternative: download the `.vsix` from a
GitHub release in `postAttachCommand`. Not decided. The `publisher` in `package.json` is
a placeholder.

**How `lib/` is reused.** Strudel has no module system for local files. Recommended for
a first version: a palette that inserts snippets, plus an optional prelude that
evaluates every file in `lib/` before the song. Not decided.

**Where the template lives.** It is the folder `template/` in this repo for now, so F5
has something to open. It should become its own GitHub template repo before M5.

## Known gaps in the spike

- Undo in the Strudel editor is CodeMirror's own history. It should go through VS Code
  so there is one history across both modes.
- Cursor and scroll position are not carried across a mode switch.
- Sliders do not appear in the stage.
- Notes that are playing are not highlighted in the native editor.
- The sample map is built once, when the webview loads. New files need a reload.
- `stop` stops every session, not only the active one.
- The grammar only reuses JavaScript highlighting. Mini-notation is not highlighted in
  the native editor.
- The webview bundle is 3 MB unminified. Not looked at.
- The editor font and theme are Strudel's defaults, not VS Code's.

## Milestones

| Milestone | Content |
|---|---|
| M0 | Spike proven on desktop and in Codespaces. The table above |
| M1 | Solid core: settings for theme and font, eval errors as diagnostics, status bar, sample map refresh |
| M2 | Native mode feedback: note highlighting through decorations, sliders in the stage with write-back, one undo history |
| M3 | Side panels: Strudel reference (from `@strudel/reference`), sample browser with preview, snippet palette over `lib/` |
| M4 | Language support in the native editor: completion, hover, signature help, mini-notation grammar and diagnostics |
| M5 | Ship: `.vsix`, Marketplace and Open VSX, template repo with devcontainer, CI, Renovate for `@strudel/*` |

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

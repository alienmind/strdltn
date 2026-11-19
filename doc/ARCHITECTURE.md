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
| `src/shared/protocol.ts` | Message types and `diffText`, used by both sides. |
| `src/webview/main.ts` | Creates `StrudelMirror`, syncs text, handles play and stop, fills the stage dock. |
| `scripts/build.mjs` | esbuild: `dist/extension.cjs` (Node, CommonJS) and `dist/webview.js` (browser, ESM). |
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

The webview also loads `github:tidalcycles/dirt-samples` over the network. The first
play waits for that pack for up to 6 seconds. Without the wait, the first play on a slow
network said `sound bd not found`. With the cap, offline use still starts.

## Starting audio

A webview does not start an `AudioContext` without a real click inside it. Measured in
VS Code 1.130: after a play that came from a VS Code command, `context.resume()` never
resolves and `navigator.userActivation` is false. The Chromium switch
`--autoplay-policy=no-user-gesture-required` did not change that. `initAudio()` from
superdough resolves without resuming the context, so we call `resume()` ourselves.

So `play()` in the webview tries to resume for 1.5 seconds. If the context is still
suspended it shows the overlay "Click to enable audio". The click on the overlay is the
gesture, and it plays. This happens once per webview. Playing with Ctrl+Enter inside the
Strudel editor does not need it, because the user has already clicked in the code.

Not measured: whether a real key press in the native editor counts as a gesture for the
stage. The test sends commands, which is not a key press.

## Stage dock

Inline widgets (`._scope()`, `._pianoroll()`) draw on a canvas they look up by id and
create only when it is missing. Upstream then gives that canvas to CodeMirror. In the
stage the editor is hidden, so:

1. Before the code runs, we transpile it ourselves with the same options, get the
   widget ids with `getWidgetID`, and create the canvases in the dock.
2. After the code runs, we clear CodeMirror's widget decorations with `updateWidgets`
   and move the canvases to the dock.

Step 2 must clear the decorations first. Moving a canvas out while CodeMirror still owns
it does not hold, see `doc/DRAWER_OF_FAILED_IDEAS.md`.

Sliders are not in the dock yet.

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

The test cannot hear or see. "Works" for audio means the `AudioContext` is running, the
scheduler started and the samples decoded. It does not prove sound came out of the
speakers, or that a canvas shows the right picture.

In Chrome, with `pnpm smoke`: the editor, inline widgets, slider, note highlighting,
text sync in both directions and the stage dock were also checked by looking at the
page.

Nothing has been measured in Codespaces.

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

## Build pipeline

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests and on tags. It
installs with pnpm, type checks, and builds the `.vsix`, which it uploads as an
artifact. On a tag `v*` it also checks that the tag matches the version in
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
do the same in one command with `curl`. A successful install has not been seen yet.

## Tooling

- pnpm 11 ignores the `pnpm` field in `package.json`. Build scripts are allowed in
  `pnpm-workspace.yaml` under `allowBuilds`.
- `package.json` has `"type": "module"`, so the extension host bundle is written as
  `dist/extension.cjs`.
- `vsce package` is run with `--no-dependencies` because everything is bundled.

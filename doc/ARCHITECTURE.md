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
`samples`) in the workspace folder of the file. A subfolder is a sound name and its
audio files are the numbered variations. An audio file directly in the folder is a sound
named after the file. The URLs come from `asWebviewUri`.

The webview also loads `github:tidalcycles/dirt-samples` over the network and does not
wait for it, so local sounds work offline.

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

| What | Where | Result |
|---|---|---|
| Bundle loads, editor shows the document | Chrome, `pnpm smoke` | Works |
| Ctrl+Enter plays; scope, piano roll and slider render inline; playing notes are highlighted | Chrome, `pnpm smoke` | Works |
| Local sample map is accepted | Chrome, `pnpm smoke` | Works (`local samples: blip` in the log) |
| Typing sends `edit`; a remote `update` is applied and not echoed | Chrome, `pnpm smoke` | Works |
| Stage layout: editor hidden, widgets in the dock, survives a second evaluation | Chrome, `pnpm smoke` | Works |
| `pnpm build`, `pnpm typecheck` | Windows, Node 24, TypeScript 7 | Pass |

Nothing has been measured inside VS Code yet. The smoke test says the bundle is sound.
It says nothing about webview autoplay rules, codecs, CSP or `asWebviewUri`. Those are
the M0 checks in `doc/TODO.md`.

## Tooling

- pnpm 11 ignores the `pnpm` field in `package.json`. Build scripts are allowed in
  `pnpm-workspace.yaml` under `allowBuilds`.
- `package.json` has `"type": "module"`, so the extension host bundle is written as
  `dist/extension.cjs`.
- `vsce package` is run with `--no-dependencies` because everything is bundled.

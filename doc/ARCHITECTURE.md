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
| `src/extension/extension.ts` | Registers the custom editor `vstrudel.editor` and the commands. Owns the list of sessions, the status bar item and the kept sound list. |
| `src/extension/session.ts` | Binds one webview to one document. Text sync, sample scan, problems, HTML and CSP. |
| `src/extension/samples.ts` | Turns the samples folder into the map upstream `samples()` accepts. |
| `src/extension/sounds.ts` | The Sounds view: groups the sound list that the engine reports. |
| `src/extension/snippets.ts` | The Snippets view: reads the `.strudel` files under `lib/` and shows them as a tree with a hover. |
| `src/extension/files.ts` | The Files view: the folders of the workspace that hold `.strudel` files. |
| `src/shared/filetree.ts` | Builds the tree of the Files view from a list of paths. `filetree.test.ts` holds the cases. |
| `src/shared/snippet.ts` | Splits a snippet file into header fields and code. |
| `src/shared/context.ts` | The rules that name a slider or a visual from the code around it. `context.test.ts` holds the cases. |
| `src/extension/packs.ts` | Downloads the remote samples a song loads into `.vstrudel/cache/`, measures the cache and empties it. |
| `src/shared/packs.ts` | Finds the packs a song names, resolves a name to an address and to a place in the cache. `packs.test.ts` holds the cases. |
| `src/shared/diagnostic.ts` | The rules that find the place of an evaluation error in the code. `diagnostic.test.ts` holds the cases. |
| `src/shared/protocol.ts` | Message types and `diffText`, used by both sides. |
| `src/webview/main.ts` | Creates `StrudelMirror`, syncs text, handles play and stop, fills the stage dock. |
| `src/extension/firmware.ts` | Lists the VIBE FM firmwares in the `firmware/` folder, and caches the ones songs load from an address. See "Firmware" |
| `src/extension/shrub.ts` | Experimental mockup, behind `vstrudel.experimental.shrubEditor`: SHRUB's web editor in a tab. See "SHRUB editor panel" |
| `src/shared/firmware.ts` | Finds the addresses of `firmware(...)` in a song. `firmware.test.ts` holds the cases |
| `src/webview/vibe/core.ts` | Hosts one firmware `.wasm` and renders its sound. No Web Audio in it, so the tests run it. `core.test.ts` holds the cases |
| `src/webview/vibe/worklet.ts` | The AudioWorklet processor around `core.ts`. Built as `dist/vibe-worklet.js` |
| `src/webview/vibe/index.ts` | Registers the instrument `vibefm1`, picks the firmware of each hap, sends it notes, clock and transport |
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
| `stage` | Panel below the native text editor (`vstrudel.stage.position`) | No code. Widgets in a dock, global visuals behind |

The toggle command (`vstrudel.toggleMode`, title bar button, Ctrl+Alt+M) runs
`vscode.openWith` on the same file with the other editor type. Opening the Strudel
editor closes the stage of that file, so one file never has two engines.

Each webview has its own engine today. Switching layout destroys one webview and creates
another, so the sound stops on a switch. See `doc/TODO.md` for the open question.

## Messages

| Direction | Message | Meaning |
|---|---|---|
| webview -> host | `ready` | The page loaded and wants its content |
| host -> webview | `init {text, mode, samples, settings}` | Document text, layout, the sample map, and theme and font |
| host -> webview | `settings {settings}` | A setting for theme or font changed |
| webview -> host | `edit {text}` | The user changed the code in CodeMirror |
| host -> webview | `update {text}` | The document changed from somewhere else |
| host -> webview | `play`, `stop` | A VS Code command was run |
| host -> webview | `samples {samples}` | The samples folder changed. Register the new map |
| host -> webview | `packs {packs}` | The remote sample packs of the song, with the cached copy of the ones we have |
| host -> webview | `preview {name, index}` | Play one sound once |
| host -> webview | `insert {text}` | Insert at the cursor of the Strudel editor |
| host -> webview | `slider {index, value}` | Move a slider of the stage, as a drag would |
| webview -> host | `sounds {sounds}` | The engine's sound list, sent after loading and after every change |
| webview -> host | `state {started, audio, needsClick}` | The scheduler started or stopped, the `AudioContext` changed state, or the click overlay came or went |
| webview -> host | `evaluated {error?}` | An evaluation ended. With `error` it failed: the message, and the place in the code when a rule found one |
| webview -> host | `cacheFiles {id, base, files}` | A song called `samples(map, base)` with a remote base. Does the cache hold these files? |
| host -> webview | `cachedFiles {id, base?}` | The answer: the address of the cached folder when every file is in it |
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

A click on a row never types. The maintainer's rule for every view of the side bar: a
click selects, or selects and previews, and putting text into the code is a deliberate
press on the insert button of the row. Until then a click on a sound typed its name, and
it did so into any file that had the focus.

When preview is on, a click on a sound plays it once through `superdough()`, with the
note `a3` for anything that is not a plain sample list, as the sounds tab of strudel.cc
does. The insert button types the full name at the cursor (`RolandTR909_bd`, which is
valid anywhere). The speaker button at the top of the view turns preview
on and off. It is two commands that swap on the context key `vstrudel.previewSounds`,
and the choice is kept in `globalState`. The view also says "preview on" or "preview
off" in words beside its title, because the icon alone was read both ways. A row has two
buttons: insert types the name without playing, play plays without typing.
The button on a bank types `.bank("RolandTR909")`.

The icons are our own files in `media/icons/`: a drum, a keyboard, a wave for samples,
a note for soundfonts. VS Code's icon set has no drum. A tree draws an icon as an image,
so it cannot take the color of the theme, and each icon exists as a light and a dark
file.

The list lives in an engine, and an engine exists only while a `.strudel` file is open.
So the host writes the last list to a file, 2 seconds after it settles, and shows it at
the next start before any file is open. There are two files, both named `sounds.json`.
The one in the workspace storage of the extension (`context.storageUri`) holds the whole
list. The one in the global storage (`context.globalStorageUri`) leaves out the sounds
that belong to one workspace, its own samples and the packs of its songs, and is for a
workspace that has no list yet. The list of a running engine always replaces the kept
one. A kept list can name a sample that was deleted since. A click on a sound types its
name as always. Preview needs an engine and says so.

We chose a kept list over an engine of its own for the view, see the drawer.

Measured in VS Code 1.130: 151 samples, 1347 drum machine sounds in 138 banks, 25
synths and 125 soundfonts are listed, and one sound of each group plays.

## Logo in the side bar

The side bar starts with the logo. The header of a side bar takes text only, so the
picture is a view of its own, `vstrudel.logo`: a webview with one image and no script.
The image is `media/logo.jpg`, the middle band of `doc/logo.jpg` at 640 by 149 pixels
(18 KB). `doc/` is not in the `.vsix`, `media/` is.

A webview view cannot take the height of its content. The four views share the height
by the weights in `package.json` (`initialSize`: logo 1, Files 3, Sounds 4, Snippets 4).
Seen in the screenshot of the test at 1250 pixels of window height: the logo shows whole,
with an empty strip under it. A user who drags the borders keeps their own sizes.

## Files view

After the logo, the side bar lists every folder of the workspace that holds a
`.strudel` file, at any depth, and those files. It is the Explorer with everything else
left out, so a song is one click away without leaving the vstrudel side bar.

`FilesProvider` asks VS Code for `**/*.strudel`, without `node_modules`, `.vstrudel` and
`.git`, and `buildFileTree` turns the paths into folders and files, folders first, names
sorted as a person reads them (`2-b` before `10-a`). With one workspace folder its
content is the top level. With several, each is a row. A watcher on `**/*.strudel`
refreshes the view when a file is added or removed.

A row has the address of its file (`resourceUri`), so it gets the icon of the file
theme and the colors of git. A click runs `vscode.open`, which opens the file as the
Explorer would: in the Strudel editor, unless the user chose another default.

Which workspace folder a file is in is asked of VS Code (`getWorkspaceFolder`). The
first version compared the paths as text and listed nothing on Windows, where the drive
letter of the two can differ in case.

## Snippets view

`SnippetsView` lists every `.strudel` file under a folder named by `vstrudel.libFolder`
(default `lib`), anywhere in the workspace. One file is one snippet. A watcher refreshes
the list when a file is added, removed or saved.

The view is a tree, built like the Sounds view: a row per folder of the library, and
under it a row per snippet with its title, its tags in the dimmed text after it, and a
dot in the color of its category. A row has two small buttons, the same as a sound has:
insert at the cursor (`$(insert)`) and open the file (`$(go-to-file)`). A click on the
row itself only selects it.

The description, the header fields and the code are in the hover of the row
(`SnippetsView.preview`, a `MarkdownString`). VS Code draws the hover itself, so it
floats over the editor and is not held inside the narrow side bar, and the code block
is colored by the highlighter of the editor. The hover shows the first 30 lines of a
long snippet.

It was a webview with cards before, see the drawer.

Inserting goes to the Strudel editor when it is the active tab, and to the native
editor when that shows a Strudel file. `window.activeTextEditor` is undefined while the
Strudel editor is active, because it is a webview. Nothing is inserted into a file of
another language: a click on a sound while a markdown file had the focus used to type
the sound name into it.

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

A song can load remote samples in three ways, and all three are cached:

| In the song | What it is |
|---|---|
| `samples('github:eddyflux/crate')` | A pack by its GitHub name. The map is `strudel.json` in that repository |
| `samples('https://example.org/kit/strudel.json')` | A pack by the address of its map. Any `.json` name, no query |
| `samples({ bd: 'bd/x.wav' }, 'github:user/repo')` | A map written in the song, with a remote base: a `github:` name or an `https://` folder |

Nothing here changes upstream.

### A pack by name

**The pack is found before the song plays.** The host scans the text of the document
for `samples('github:...')` and `samples('https://....json')` (`findPackSources`), on
open and 1.5 seconds after the last edit, and tells the webview. The webview registers
the pack at once, so its sounds can be browsed and previewed before the first play.

**The pack gets a group in the Sounds view.** The song's scope has our own `samples`
(`taggedSamples`), put after `@strudel/webaudio` in `evalScope`. It calls the real one
and adds the pack's name as the `tag` when the first argument is a name. The view makes
a group of every tag that starts with `github:` or `https://`.

**The pack is copied into the workspace.** `PackCache` downloads the sample map and
every file it names, six at a time, with progress in the status bar. A marker file is
written last, and only a pack that has it is used. Then the webview is told again, with
the map and the webview address of the folder. For `github:` upstream lets us answer for
a prefix (`registerSamplesPrefix('github:', ...)`): a cached pack is answered from the
workspace, any other is fetched as upstream would. An `https://` map has no such hook,
so `taggedSamples` hands the cached map to upstream itself.

### A map in the song with a remote base

The host cannot read this from the text: the map is code. So the question is asked when
the song runs. `taggedSamples` sends the base and the file paths of the map to the host
(`cacheFiles`). The host answers with the address of the cached folder when it holds
every one of those files, and the song gets that address as its base. Otherwise the song
plays from the network, and the host downloads the missing files for the next
evaluation. The webview waits at most 2 seconds for the answer. There is no map and no
marker to keep, because the song has the map. A file counts when it is there.

### Where the files are

A remote folder has one place in the cache, whichever way a song names it
(`cacheSegments`):

| Address | Place below `.vstrudel/cache/` |
|---|---|
| `https://raw.githubusercontent.com/<user>/<repo>/<branch>/...` and every `github:` name | `github/<user>/<repo>/<branch>/...` |
| `https://<host>/<path>/` | `https/<host>/<path>/` |

So a pack loaded by name and a map with the same base share their files. The copy of a
map is kept under its own name beside them. The marker of `strudel.json` is `.complete`,
the marker of any other map is `.complete.<name>`, because two maps can sit in one
folder. The marker holds the name the song uses.

Every file is written under the name `<file>.part` and renamed when it is whole. A file
with the right name is then never half a file, also when the window was closed during a
download.

`.vstrudel/` has its own `.gitignore` with `*` in it, so the cache is never committed
and the `.gitignore` of the project is not touched.

### What is not cached

- A pack with more files than `vstrudel.remoteSamples.maxFiles` (default 600).
- A map where a sound names its own `_base`. Its files do not sit below one folder.
- A map that names a file by a full address, by an absolute path, or with `..` in the
  path (`unsafeFile`). The map comes from the network, and such a path would put a file
  outside the cache folder.
- A base that is not an `https://` folder ending in `/`. Upstream joins base and path
  as they are, and only then is the file below our folder.
- An address with a query, for example what `shabda:` resolves to. Its answer is made on
  request.
- Anything while `vstrudel.remoteSamples.cache` is off.

All of these still play from the network. Output > `vstrudel` says why a pack was not
cached.

### Size and clearing

"vstrudel: Show sample pack cache size" walks `.vstrudel/cache/` of every workspace
folder and shows the bytes, the number of files and the packs that are whole. "vstrudel:
Clear sample pack cache" asks first, in a modal dialog with the same numbers, and then
deletes that folder. It refuses while a download runs. Open webviews are told, drop
their cached copies and register the packs again from the network. Nothing is downloaded
again at that moment. A pack comes back the next time a song that loads it is opened or
edited.

## The template

`template/` is what a user starts from, and what every test opens.

| Path | Holds |
|---|---|
| `demo.strudel` | "Sea of Souls (club mix)" by the maintainer. The test plays it on every run. It uses the vocals in `samples/sos-vocals/` |
| `examples/` | Songs to learn from: three of ours, Hydra visuals, `coastline` from Strudel's own examples, and "Array (Lil Data Edit)" |
| `lib/` | Snippets by category, one folder each |
| `samples/` | Local samples |
| `AGENTS.md`, `.github/copilot-instructions.md` | Rules for an AI assistant, see "Instructions for AI assistants" |
| `reference/` | The Strudel functions and the tutorial of strudel.cc as Markdown, made by `pnpm reference` and `pnpm tutorial` |

Rules for what goes in:

- A file by somebody else is only copied when it has a license that allows it. Its
  header keeps the author and the license. A change we made is said in a comment
  (`06-array-lil-data-edit.strudel` lost two calls that only exist on strudel.cc).
- A technique learned from somebody without a license on their code is written again
  as our own code, and the snippet names the person in `@credits`.
- The integration test plays every file in `lib/` and `examples/`. That is how we know a
  function or a sound name exists in the pinned Strudel version.

## Instructions for AI assistants

An assistant such as Copilot Chat, asked "add a bass line" with a song open in this
repo, went for the source of the extension. The repo holds both the tool and the songs,
and nothing told the assistant which one a request is about. So there are instructions
on both sides:

| File | Read by | Says |
|---|---|---|
| `AGENTS.md` (root) | Agents that read `AGENTS.md` | A request about music edits the open `.strudel` file. A request about the tool follows `CLAUDE.md` |
| `.github/instructions/strudel.instructions.md` | Copilot, for files that match `applyTo: "**/*.strudel"` | The same, with an example, and where the guide to the language is |
| `template/AGENTS.md` | Agents in a music project made from the template | The rules for a song, the folders, and a short guide to Strudel |
| `template/.github/copilot-instructions.md` | Copilot in a music project | A short version, pointing at `template/AGENTS.md` |

`template/AGENTS.md` says what a request about music means (edit the open song, the
smallest change, keep the rest), how a song is written (one `$name:` pattern per part),
the sounds, the mini-notation and the common effects in tables, and where to look before
using a function. Its tables only name functions that exist in the pinned version:
checked against `@strudel/reference` 1.2.2, and `delaytime`, `._scope()` and
`._pianoroll()` against the source, because the reference does not list them. Muting with
`_$:` is in `repl.mjs` of `@strudel/core` 1.2.6.

Two files give the assistant the language itself, so it can look a function up instead of
guessing a name:

| File | Made by | From |
|---|---|---|
| `template/reference/strudel-functions.md` | `pnpm reference` (`scripts/build-reference.mjs`) | `@strudel/reference` 1.2.2, pinned as a dev dependency: 538 functions with their parameters, 366 of them with examples. 139 KB |
| `template/reference/strudel-tutorial.md` | `pnpm tutorial` (`scripts/build-tutorial.mjs`) | The workshop and the "learn" pages of strudel.cc, fetched from the Strudel source at commit `f610965f4332`, the tag `@strudel/codemirror@1.3.0`. 25 pages, 100 KB |

Both are AGPL-3.0-or-later, as Strudel and this repo, and say so at the top. Both are
plain ASCII. The tutorial turns each live code field of the site into a code block and
drops the components of the site, its pictures and the pages that do not apply here
(MIDI, OSC, Csound, the website). Two pages that exist on `main` today, `motors` and
`lfo`, are not at the pinned commit and are not in the file. When the `@strudel/*`
packages are updated, update `@strudel/reference` and `COMMIT` in the script, and run
both commands again.

What the instructions cannot do: inline completion (the gray text while typing) does
not read instruction files. It takes its context from the open file and the other open
tabs. Expected, not measured: a snippet of `lib/` open in a second tab gives it better
examples to follow.

## Starting audio

A webview does not start an `AudioContext` without a real click inside it. Measured in
VS Code 1.130: after a play that came from a VS Code command, `context.resume()` never
resolves and `navigator.userActivation` is false. The Chromium switch
`--autoplay-policy=no-user-gesture-required` did not change that. `initAudio()` from
superdough resolves without resuming the context, so we call `resume()` ourselves.

So `withAudio()` in the webview tries to resume for 1.5 seconds. If the context is still
suspended it shows the overlay "Click to enable audio" and remembers what was asked. The
click on the overlay is the gesture, and the remembered action runs. Play and sound
preview both go through it. This happens once per webview.

Ctrl+Enter and Alt+Enter inside the Strudel editor go through it too. They are
upstream's keymap, which calls `StrudelMirror.evaluate()` directly, and upstream only
starts the audio on a mouse click in the page (`initAudioOnFirstClick` listens for
`mousedown`). Until 0.2.0 we thought a user who types Ctrl+Enter has always clicked in
the code first. Not after a reload: the editor has the focus, Ctrl+Enter runs the song,
and the `AudioContext` stays suspended with nothing to say why. The maintainer saw it
offline, and the cause has nothing to do with the network. So `init()` replaces the
`evaluate` method of our `StrudelMirror` instance with our `play()`, which calls the
original through `evaluateUpstream`. Upstream's code is not changed. A key press is a
user gesture for the browser, so `resume()` is expected to succeed there and no overlay
should show. Measured by hand by the maintainer: after a reload, Ctrl+Enter without a
click plays, online and offline.

Not measured: whether a real key press in the native editor counts as a gesture for the
stage. The test sends commands, which is not a key press.

## The stage

The stage opens below the code by default, so the code keeps the whole width of the
window. VS Code has no "below" for a new panel: `ViewColumn` only knows columns side by
side. So `openStage` runs `workbench.action.newGroupBelow`, which splits an empty group
off under the code and makes it active, creates the panel there (`ViewColumn.Active`),
and then gives the focus back to the code with `showTextDocument`. A second play while
this runs waits for the same stage instead of opening another. With
`vstrudel.stage.position` set to `beside` the stage opens to the right of the code, as it
did before. Either way the user can drag it anywhere. Seen in the screenshot of
`pnpm test:quick` in VS Code 1.147: the stage under the code, the cursor in the code.

## Typing `//` over a selection

In the Strudel editor, `//` typed over a selection comments the selected lines with
`// `, and the same keys on lines that all start with `// ` take that off again. The
rule is `toggleComment` in `src/shared/comment.ts`, with its cases in
`comment.test.ts`: the comment goes at the indentation the lines share, empty lines are
left alone, a selection that ends at the start of a line does not take that line, and
only the exact `// ` is removed, so `//x` written by hand stays.

The keys are caught by a CodeMirror `inputHandler` at `Prec.highest`, added with
`StateEffect.appendConfig` like our change listener. The first `/` over a selection is
held back. A second `/` makes the comment. Any other key types the held `/` and then
that key, over the selection, as if nothing had been held. A pause of half a second types the
held `/`, unless the selection moved since. Without a selection `/` is an ordinary key.

The native editor is not changed: VS Code already does the same with Ctrl+/ (the
`lineComment` of `language-configuration.json`), and catching typed keys in a text
editor would need the `type` command, which slows every key press of every editor.
Measured by hand by the maintainer: comment, uncomment, and a single `/` that replaces
the selection. The test sends commands and cannot type, so it does not cover this.

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

A VIBE FM firmware from thefirmwarehub.com plays through one instrument, `vibefm1`, with the firmware after the colon:
`note("c2 eb2").s("vibefm1:obervave")`. A firmware is one
`.wasm`, built from its own C source with the VIBE FM SDK. The same file runs in the VIBE FM VST plugin, the hub's
browser Playground and the VIBE FM hardware. We host it ourselves in the webview, so it needs no MIDI and works in
Codespaces.

**Where firmwares come from.** `scanFirmware` reads the folder named by `vstrudel.firmwareFolder` (default
`firmware`), found the same way as the samples folder: beside the song or in a parent folder. Two layouts:
`<id>.wasm` with `<id>.json` beside it (the SDK repo's `firmwares/`), or `<id>/*.wasm` with `firmware.json` (an
unzipped package from the hub). The json gives name, author, version and license. The `.wasm` goes to the webview
as an `asWebviewUri` address, like a sample. A watcher sends the list again when the folder changes. Downloading
from the hub is not built yet, see `doc/TODO.md`.

**The instrument.** superdough knows one sound, `vibefm1`: the firmware host. Mini-notation turns `vibefm1:obervave`
into `{ s: 'vibefm1', n: 'obervave' }` (checked with `@strudel/mini` 1.2.6, also for ids with `-` and `.`), and the
trigger picks the firmware from `n` on every hap. So the firmware is a pattern value: `s("vibefm1:<obervave sloop>")`
changes it per cycle. A number picks by position in the folder and wraps, as `bd:3` does for samples; no `n` is the
first one. An id that is not in the folder logs one error with the ids there are. The Sounds view shows `vibefm1` with
its firmwares as named variations (`SoundInfo.variations`), and a click types `vibefm1:<id>`.

The catch: a later `.n()` replaces the firmware. `s("vibefm1:obervave").n("0 2").scale("c2:minor")` ends up with
`n` gone, and then plays the first firmware. Put `n(...).scale(...)` first, or use `note`. The first time `vibefm1`
plays, every firmware of the folder is compiled, so a switch does not wait for a download. A firmware starts running
only with its first note, because a running one costs CPU even when silent.

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

**Firmwares from an address.** `firmware(...)` in a song adds firmwares next to the folder's, the way `samples()` adds
sounds: `firmware('https://.../obervave.wasm')` (the id is the file name, without a `-vibe` ending) or
`firmware({ obervave: 'https://...', boom: 'https://...zip' })`. A folder firmware of the same id wins. The file is
fetched by the webview on the first note, so the server must send CORS headers. `raw.githubusercontent.com` does
(`access-control-allow-origin: *`, checked). The first 4 bytes decide what it is: `\0asm` is used as it is, `PK` is a
package zip from the hub, unpacked with `fflate` 0.8.2 (MIT), first `.wasm` that is not `.aot.wasm`. Anything else
fails once, with a message, and is not fetched again. A `.fwsc` gets its own message, see "FM-1 update packages" in the
drawer.

**The cache of firmwares from an address.** Like the sample packs. After an edit (with the same 1.5 s pause) and when a
song opens, the host finds the addresses of its `firmware(...)` calls (`findFirmwareUrls`: both forms, over several
lines, not in `//` comments), downloads each one with Node into
`.vstrudel/cache/firmware/<first 16 hex digits of the address' SHA-256>/<file name>`, and writes `.complete` with the
address last. The file is kept as it came, `.wasm` or `.zip`. The host sends the webview a map from address to the
`asWebviewUri` of each copy (`firmwareCache`). The webview loads a firmware from its copy when the map has one, and from
the address otherwise, also when the copy is gone. Because the host downloads, a server without CORS headers works
once the copy is there. A firmware already running keeps its module; the copy is used from the next load.

**Programs.** `.progNum(n)` sends a MIDI program change on the hap's channel before its note, only when the program of
that channel changes, because a program change reloads a sound. In OBERVAVE (`trk_load`, `prog_get` in its source)
programs 0 to 63 are its 64 factory sounds in the order of `FACTORY` in `obv_patches.h`, 64 to 69 drums and keys, the
rest INIT, unless the user saved over them.

**Channels.** `midichan` reaches the firmware, but what a channel means is the firmware's business. OBERVAVE plays its
selected track on every channel while its MIDI setting is OMNI, which is its default (`set.midi_ch` 0). Only with a
channel set on its GLOBAL page do the next three channels play tracks B to D. To get separate sounds from one firmware,
use another orbit: each orbit runs its own copy.

**Clock.** With each note and on play and stop, the page sends the scheduler's cycle at the current context frame and
its cps. The worklet turns that into the firmware's position: one cycle is a bar of four quarter notes, so the tempo
is `cps * 240` BPM. The tempo also goes out as a `VIBE_EV_TRANSPORT` tempo event whenever it changes: OBERVAVE's arp
and sequencer take their tempo only from that event, and read the position from the table (its `main.c`). On stop the page empties the firmware's queue, ends its notes and sends "play off".

## SHRUB editor panel

An experimental mockup, to see how the SHRUB web editor would look inside VS Code. Off unless the setting
`vstrudel.experimental.shrubEditor` is on; then the command "vstrudel: Open SHRUB editor (experimental)" shows in the
palette and in the title bar of the Sounds view. Turning the setting off closes the tab. The tab is a `WebviewPanel` with
a toolbar and an `iframe` of `https://shrub.audio/editor/`. Its CSP allows frames from that origin only, and scripts only
with its nonce. `retainContextWhenHidden` keeps the editor's page, and its unsaved patches, while the tab is hidden.
"Open in browser" goes through `vscode.env.openExternal`. "Use in song" is disabled: it marks where a VIBE FM build of
SHRUB would connect.

Not measured: whether shrub.audio lets itself be framed (an `X-Frame-Options` or `frame-ancestors` header would show an
error page in the frame), and whether its sound plays inside a VS Code webview. Our sandbox cannot reach the site. The
toolbar was looked at in Chrome with VS Code's dark colors. Why it stays a mockup is in the drawer.
## Status bar

One item on the right of the status bar says what the song in front does. It replaced a
line of debug text in the corner of the webview.

| Text | When |
|---|---|
| `vstrudel: loading` | The webview has no content yet |
| `vstrudel: stopped`, `vstrudel: playing` | The scheduler of that webview |
| `vstrudel: click in the editor for sound` | The click overlay is up (see "Starting audio"). "stage" in the stage |
| `vstrudel: error in the code`, `vstrudel: playing, error in the code` | The last evaluation failed. Red background. The message is in the tooltip |
| `vstrudel: <file> playing` | The tab in front is not a Strudel file and that song plays in another tab |

"The song in front" is the session whose panel is active (the Strudel editor or the
stage), or the stage of the native editor that is active. A Strudel file in the native
editor that has not played yet has no session and shows `stopped`. In any other tab the
item is hidden, unless a song plays in the background.

A click runs `vstrudel.togglePlay`: stop when that song plays, play otherwise.

The webview sends `state` when the scheduler starts or stops, when the `AudioContext`
changes state, and when the overlay comes or goes.

## Stop

`vstrudel.stop` (Ctrl+.) stops the song in front. When nothing plays there, it stops the
song that plays in another tab, the one the user was in last. So the key always ends a
sound that is heard, and a second press ends the next one. `vstrudel.stopAll` stops
every song. It has no key.

## Errors in the code

Upstream reports a failed evaluation through `onEvalError`, as an `Error`. The webview
sends it to the host (`evaluated {error}`), and the host sets one diagnostic on the
document, with the source `vstrudel`. It shows in the Problems view and as a squiggle in
the native editor. The Strudel editor is a webview and shows no squiggle. The status bar
item turns red in both.

An error is a message. Only a syntax error carries a position. `locateError` in
`src/shared/diagnostic.ts` finds a place by rule, in this order:

| Rule | Error | Place |
|---|---|---|
| position | A syntax error from the parser (acorn), which has `pos` | That character |
| mini line | `[mini] parse error at line N: ...` | Line N |
| name | `x is not defined` | The first use of the name `x` |
| call | `....x is not a function` | The first call of `.x(` |

The last two take the first place the name is written. When the name is written more
than once, that may be the wrong one. An error that no rule places goes on the first
line.

The diagnostic is removed by the next evaluation that works, by closing the editor, and
by any edit of the document. After an edit the range would mark other text, and nothing
can check the code again without playing it. The status bar keeps the error and its
message until the next evaluation.

A sound that is not found, or a sample that does not load, is not an evaluation error.
It happens later, while the pattern plays, and only goes to Output > `vstrudel`.

## Theme and font

| Setting | Default | Meaning |
|---|---|---|
| `vstrudel.editor.theme` | `strudelTheme` | One of the 39 themes of `@strudel/codemirror` 1.3.0. It also colors the stage |
| `vstrudel.editor.fontFamily` | empty | Empty: `editor.fontFamily` of VS Code |
| `vstrudel.editor.fontSize` | 0 | 0: `editor.fontSize` of VS Code |

The host resolves the three values (`editorSettings`) and sends them with `init`, and
again as `settings` when one of them changes, so no reload is needed. Upstream keeps
theme and font in a store (`codemirrorSettings`) that `StrudelMirror` reads when it is
created. The webview sets the store before it creates the editor, so the editor never
shows the upstream defaults first, and calls `setTheme`, `setFontSize` and
`setFontFamily` on an editor that exists.

The list of themes in `package.json` is a copy of the keys of upstream `themes`. It has
to be checked when `@strudel/codemirror` is updated.

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
| The maintainer's machine, for sizing a local model | Intel Core Ultra 7 258V, 8 cores. Intel Arc 140V built-in GPU, which shares the system's memory. 31.5 GB of memory. Docker is installed, Ollama is not |
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

In VS Code 1.147.0 on Windows, with `pnpm test:vscode`, on the branch `feat/m1-solid-core`:

| What | Result |
|---|---|
| Everything in the table above that the test covers | Still works. 134 drum machine banks now, the upstream list changed |
| A call of a function that does not exist (`.lfpx(200)`) | One problem on the document, on `lfpx` (rule "call"). The status bar says "playing, error in the code" and the old pattern keeps playing |
| A syntax error (`s("bd"))`) | One problem on the extra `)` (rule "position") |
| A mini-notation error (`s("bd [sd")`) | One problem on that line (rule "mini line") |
| An edit after an error | The problem is gone |
| A good evaluation after an error | The status bar says "playing" again |
| `vstrudel.editor.theme` and `vstrudel.editor.fontSize` changed while a song plays | The webview gets them without a reload. A new editor starts with the font of VS Code (Consolas, 14) |
| The sound list kept for the next start | 1651 sounds written and read back |
| Two songs playing, `vstrudel.stop` in the tab of one | Only that one stops |
| `vstrudel.stop` again, from a plain text tab | The status bar named the other song ("demo.strudel playing"), and it stops. Then the item hides |
| `vstrudel.stopAll` with two songs playing | Both stop |
| `samples('https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json')` | Listed before the first play, 41 files cached, then answered from the cache |
| `samples({ zzbd: 'bd/BT0A0A7.wav' }, 'github:tidalcycles/dirt-samples')` | First play from the network, the file is cached, the next play is from the cache |
| The cache size the command reports | 188,956,347 bytes in 459 files, the same as the disk |

By hand, on 2026-11-20, in the maintainer's VS Code with the promoted build
`0.1.0-dev.20261120062215`: the maintainer ran the eleven checks for this branch and
reported that all work. They were: the squiggle, the Problems entry and the red status
bar for an error, the squiggle gone after an edit, play and stop from the status bar
item, the font of VS Code in the Strudel editor, a theme change without a reload, stop
for the song in front and then for the other, stop all, the sound list in the Sounds
view after a window reload with no file open, the cache size message, and clearing the
cache with an open song still playing from the network.

With `pnpm test:quick` in VS Code 1.147.0, after the Files view and the new Snippets
view:

| What | Result |
|---|---|
| The Files view on `template/` | 29 files. Top level: `examples`, `lib`, `demo.strudel` |
| A click on the name of a sound, in the Strudel editor and in the native editor with a stage | The sound is played and nothing is typed, both times |
| Insert a sound while a markdown file has the focus | Nothing is typed |
| The Snippets view as a tree | Seen in the screenshot: folders, a colored dot and the tags per row, the two buttons on the selected row |

Not seen: the hover of a snippet. The test cannot hover.

By hand, on 2026-11-20, in the maintainer's VS Code with the promoted build
`0.2.0-dev.20261120131811` of `main` after the merge of Firmware Hub (`d0e0de8`): the
side bar, sounds, snippets, stage, errors, status bar, stop and the sample pack cache
work. Firmware Hub works too: the "Firmware" group, a firmware from the folder and from
an address, both examples, an unknown id, stop, the folder watcher, and OBERVAVE from
the cache with the network off. Two things were seen. A firmware that changes source
restarts with a short silence. And Ctrl+Enter in the Strudel editor after a reload ran
the song without sound, while the play button worked: see "Starting audio".
`vstrudel.editor.theme` only colors the Strudel editor and the stage, as built; the
native editor keeps the VS Code theme.

Full `pnpm test:vscode` for the release of 0.2.0, in VS Code 1.147.0 on Windows, build
`v0.1.0-13-g37b76fc` with the version set to 0.2.0: every step of the test passed, the
27 template files played with no problem, and the cache held 188,956,347 bytes in 459
files, as on the disk. The pictures in `doc/` are from this run.

Not measured by the test: what a restart shows in the Sounds view (the test has a new
profile on every run, it only reads the file back), clearing the cache, and a light
theme with a song that has no full page visual. The hand test above covers the first
two. In the screenshot `theme.png` the demo song paints
the page black, so only the gutter and the font size show the change.

The test cannot hear or see. "Works" for audio means the `AudioContext` is running, the
scheduler started and the samples decoded. It does not prove sound came out of the
speakers, or that a canvas shows the right picture.

In headless Chrome 148 on Linux, with the webview bundle in a page like `pnpm smoke`, and `obervave.wasm` from the
VIBE FM SDK repo (OBERVAVE 3.4, GPL-3.0), on 2026-11-20:

| What | Result |
|---|---|
| A firmware compiled in the page and passed to an AudioWorklet in `processorOptions` | Works |
| `note("c2 eb2 g2 bb2").s("vibefm1:obervave")` through superdough to the output | Sounds: peak 0.218. Silent after stop |
| `note("c2*4").s("vibefm1:<obervave second>")`, two firmwares, at cps 0.5 | The first sounds in cycle 0, the second in cycle 1. The first only rings out in cycle 1 |
| `vibefm1:1`, and a preview of variation 1 from the Sounds view | The second firmware plays |
| `vibefm1:nosuch` | One error, "no such firmware. There are: obervave, second". Nothing starts |
| `template/examples/07-vibefm1-obervave.strudel`, OBERVAVE from GitHub through `firmware()` | Plays with no error. Three copies on orbits 2, 3, 4. Spectral centroid: bass about 150 Hz, pad 350 Hz, arp 3.6 kHz |
| `template/examples/08-vibefm1-patterns.strudel`, `.progNum("<35 28 53 2>")` | The lead's centroid per cycle: 2939, 517, 723, 1406 Hz, then the same shape again. The program changes the sound |
| A package `.zip` (the wasm and `firmware.json` in a folder) through `firmware()` | Plays |
| A file named `.fwsc` through `firmware()` | One error that says it is an FM-1 hardware firmware. Not fetched again |
| `FirmwareCache` in Node with a stand-in for `vscode.workspace.fs`, OBERVAVE from raw.githubusercontent.com | One download for two requests at once, 846,689 bytes, `.complete` holds the address. A 404 is logged, not thrown |
| A song whose `firmware()` address cannot be reached, with a cached copy in the map | Plays from the copy, peak 0.186. Without the copy: one error, "Failed to fetch" |
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

`pnpm test:quick` is the same test for a small change. It starts VS Code with the
Chromium switch `--mute-audio`, so nothing comes out of the speakers while the engine
runs as always, and it leaves out the long parts: the pack downloads, the play of every
template file, Hydra, and most of the wait with a hidden tab. Measured: 75 seconds, and
the steps it keeps record the same results as the full run. That the window is silent
was not measured by us, the test cannot hear. The full run is the regression test and
stays audible, because hearing it is the one check a person adds.

The switch has to be the first argument. VS Code reads the word after a switch it does
not know as the value of that switch, and at the end that word was the folder to open:
the test window came up without a workspace.

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

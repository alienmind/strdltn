# Architecture

How [str]dltn Live[code] is built, and what we know about the platform. Each fact says whether it
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
| `src/extension/extension.ts` | Registers the custom editor `strdltn.editor` and the commands. Owns the list of sessions, the status bar item and the kept sound list. |
| `src/extension/session.ts` | Binds one webview to one document. Text sync, sample scan, problems, HTML and CSP. |
| `src/extension/samples.ts` | Turns the samples folder into the map upstream `samples()` accepts. |
| `src/extension/browser.ts` | The Browser: three views in the side bar (Library, Reference, Results), one host for all three, with one search, colors and tags. See "Browser" |
| `src/extension/surface.ts` | `setPage` fills any of our webviews with its page. `Place` shows a page docked in a view or floating in an editor tab. See "Dock and float" |
| `src/extension/snippets.ts` | Reads the `.strudel` files under `lib/`, the snippets of the Browser. |
| `src/extension/files.ts` | Lists every `.strudel` file of the workspace, the songs of the Browser. |
| `src/shared/catalog.ts`, `tags.ts`, `search.ts`, `browser.ts` | The items of the Browser, their tags, the search, the messages. Tests beside them |
| `src/browser/main.ts` | The page of the Browser. Built as `dist/browser.js` |
| `src/extension/mixer.ts` | The Mixer in the bottom panel: follows the song in front and sends its model. See "Mixer" |
| `src/shared/chains.ts`, `mixer.ts` | The model of a song for the Mixer (chains, sliders, duck cables), read with acorn, and the messages. `chains.test.ts` holds the cases |
| `src/mixer/main.ts`, `cables.ts` | The page of the Mixer and its cables. Built as `dist/mixer.js` |
| `src/extension/devices.ts` | The Devices view in the bottom panel: the firmware copies per engine, frames to the view, requests back. See "Devices" |
| `src/devices/main.ts` | The page of the Devices view: a panel per firmware copy with its display, F1 to F6 and its parameters. Built as `dist/devices.js` |
| `src/shared/devices.ts` | The messages between the engine, the host and the Devices view |
| `src/shared/snippet.ts` | Splits a snippet file into header fields and code. |
| `src/shared/context.ts` | The rules that name a slider or a visual from the code around it. `context.test.ts` holds the cases. |
| `src/extension/packs.ts` | Downloads the remote samples a song loads into `.strdltn/cache/`, measures the cache and empties it. |
| `src/shared/packs.ts` | Finds the packs a song names, resolves a name to an address and to a place in the cache. `packs.test.ts` holds the cases. |
| `src/shared/diagnostic.ts` | The rules that find the place of an evaluation error in the code. `diagnostic.test.ts` holds the cases. |
| `src/shared/protocol.ts` | Message types and `diffText`, used by both sides. |
| `src/webview/main.ts` | Creates `StrudelMirror`, syncs text, handles play and stop, fills the stage dock. |
| `src/extension/firmware.ts` | Lists the VIBE FM firmwares in the `firmware/` folder, and caches the ones songs load from an address. See "Firmware" |
| `src/extension/shrub.ts` | Experimental mockup, behind `strdltn.experimental.shrubEditor`: SHRUB's web editor in a tab. See "SHRUB editor panel" |
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
| `stage` | Panel below the native text editor (`strdltn.stage.position`) | No code. Widgets in a dock, global visuals behind |

The toggle command (`strdltn.toggleMode`, title bar button, Ctrl+Alt+M) runs
`vscode.openWith` on the same file with the other editor type. Opening the Strudel
editor closes the stage of that file, so one file never has two engines.

Each webview has its own engine today. Switching layout destroys one webview and creates
another, so the sound stops on a switch. See `doc/TODO.md` for the open question.

**VS Code's keys in the Strudel editor.** A key that CodeMirror does not handle leaves the
webview, and VS Code runs whatever is bound to it. Measured by hand on 2026-11-22 (desktop,
F5): Ctrl+F and Ctrl+G reach our commands `strdltn.editor.find` and
`strdltn.editor.gotoLine`, bound under `activeCustomEditorId == strdltn.editor`; the
native editor keeps VS Code's own find; and a new key set in Keyboard Shortcuts works.
The command posts `editorAction` to the webview, which runs `openSearchPanel` or
`gotoLine` of `@codemirror/search`. Upstream's setup binds neither key (its
`searchKeymap` and `search()` are commented out in `@strudel/codemirror` 1.3.0).
`openSearchPanel` adds the search extension itself when the editor has none.

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
| webview -> host | `log {level, message}` | Goes to the `strdltn` output channel |

## Text sync

The text of a song is held twice, in the VS Code document and in the editor of the
webview, and both can change it at the same moment. `src/shared/sync.ts` keeps them
equal, with the scheme of CodeMirror's collab package written on `ChangeSet` of
`@codemirror/state` (adding `@codemirror/collab` itself was not allowed in that session,
and the part we need is small).

- The host is the authority and numbers the changes it accepts (`SyncHost`). `init`
  gives the webview the text and the version.
- The webview keeps its own changes that the host has not confirmed (`SyncClient`) and
  sends them with the version they start from (`push`). The host takes them only when
  that is its current version, and confirms them to the webview at once (`changes`).
- A change of the document from anywhere else (an agent, a save that trims spaces, the
  Browser into the native editor) is sent as `changes` too. The webview moves it over
  its unconfirmed changes and its unconfirmed changes over it, and sends them again. At
  the same place the host's text goes first, on both sides.
- The host writes into the document after it has confirmed (`DocumentWrites`). VS Code
  refuses a `WorkspaceEdit` made for a version of the document that has moved on
  (`applyEdit` gives false). An edit from elsewhere that crossed our write is then moved
  over what we have not written yet and passed on, and our write is moved over it and
  made again. `reset` starts the sync over and is only for a write refused 20 times.
- Every text and offset between the two sides has `\n` line endings, as CodeMirror
  does. The host goes to the document by line and column, which do not depend on the
  line ending, and VS Code turns an inserted `\n` into the file's own line ending. The
  places that give offsets to the host (the Mixer, the error of an evaluation) read the
  document's text with `\n` too.

The first version sent the whole text each way and made each side equal to the other
with a diff. It broke in two ways, measured with real typing in the integration test:
two changes that crossed undid each other and left the two sides different, so the next
keystroke wrote stale text over the document; and on a file with `\r\n` line endings
(what git gives on Windows with `core.autocrlf`) each keystroke was a diff over almost
the whole file, so text came out scrambled, duplicated or lost in every case of the
test. `sync.test.ts` runs 200 random orders of crossing edits on each side and checks
that nothing is lost or doubled.

## Samples

`scanSamples` reads the folder named by the setting `strdltn.samplesFolder` (default
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

## Browser

The side bar is the browser of Ableton Live split into its parts, as three views. It
replaced four other views: the logo, Files, Sounds and Snippets. A tree cannot draw color
squares, chips or a search field, and a webview between trees looked out of place (see
"Snippet cards in a webview" in the drawer), so the side bar is webviews only now. The
plan it comes from is phase 1 of `doc/DAW-PLAN.md`.

**Three views.** Each folds and moves on its own, as vstrudel had separate views. The
maintainer asked for them on 2026-11-21: one search, one set of colors, one list of
results. Songs and Snippets was a fourth view until 2026-11-22, when the maintainer asked
for its categories back in the Library (see "Songs and Snippets as a view of its own" in
the drawer).

| View | id | Shows |
|---|---|---|
| Library | `strdltn.browser` | The search field; under it one row with the seven colors and the Built-in button; Collections with the saved searches, when there are any; and its categories: All, Sounds, Drums, Samples, Instruments, Render, MIDI, Songs, Snippets |
| Reference | `strdltn.reference` | Its categories: All, Functions, later Tutorial (see "Reference and tutorial" in `doc/DAW-PLAN.md`) |
| Results | `strdltn.results` | The chips, the result bar, the results of all views in one list, and the details pane |

The categories have no heading: the rows start at the top of their view. A click on a
category picks it for Results; "All" of a view picks everything of that view (the
filter's `scope`); a click on the row that is picked goes back to everything of every
view. The Library keeps the view id `strdltn.browser` it had as the whole Browser.

**One filter.** All three views are the same page (`dist/browser.js`) and the same host
object: `BrowserView.provider(page)` gives the provider of each, and every page gets
every item. The host keeps one filter (search text, category, scope, color, built-in,
chips) for all views and stores it per workspace. A view that changes it sends `filter`
to the host, which sends it to the other two; the view that made the change already
shows it, so typing is never undone by an echo. Ctrl+F in a view without the search
field puts the cursor in the Library's. Colors, tags and saved searches come from the
one user file.

**Results opens itself.** Every change of the filter made in Library or Reference
expands Results when it is folded, so a click or a search shows its results
at once (asked by the maintainer on 2026-11-21). The host calls `show(true)` on the
Results view, which keeps the focus where it is, so typing in the search goes on. A
Results view that was never opened has no `WebviewView` yet: then its focus command
opens it and the host puts the cursor back in the search field. Not measured yet whether
that last case loses a key typed in between.

**Built-in.** Places (project, packs, built in) is gone. The maintainer sees where an
item comes from as one more condition, so the Library has one button under the colors
that goes round three states: everything, only what comes with Strudel ("Built-in"),
and only what does not ("Not built-in": the project and the packs it loads). It is the
filter's `builtin`, read by `filterItems` from the item's `place`.

**Previews without a song.** The maintainer found that a click on a sound played nothing
unless a song was open, the stage was open and "Enable sound" had been clicked, and
wanted previews to work at once. Now, when no song plays, the page that was clicked plays
the preview itself with plain Web Audio (`playPreview` in `src/browser/main.ts`): the
click on the row is a click inside that page, which is what a webview needs to start
sound. The host decides what to play (`previewPlan` in `src/shared/preview.ts`):

| Sound | Played by the page as |
|---|---|
| Samples, drum machines, the project's `samples/`, packs | The file, fetched and decoded; variation `n` wraps as in superdough |
| Wavetables (`wt_...`) | Its one cycle, looped at A3 |
| `sine`, `square`, `sawtooth`/`saw`, `triangle`/`tri` | An `OscillatorNode` at A3 |
| `white`, `pink`, `brown` | Half a second of noise |
| Soundfonts, `supersaw` and the other synths, firmwares | Not: they go to the engine of a song as before, or a message says to open one |

The addresses come from superdough: the engine sends `urls` with each sound of its list
(`sampleUrls` in `src/webview/main.ts`; a pitched map gives its note closest to A3). They
stay in the host and are cached with the sound list. A list cached by an older build has
none, so samples need one song opened once after the update. The Browser's pages may read
the workspace folders (the project's samples and `.strdltn/cache`) and fetch over https
(`connect-src`). While a song plays, the engine still plays the preview, on the next beat
of the song. Heard by the maintainer on 2026-11-21, with no song open: a sample and a
sawtooth. The integration test sends the click as a message, which is not a click, so it
only shows that the page fetched, decoded and started the sound.

**Heights.** VS Code gives the views of a side bar equal heights unless `initialSize`
says otherwise, and with four views the Library's categories were cut off under the logo
(seen in the screenshot of the integration test). `package.json` sets 4, 2 and 6 for
Library, Reference and Results.
VS Code only uses these the first time; a window that has shown the views before keeps
the sizes it had, until "View: Reset View Locations".

**Parts.**

| File | Job |
|---|---|
| `src/shared/catalog.ts` | The item of the Browser (`CatalogItem`), the categories and places, how sounds, snippets, songs and functions become items, and the project file `strdltn.index.json` |
| `src/shared/tags.ts` | The rules that tag an item from its name. `tags.test.ts` holds the cases |
| `src/shared/search.ts` | Search, chips, the grouping under headings. Used by the webview and by the host for the test. `search.test.ts` holds the cases |
| `src/shared/browser.ts` | The messages between the host and the Browser |
| `src/extension/browser.ts` | `BrowserView`: builds the items, keeps the project file, does what a row asks |
| `src/extension/snippets.ts`, `src/extension/files.ts` | `SnippetLibrary` and `SongList`: the files under `lib/` and every `.strudel` file |
| `src/browser/main.ts`, `browser.css`, `icons.ts` | The page: plain DOM and CSS with the `--vscode-*` theme variables, no framework. Built to `dist/browser.js` and `dist/browser.css` |

**Items.** The host builds them from four sources and sends them all at once, 150 ms
after the last change (a pack registers hundreds of sounds one by one): the engine's
sound list (see below), the snippets under `lib/`, the songs, and the functions of
`@strudel/reference`. The build writes `dist/functions.json` from the reference: name,
synonyms, description as text, parameters, the first example and the source file, 518
functions after doubles and inner names (`_fast`) are left out, 166 KB. An item has a
stable id that the user data hangs on: `sound:bd`, `sound:vibefm1:obervave`,
`snippet:drums/four-on-the-floor`, `song:examples/01-chords.strudel`, `fn:lpf`.

| Category | Holds | Headings |
|---|---|---|
| Sounds | Synths, soundfonts, wavetables, ZZFX | Synths, Soundfonts, Wavetables |
| Drums | Drum machine sounds, and pack sounds named `<bank>_<sound>` | The bank. Its button types `.bank("...")` |
| Samples | Local samples, the default samples, other pack sounds | Local samples, Default samples, each pack |
| Instruments | The VIBE FM firmwares, one row each | - |
| Snippets | The files under `lib/` | The `@category` |
| Songs | Every `.strudel` file | The folder |
| Functions | The functions of Strudel | The group from the source file: Effect, Pattern, Signal, Tonal... |

Places say where an item comes from: Current project (local samples, firmwares,
snippets, songs), Packs (a pack a song loads by name), Built in. In "All" the headings are
the categories.

**Tags.** `Group/Tag`, as Live's filter groups. The rules read names only: the part after
the bank (`bd` is Drums/Kick, `oh` Drums/Hihat), the maker at the start of a bank
(`rolandtr909` is Maker/Roland, the short alias `tr909` has none), words in a sample or
soundfont name (`gm_acoustic_bass` is Sounds/Bass, `conga` Drums/Percussion), the kind of
synth, Source/Default, Local, Pack or Firmware. A snippet gets Category, its `@tags` as
Tag, and `@by` and `@credits` as Creator. Measured on the maintainer's list of 1649
sounds: every drum machine sound has a Drums tag, and 20 other sounds have neither a
Drums nor a Sounds tag (`ka`, `dhin` and the other tabla syllables, `jazz`, `metal`).

**Search and chips.** The search is split into words, and every word must match the
name, the item's text (bank, folder, description, the start of a snippet's code) or a
tag. `#kick` matches only tags. Chips: any chip of a group, and every group with a chosen
chip, which is what we expect Live to do (its manual does not say). A click on a chip
takes it alone in its group, Ctrl+click adds it. The chips shown are the tags of the
items the other filters leave, so a chip never leads to nothing, and a group with one
chip that every item has is left out. The scan is plain: about 2200 items.

**User data.** `strdltn.index.json` in the first workspace folder: the names of the seven
colors, colors and extra tags per item id, the saved searches. It is written sorted and
without empty entries, so it diffs well in git. A watcher reads it again when git or a
hand edit changes it. Without a workspace folder it is kept in `workspaceState`. Tags of a
snippet go into its own header instead (`setSnippetTags` in `src/shared/snippet.ts`
replaces or adds the `// @tags` line), so they travel with the file; only free tags
(`Tag/...`) go there.

**The page.** Results are a virtual list: only the rows in sight exist, 22 pixels each,
because 2000 rows made every keystroke slow. A heading opens by itself when it is the
only one, or when there are at most 600 results and at most 24 headings or a filter is
set; Drums with its 139 banks starts closed. What the user opened or closed is kept until
the search changes. Filters, open sections and headings are kept in the webview state, so
they survive a reload of the window. `retainContextWhenHidden` keeps the page while
another side bar is shown.

**Keys and mouse.** In the results: arrows move, Right and Left open and close, Enter
inserts (a song opens), a double click does the same except that a snippet opens its file
in the Strudel editor too, Space plays, 1 to 7 toggle a color on the selected
rows and 0 clears them, Ctrl+click and Shift+click select several. Ctrl+F in the page and
`strdltn.focusSearch` (Ctrl+Alt+F) put the cursor in the search field. A right click
gives colors, play, insert, copy, open and "Edit tags...". The same colors and "Edit
tags..." are behind a tag button on every row, and the details pane has the seven dots
and a "Tags..." button: the first version had only the keys and the right click, and the
maintainer found no way to put a sound in a collection. A click on a row never types:
a click selects, or selects and previews, and putting text into the code is Enter, a
double click or the insert button. Until the Sounds view had that rule, a click on a
sound typed its name, and it did so into any file that had the focus.

**Preview.** With preview on (the speaker beside the search, kept in `globalState`), a
click on a sound plays it once through `superdough()`, with the note `a3` for anything
that is not a plain sample list, as the sounds tab of strudel.cc does. While the song
plays, the preview starts on the next beat of the song and lasts one beat: the webview
works out the audio time of a cycle with the formula of upstream's Cyclist
(`(cycle - num_cycles_at_cps_change) / cps + seconds_at_cps_change + latency`,
`cyclist.mjs` of `@strudel/core` 1.2.6), one cycle being four beats. Measured in the quick
test: "preview: bd:0 on beat 2" while the stage played. Whether it is heard on the beat
is for the hand test.

**Insert as code.** A sound is inserted as the code that plays it (`soundCode` in
`src/shared/catalog.ts`): `s("bd")`, `s("bd:3")`, `s("bd").bank("rolandtr909")` for a
drum machine sound, `note("c3").s("sawtooth")` for a synth, a soundfont or a wavetable,
which make no sound without a note, and `note("c3").s("vibefm1:obervave")` for a firmware.
When the cursor is inside a string of its line (`insideString` in
`src/shared/context.ts`), only the name goes in: `s("bd hh <>")` gets `sd`, not a call.
The host decides that for the native editor, the webview for the Strudel editor, from
the same function. Copy gives the name.

**Inserting** goes to the Strudel editor when it is the active tab, and to the native
editor when that shows a Strudel file. `window.activeTextEditor` is undefined while the
Strudel editor is active, because it is a webview. Nothing is inserted into a file of
another language. A sound is always typed by its full name (`RolandTR909_bd`), which is
valid anywhere.

**The sound list.** superdough keeps every sound it can play in `soundMap`. The webview
sends that list to the host after loading and again whenever it changes (300 ms after
the last change). The Browser never has a list of its own, so it shows exactly what can
be played, including the workspace samples. The list lives in an engine, and an engine
exists only while a `.strudel` file is open. So the host writes the last list to a file,
2 seconds after it settles, and shows it at the next start before any file is open.
There are two files, both named `sounds.json`. The one in the workspace storage of the
extension (`context.storageUri`) holds the whole list. The one in the global storage
(`context.globalStorageUri`) leaves out the sounds that belong to one workspace, its own
samples and the packs of its songs, and is for a workspace that has no list yet. The list
of a running engine always replaces the kept one. Preview needs an engine and says so.
We chose a kept list over an engine of its own, see the drawer.

**Screenshots.** The pictures in `doc/` (`screenshot-*.png`, used by the README and
`doc/ABOUT.md`) come from the integration test. Its last step ("9. Pictures for
README.md and doc/ABOUT.md") plays `demo.strudel` in the Strudel editor, shows the
Library on Drums with the TR-909 open in Results and the Mixer with bass unfolded,
and saves `tmp/shots/doc-overview.png`. From a run of `pnpm test:vscode` (the Hydra and
stage shots only come from the full run), the pictures are cut by hand with Pillow:
`screenshot-overview.png`, `-stage.png` and `-hydra.png` are the whole window at half
size (1440 by 900), `-music.png` and `-browser.png` are the Mixer and the side bar
cut out of the overview, at half size. The window title says "[Extension Development
Host]" (decision 11 of `doc/TODO.md`). Made on 2026-11-21 for 0.2.0.

**Logo and icons.** The Browser has no logo any more: the maintainer took it out on
2026-11-21 (its colors did not match the theme and it took room), and `media/logo.jpg`
went with it. `doc/logo.jpg` stays for the README and `doc/ABOUT.md`.

Play and Stop in the editor's title are `media/play.svg` (green) and `media/stop.svg`
(a red square), fixed colors, because a codicon (`$(play)`) is drawn in the theme's one
color.

The extension has two icons, both two lines of the logo: `[str]` and `[code]` in
Consolas Bold, stretched tall to fill the square (the width is set by `[code]`, so the
height had room). The first version had four lines (`[str]`, `dltn`, `live`, `[code]`)
and the maintainer could not read it in the activity bar. `media/icon.png` (256 by 256)
is the `icon` of `package.json`, shown in the Extensions view and the Marketplace, in the
blue of the logo (`#40A9C6`) on black. `media/strdltn.svg` is the activity bar icon, and
the icon of the Mixer's tab in the bottom panel. It is `[str]` over `dltn`, cut out of
`doc/logo.jpg` so both keep the fonts of the logo (a monospace `[str]`, a geometric sans
`dltn`), each scaled to the width of the square. VS Code uses the icon as a mask and
paints it in one color of the theme, so only its transparency counts: the SVG holds one
192 by 192 PNG, white, with the text as its alpha. The alpha comes from how far blue rises
above red for `[str]`, and from the darkest channel for the white `dltn`, which keeps the
smooth edges of the JPEG. Checked as a CSS mask in Edge in a dark and a light color at
24, 48 and 240 pixels; not yet looked at in the activity bar. When `doc/logo.jpg`
changes, cut it again. `media/icon.png` still shows `[str]` over `[code]`. The icons inside the Browser are inline SVG in `src/browser/icons.ts`
that take the text color; `media/icons/` holds the older files the trees used.

**Title.** The side bar is called "[str]dltn" since 2026-11-21 (before: "[str]dltn
Live[code]"). VS Code capitalizes the title of the side bar: "[str]dltn Live[code]" showed
as "[Str]Dltn Live[Code]". Seen in the screenshots of the test. An extension cannot turn
that off.

Measured in the quick test on VS Code 1.147 with the template: 2222 items (151 sounds,
1347 drum sounds in 139 banks, 153 samples, 22 snippets, 31 songs, 518 functions). "909
bd" gives 6 results, the chips Drums/Kick and Maker/Roland give 20, "lpf" in Functions
gives 6.

## Mixer

The **Mixer**, `strdltn.mixer`, a webview view in a container of its own in the bottom
panel (next to Terminal and Problems), or floating in a window of its own (see "Dock and
float"). It shows the song's name and the strips. **Music Controls** (Play, Stop, Record,
BPM) act on the same song but sit in one row at the top of the Library view
(`src/browser/controls.ts`, above the search). The Mixer's host keeps the song and its
model: it sends the controls' state through `MixerActions.controls` to the Browser's host,
which passes it to the Library page, and the clicks come back through
`BrowserActions.control` to `MixerView.control`. On 2026-11-21 the controls were first in
the Mixer's tab (then called Music), then a side bar view of their own; see "Music
Controls as a side bar view" in the drawer for why that did not stay.

**Music Controls.** Play (green) and Stop (a red square) play the song the Mixer shows, through
its engine; with none, Play opens the song and plays it. Play is lit while the song
plays. Then the BPM box: the song's `setcpm()` or `setcps()` as beats a minute at 4 beats
a cycle (`readChains` gives `tempo`), or 120 in gray when the song has none, which is
Strudel's default (`cps = 0.5` in cyclist.mjs of @strudel/core 1.2.6). Typing a number and
Enter writes `setcpm(<bpm>/4)`, upstream's own form for BPM, in place of the call or as the
first statement after the header comments (`tempoEdit`). A double click takes the call
out, line and all. A tempo that is not plain arithmetic (a slider) disables the box. The
row is built once and updated in place, so a redraw while typing keeps the field. In a
narrow side bar it wraps onto two lines.
Record and record automation come here later (see "Recording" in `doc/DAW-PLAN.md`).

**Layout.** Top to bottom: the name, the peak of the level meter, the gain fader on its
meter (as tall as the panel allows), M and S side by side, the scope with the gain's value
in its corner, and the jack, centered, which tells the orbit in its tooltip. Asked by the
maintainer on 2026-11-22, who found the stacked M, S, G and the "gain" text under the
fader too much: the strip no longer grows when a gain fader comes or goes.
Phase 2 of `doc/DAW-PLAN.md`, and phase 3 in progress.

**Dock and float.** The button with the window icon in the Mixer's title floats it:
`Place.float` in `src/extension/surface.ts` makes an editor tab (`strdltn.mixerTab`),
gives it the Mixer's page, and runs `workbench.action.moveEditorToNewWindow`. The context
key `strdltn.mixerFloating` hides the docked view meanwhile (its `when` in
`package.json`), so there is one Mixer at a time. The dock button in the tab's title, or
closing the tab, puts it back. Measured with spike W1 in the integration test, VS Code
1.147 on Windows: every move gives a new page, the move of the tab into a window of its
own too. The new page drew all 8 strips of `demo.strudel` with bass still unfolded, each
time. `MixerView` is a `Surface`: it never knows where it is
shown, it gets a `vscode.Webview` through `attach`. A move gives a new page, which starts
with every strip folded, so the host remembers which strips the page reported unfolded
and sends them on `ready`. A floating tab is not restored after a reload of the window
(no serializer): the Mixer comes back docked. The stage is to follow the same way after
phase 6, see "Dock and float" in `doc/DAW-PLAN.md`.

**The model.** `readChains` in `src/shared/chains.ts` parses the song with acorn 8.19.0,
the version and the options upstream's transpiler uses (`ecmaVersion: 2022`,
`allowAwaitOutsideFunction`). A chain is a top level labeled statement (`$kick: ...`,
`name: ...`), which is what the transpiler turns into `.p('name')`. Mute and solo follow
upstream's `Pattern.prototype.p` in `@strudel/core` 1.2.6: a label that starts or ends
with `_` is muted, one that starts with `S` and is longer than one letter is a solo.

**Bare chain.** A song without labels plays the value of its last expression, and most
snippets are written that way. Then that expression is the one chain (`bare`), found by
`findChains`: the last top-level expression that is not `await` and not a setup call
(`samples`, `setcps`, `initHydra`...). Its strip takes the file's name. M and S are
disabled on it, since there is no label to write on; G works. A song with at least one
label has only the labeled chains, as the transpiler plays them. Measured over
`template/lib/`: every snippet has a strip now; before, 17 of 22 said "no chains".

**Shown on play.** When a song goes from stopped to playing, the Mixer comes to the
front (`Place.reveal`): `view.show(true)` for a view that exists, the floating tab's
`reveal(undefined, true)`, or the view's focus command and the focus back to the editor
for a view never opened. The cursor stays in the editor in the first two cases.

**Pump meter.** Under the faders of each strip, a box that pumps with the chain while the
song plays: a line of its level over the last two seconds or so, which jumps on each note
by the note's gain (times `velocity`) and halves every 0.12 s. Asked by the maintainer on
2026-11-21 as "scopes pumping below the sliders". It is drawn from the notes, not from
the audio. The engine tags the notes of each chain with the chain's label: in
`beforeEval`, right after the repl puts a fresh `Pattern.prototype.p` in place, we wrap it
(`tagChains` in `src/webview/main.ts`; anonymous `$:` are numbered `$#0`, `$#1` in order).
This is spike D1 of `doc/DAW-PLAN.md`, built. The repl's `defaultOutput` is wrapped too,
so each note is seen with the audio time it sounds; a timer sends each chain's level
every 50 ms (`scopes`, a `ScopeFrame` per chain), the host passes them to the Mixer of
that song, and the page keeps a short history per chain and draws it. Half a second
without frames (stopped) and the lines go flat.

The box is green and pumps for a chain with its own `._scope()` (`MixerChain.scope`), and
gray and flat otherwise. A click on a gray one adds `._scope()` at the end of the chain (so
the inline scope also shows in the editor), a click on a green one takes it out
(`scopeEdit` in `src/shared/chains.ts`), as G does for the gain.

The first build drew each chain's real waveform from its `._scope()` analyser
(`getAnalyzerData('time', id)`). With `demo.strudel` every frame read silence: its line
`all(x=>x.fft(4).scope({pos:0,smear:.95}))` puts `.scope()` (analyser 1) on every chain,
and `analyze` holds one id per note, so superdough had analyser `1` only (measured
2026-11-21, from the log). See "Per-chain scopes from the analysers" in the drawer. How
late the levels arrive through the host is not measured (spike D3); the integration test
counts the frames that arrive while `demo.strudel` plays.

**Cable drags.** Every strip has one jack at its foot. The cables the chain sends (its
duck) start there and the cables that duck it end there: the first build had two jacks
on a ducked strip, and the maintainer found two plugs on one strip confusing (2026-11-21).
A drag from a jack where a cable ends pulls that cable off; from a jack with none, or
with Alt held, it starts a new cable. A drag from it holds a cable
whose loose end is a marker under the pointer, drawn by the same spring as the others.
The strip under the pointer is outlined in the focus color when it takes the cable, in
the error color when it does not, and the cable turns red. Dropped on a strip, the page
sends `duck`; the host edits the text with `duckEdits` in `src/shared/chains.ts`: the
target's orbit joins the `.duck("...")` of the first chain, or `.duck("n")` is added. A
target with no `.orbit()` of its own plays on orbit 1 with most of the song, so it gets
the next free orbit (one more than any orbit or duck in the song) in the same
`WorkspaceEdit`, and one undo takes both back. A cable is pulled off by its end at the
ducked strip: dropped on nothing it sends `unduck` (`unduckEdits`: the orbit leaves the
list, and `.duck()` goes with the last one); dropped on another strip it moves, one edit
of the list. Refused, with the reason in the status bar: a drop on itself, a target whose
`.orbit()` is not a plain number, a ducker whose `.duck()` is a pattern. The page checks
the same before the drop so the cable can turn red. Redraws of the model wait while a
cable is held, as for a fader. The integration test sends the drop messages on the
scratch song and reads the text; the drag gesture itself is tested by hand.

**M, S and the gain toggle.** M and S are two buttons above the scope, blue when on. The
gain toggle has no button since 2026-11-22: a click on the gain fader's triangle without
moving it (`clickToToggle` in `src/mixer/main.ts`) takes the gain fader out, and a chain
without one shows a dim triangle at the bottom of the meter that puts one in. Each
click is an edit of the code made by the host from the text as it is at that moment
(`toggledLabel`, `labelEdit`, `gainEdit` in `src/shared/chains.ts`), written into the
document with a `WorkspaceEdit`. The editor takes it as any edit from outside (see "Text
sync"). M and S flip `_` and `S` on the label. Both on is `Skick_`, because upstream
silences a label that ends with `_` before it looks at the solo. After a mute or solo
the host evaluates the song again if it plays (`MixerActions.evaluate`), since upstream
reads the labels only on evaluation. G adds `.gain(slider(1, 0, 1))` at the end of the
chain's own spine, makes a fixed `.gain(0.8)` a slider, or scales a gain that is not a
number, `.gain(KICK)` becoming `.gain(KICK.mul(slider(1, 0, 1)))`: a second `.gain()` after
it would win and silence the knob (seen by the maintainer on 2026-11-22). G off removes the
`.gain(...)` call that holds the fader, or gives a scaled gain back as it was. A chain without a gain fader shows the dim triangle. The integration test clicks all three on a scratch song (`zz-mixer-test.strudel`)
and reads the text after each click.

Sliders are counted in the order of the code, the same order as the transpiler's widgets,
so a slider's index here is its index in the stage. A slider belongs to a chain when its
call is inside the chain or a top level `const` holding it is used there (also through
another `const`). The label of a fader is the call whose arguments hold the slider or the
constant, walking up through anything that is not a call: `.gain(KICK_VOL.mul(2))` gives
"gain". Arithmetic (`mul`, `add`, `sub`, `div`, `mod`) is walked through too, so a slider
that scales a curve, `.lpf(curve.mul(OPEN))`, gives "lpf"; the demo writes its arrangement
that way. `.orbit(n)` and `.duck("2:3:4")` count only on the chain's own calls; one inside a
function, or a value that is not a literal, makes the orbit unknown. superdough takes the
duck orbits as a list (`"2:3"`) or one per event (`"2,3,4"`, a stack), so both read as
the same set. We write only `"2:3"`: a stack plays the chain once per orbit. The demo's
`.duck("2,3,4,5")` played its kick four times over, and the whole mix peaked at 2.59 times
full scale; with `"2:3:4:5"` the same take peaked at 1.41 (measured 2026-11-21 with the
recorder of `doc/VIDEO.md`).

**The host.** `MixerView` follows the `.strudel` file of the active tab, in either
editor. Any other tab (the Mixer itself, a terminal, a stage) keeps the last song. The
model is read again 300 ms after the last change of the text. Code that does not parse
keeps the last good model, drawn dimmed, with the parser's message in the bar.

**The page.** Strips side by side, folded to the gain fader, unfolded to every slider;
which strips are unfolded is kept by name in the webview state. A click on a strip's name
puts the cursor at the chain, in the Strudel editor (message `select`) or the native one.
The cables are `src/mixer/cables.ts`: one SVG path per cable with a damped spring on its
sag, the constants of ableton-rackutils (see the plan). The layer is inside the scrolling
strip area, 1 pixel big with `overflow: visible`: sized to the scroll area, as first
written, it made the scroll area grow by its own size. Labels sit near the target end; at
the middle of the curve the labels of cables from one jack covered each other.

**Faders.** A fader moves the sound and writes the number, as described under
"Sliders". While it is held, a model sent from the host waits, so a redraw does not pull
the fader from under the pointer. The number is rounded to the slider's step (or a
thousandth of its range), so a drag writes `0.607` and not `0.6070000000000001`.

**Measured in the quick test on VS Code 1.147.** `demo.strudel` gives the table of the
plan: 8 strips, 9 sliders, kick ducks bass, lowendbass and riser on orbits 2, 3, 4. In the
default bottom panel (about 350 pixels high) the strips were first squeezed to the panel
and the faders ran out of them; the strips now keep their height and the area scrolls,
and the faders get shorter in a low panel. The first report of a Mixer opened by the test
came before the model reached it, so the test's `mixerShow` sends the model again with
each try.

Since 2026-11-21 `demo.strudel` is an arrangement that plays itself: 10 strips (the sub
line is now `$acid`, and there are a clap and a pad), 18 sliders, and the kick ducks bass,
acid, riser and pad on orbits 2 to 5. `src/shared/chains.test.ts` holds that table.

## Clicks in the Strudel editor

The canvases of `._scope()` and `._pianoroll()` are block widgets of CodeMirror. A
`<canvas>` is `display: inline`, so it sat on a line box a few pixels taller than
itself, and CodeMirror, which measures the canvas, did not count them. Its idea of where
each line is drifted further with every widget above, and a click landed one or two
lines below the point. Measured in the integration test on `demo.strudel` while it
played: 4 of 6 clicks off by 24 to 95 characters, the stored top of a line 10 to 30
pixels above the real one, and CodeMirror's `posAtCoords` disagreeing with its own
`coordsAtPos`. A fresh `requestMeasure()` did not change it, nor did an
`estimatedHeight` for upstream's `BlockWidget`. The rule `#editor .cm-content > canvas {
display: block; }` in the page of the session fixed all six.

## Snippets

`SnippetLibrary` lists every `.strudel` file under a folder named by `strdltn.libFolder`
(default `lib`), anywhere in the workspace. One file is one snippet. A watcher refreshes
the list when a file is added, removed or saved. The Browser shows them under Snippets,
by category, and the details pane shows the description, the header fields and the first
30 lines of the code.

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
and the older upstream form `// "title" @by author`. A value goes on over the next `//`
lines indented two spaces or more (`//   more`), and over the next lines without `@` in
a block comment, so a header line stays under 100 characters; `setSnippetTags` writes
after such lines, not between them. The header ends at the first line that is none of
these. A file whose top comment has no field has no header, and the comment
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

**The pack shows in the Browser.** The song's scope has our own `samples`
(`taggedSamples`), put after `@strudel/webaudio` in `evalScope`. It calls the real one
and adds the pack's name as the `tag` when the first argument is a name. The Browser makes
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

| Address | Place below `.strdltn/cache/` |
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

`.strdltn/` has its own `.gitignore` with `*` in it, so the cache is never committed
and the `.gitignore` of the project is not touched.

### What is not cached

- A pack with more files than `strdltn.remoteSamples.maxFiles` (default 600).
- A map where a sound names its own `_base`. Its files do not sit below one folder.
- A map that names a file by a full address, by an absolute path, or with `..` in the
  path (`unsafeFile`). The map comes from the network, and such a path would put a file
  outside the cache folder.
- A base that is not an `https://` folder ending in `/`. Upstream joins base and path
  as they are, and only then is the file below our folder.
- An address with a query, for example what `shabda:` resolves to. Its answer is made on
  request.
- Anything while `strdltn.remoteSamples.cache` is off.

All of these still play from the network. Output > `strdltn` says why a pack was not
cached.

### Size and clearing

"strdltn: Show sample pack cache size" walks `.strdltn/cache/` of every workspace
folder and shows the bytes, the number of files and the packs that are whole. "strdltn:
Clear sample pack cache" asks first, in a modal dialog with the same numbers, and then
deletes that folder. It refuses while a download runs. Open webviews are told, drop
their cached copies and register the packs again from the network. Nothing is downloaded
again at that moment. A pack comes back the next time a song that loads it is opened or
edited.

## The template

`template/` is what a user starts from, and what every test opens.

| Path | Holds |
|---|---|
| `demo.strudel` | "Sea of Souls (club mix)" by the maintainer. The test plays it on every run. It uses the vocals in `samples/sos-vocals/`, loaded with `samples('github:alienmind/strdltn/main/template/samples')` from `samples/strudel.json`, so the song also plays when pasted into strudel.cc. In [str]dltn the same files come from the local folder too, and a pack that cannot be read is a warning, not an error of the song (`taggedSamples`): the address works only once the files are on `main` |
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
| `template/.github/instructions/strudel.instructions.md` | Copilot in a music project, for `**/*.strudel` | The same as the root one, with paths from the root of the music project |

The template needs its own copy of the `.strudel` instructions. Seen by the maintainer:
with `template/` open as its own folder, Copilot's agent asked for permission to read
`.github/instructions/strudel.instructions.md` of the repo above it, and only answered
well after it got it. A music project made from the template has no such repo above it,
so everything an assistant needs has to be inside the project. The two copies say the
same thing and differ in their paths. Change both together.

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
`strdltn.stage.position` set to `beside` the stage opens to the right of the code, as it
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
and listens for a window message `cm-slider` to change it.

The sliders are the faders of the Mixer, in both modes; the stage has no slider rows.
After each evaluation the page keeps the sliders it reported (`liveSliders`), with their
ids, and moves their positions with `ChangeSet.mapPos` on every change of the text. A
fader sends `sliderValue {index, from, value}` through the host, and the page does what
the inline slider does: it posts `cm-slider`, so the sound changes at once, and writes
the number into the code 150 ms after the last move. The page writes it, not the host,
because upstream's inline slider in the Strudel editor keeps the text of its number and
replaces that many characters on its next drag; the page tells that widget the new text
in the same step. `from` is missing when the host cannot parse the code at that moment
(half typed); then the slider is found by its index. A slider typed since the last
evaluation has no id, so only its number in the code changes. With no engine open on
the song, the Mixer writes the number itself.

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

**Where firmwares come from.** `scanFirmware` reads the folder named by `strdltn.firmwareFolder` (default
`firmware`), found the same way as the samples folder: beside the song or in a parent folder. Two layouts:
`<id>.wasm` with `<id>.json` beside it (the SDK repo's `firmwares/`), or `<id>/*.wasm` with `firmware.json` (an
unzipped package from the hub). The json gives name, author, version and license. The `.wasm` goes to the webview
as an `asWebviewUri` address, like a sample. A watcher sends the list again when the folder changes. Downloading
from the hub is not built yet, see `doc/TODO.md`.

**The instrument.** superdough knows one sound, `vibefm1`: the firmware host. Mini-notation turns `vibefm1:obervave`
into `{ s: 'vibefm1', n: 'obervave' }` (checked with `@strudel/mini` 1.2.6, also for ids with `-` and `.`), and the
trigger picks the firmware from `n` on every hap. So the firmware is a pattern value: `s("vibefm1:<obervave sloop>")`
changes it per cycle. A number picks by position in the folder and wraps, as `bd:3` does for samples; no `n` is the
first one. An id that is not in the folder logs one error with the ids there are. The Browser shows each firmware
of `vibefm1` (`SoundInfo.variations`) as a row under Instruments, and inserting one types `vibefm1:<id>`.

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
`.strdltn/cache/firmware/<first 16 hex digits of the address' SHA-256>/<file name>`, and writes `.complete` with the
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

**Display and controls (spikes F1 and F2).** Read from the SDK headers and `sdk/src/vibe_sdk.c`, SDK 28 (repo commit
`c6c4355`, 2026-11-20). Not run yet.

| Part | What |
|---|---|
| Display | `vibe_wasm_draw()` runs the firmware's `vibe_on_draw` and returns a pointer into wasm memory: 480 x 320 RGB565, row by row, the whole picture every call. 307,200 bytes a frame, so 30 frames a second is 9.2 MB a second. The SDK keeps no changed rectangle: a host that wants one compares frames itself |
| Stage | SDK 23, optional. `vibe_wasm_stage_info()` says if the firmware wants a second, bigger picture (480 x 270 to 1280 x 720, RGB565). `vibe_wasm_stage_draw()` paints it, at most 60 times a second and only while shown. Clicks come as `VIBE_EV_STAGE` (19), `value = y * 4096 + x` |
| Thread | The SDK calls drawing "the host's drawing thread", never inside `vibe_on_audio`. In our worklet the instance has one thread, so `vibe_wasm_draw` would run between two audio blocks and take time from them. The SDK asks a firmware to keep its drawing short; how long OBERVAVE takes is not measured |
| Encoders | `VIBE_EV_ENCODER` (4). id `VE_1`..`VE_4`, `VE_A`, `VE_B`, `VE_DATA` (0 to 6), a device's extras `VE_X1` (16) and up. `value` is the turn in detents, plus is clockwise, may be fractional. So a mouse wheel or a drag maps to it directly |
| Buttons | `VIBE_EV_BUTTON` (3). id from `enum vibe_button`: F1-F6 under the display (0 to 5), SHIFT, OCT-, OCT+, ENTER, K1-K6, RETURN, HOME, LEFT, MENU, RIGHT, REC, STOP, PLAY, DATA push (24). Only `down` matters, `value` is always 0. Extras from `VB_X1` (64) |
| Pads, keys, faders | `VIBE_EV_PAD` (1, id 0..15, value velocity), `VIBE_EV_KEY` (2, id 0..24, key 0 the lowest C), `VIBE_EV_FADER` (17, id 0..15, value 0..1 absolute) |
| Touch | `VIBE_EV_TOUCH` (16), SDK 18. id 0 down, 1 move, 2 up; `down` 1 while held; `value = y * 512 + x` in display pixels. Only for a firmware of the VIBE FM layout that opted in (`vf_clicks(1)`). Below y 282 is the row of soft keys F1-F6, which is not touch; on the knob columns (y 40 to 282) a drag turns the knob |
| Lights and labels | `vibe_wasm_leds()`, `vibe_wasm_pad_leds()` (SDK 20) and `vibe_wasm_labels()` (`VB_COUNT` x 8 characters) point at tables the panel can read to draw the buttons |

**The relay of the display (spike F1).** Measured on 2026-11-21, desktop VS Code 1.147 on Windows 11, with a spike
extension in `tmp/` (deleted once written here). A worklet ran OBERVAVE (`vibe_wasm_audio` every block, notes every
250 ms) and called `vibe_wasm_draw` at the asked rate. The frame went to the page through the worklet's port
(transferred), from the page to the host with `postMessage`, and from the host to a webview view in the side bar, which
painted it on a canvas. Six seconds a mode. Latency is from the page's send to the view's `message` event.

| Mode | Frames a second arrived | Latency p50 / p95 / max | Notes |
|---|---|---|---|
| Whole frame, `Uint8Array`, 30 a second | 28.9 (all 171 sent) | 4.0 / 5.1 / 13 ms | 8.8 MB a second |
| Whole frame, `Uint8Array`, 60 a second | 62.5 (all 375) | 3.9 / 5.7 / 19 ms | |
| Whole frame, `Uint8Array`, 120 a second | 125 (all 751) | 3.8 / 6.1 / 16 ms | 38 MB a second, as four panels at 30 |
| Whole frame, base64 string, 30 a second | 28.9 (all) | 5.9 / 7.3 / 10 ms | Encoding cost about 1 ms a frame in the page, decoding 1.3 ms in the view |
| One changed rectangle, 30 a second | all | 3.4 / 4.3 / 5 ms | Still 73% of the bytes: the level meter at the top right and the line at the bottom change together, so one box covers most of the screen. Finding the box cost 0.2 ms a frame |
| One changed rectangle, 60 a second | all but 5 unchanged frames | 2.8 / 4.0 / 17 ms | 36% of the bytes |

A `Uint8Array` arrives as a `Uint8Array` in the host and in the view, so `postMessage` carries binary without base64.
`vibe_wasm_draw` of OBERVAVE took 0.05 to 0.08 ms on the page's thread and in the worklet: nothing next to the
2.7 ms of a 128-frame block. Converting RGB565 to RGBA and `putImageData` cost 0.5 ms a frame in the view. So on
desktop: whole frames as `Uint8Array`, no base64, no rectangles; skip a frame only when it is the same as the last.

The same spike in a Codespace, on 2026-11-21: VS Code 1.147 in the browser (`uiKind` web, `remoteName` codespaces),
the extension host in the Codespace, both webviews in the maintainer's browser, so every frame crossed the network
twice. One run, on the maintainer's connection:

| Mode | Sent | Arrived at | Latency p50 / p95 |
|---|---|---|---|
| Whole frame, 30 a second | 173 | 15 a second | 3.6 / 5.4 s |
| One changed rectangle, 30 a second | 173 | 19.9 a second | 4.7 / 6.6 s |
| Whole frame, 60 a second | 375 | 12.1 a second | 18 / 29 s |

The relay carried about 4 MB a second, and nothing pushed back: the frames queued and the delay grew for as long as
the page sent. The summaries of the later modes did not come back before the run ended. So the rule for the display is
one frame in flight per panel: the view answers when it has painted, and only then does the engine send its newest
frame. On desktop that gives the full rate; in a Codespace it gives whatever the connection carries, about 12 to 15
frames a second for one panel on this one, with a delay of one frame instead of seconds. `Uint8Array` arrived as
`Uint8Array` there too. Compressing the frame (OBERVAVE's screen is mostly flat colour) is not measured.

## Level meters

Each strip of the Mixer has a level meter behind its gain fader, as in Live's mixer: two bars, left and right, on a
scale from 0 down to 60 dB, and above them the highest peak of the last 3 seconds in dB ("-Inf" in silence). It turns
orange once the level went above 0 dB, where it clips at the speakers, and stays orange until a click. Live's number
holds until a click; ours follows the level down after 3 s, because the maintainer pulled a gain fader down, read the
held number, and took the meter for one measured before the gain. A Master strip at the end meters the whole mix. Built on
2026-11-22 on `feat/midi`, asked by the maintainer after Record measured the demo peaking at +8.3 dB.

The meters show the real audio, not the notes (the pump meter under the faders still shows the notes). superdough plays
each note through its own nodes and ends with `orbit.connectToOutput(post)`; `post` is that note's last node, after
its own effects and before the orbit's shared room and delay. superdough calls `getOrbit` before its first `await`
(read in superdough 1.3.0), so while our `defaultOutput` runs it the note's chain is still known (`meterChain`, from
the chain tag of the pump meter). `meterOrbits` wraps the controller's `getOrbit` to hand back the orbit through a
`Proxy` whose `connectToOutput` also feeds the chain's meter: a gain, a channel splitter and two `AnalyserNode`s. A
song's own `.scope()` and `analyze` are untouched, which a per-chain `analyze` would not be (see the drawer, "Per-chain
scopes from the analysers"). A firmware's node joins its orbit outside superdough, so `trigger` feeds the meter of the
chain the note comes from (`meter` of the firmware host); two chains on one firmware copy both see the whole copy. The
master meter taps `destinationGain`, the node in front of the speakers.

Every 50 ms, with the pump meter's levels, the engine reads the last 2048 samples (about 43 ms) of each meter and sends
the peak in dBFS (`ScopeFrame.peak`, null for silence, `@master` for the mix). The Mixer page lets a bar fall 24 dB a
second, keeps the peak, and draws both on a canvas under the fader, whose track is clear and whose thumb is a small
triangle. The scale's numbers are text in the page, at the heights of the canvas's ticks: drawn on the canvas, they
were stretched as a picture when the panel grew, until the next draw, which never came with the song stopped. A
`ResizeObserver` on each well draws the canvas again when it changes size.

Seen on 2026-11-22 in a development host with the demo playing: peaks of -8.92 dB (vocals) to -20.64 dB (bass), -Inf
for chains not yet heard, and -5.38 dB on the master. The meters are after the gain, measured the same day in a muted
window: in `examples/10-electro.strudel`, G on `bassline` and its fader from 1 to 0.1 took its meter from about -7 to
about -24 dB and back to -3 at 1; a sawtooth with `.gain(slider(1, 0, 1))` went from -15.1 to -35.1 dB at 0.1. A
note without pan is mono, and the meter's input mixes it up to two channels (`channelCountMode: 'explicit'`), or the
right bar read silence. Not measured: how close the meter's peak is to the true peak
between two reads (a read sees 43 ms of every 50 ms).

## Render and record

Two buttons of Music Controls, beside Play and Stop, write a song's audio next to it, as a `.wav` and then an `.mp3`.
The Library lists those files under Render; a click opens them in VS Code's own media preview, which plays them.
Built on 2026-11-22 on `feat/render`.

| Button | What it makes | Files |
|---|---|---|
| Record (the red circle) | What plays, in real time, as heard: it plays the song if it does not, and a second click or Stop ends the take | `<song>.rec-<YYYYMMDD-HHMMSS>.wav` and `.mp3`, a new pair per take |
| Render audio (the arrow down) | The whole song from its start, played once with the speakers off, as long as it lasts | `<song>.wav` and `.mp3`, replaced at each render |

**Record** uses the recorder of the engine (`recorder()` in `src/webview/main.ts`, first made for the promo video): a
`ScriptProcessorNode` on superdough's `destinationGain`, the node in front of the speakers. For Record it keeps the
take as heard: a sample past full scale is clipped, as the speakers clipped it, and the host says the peak it found.

**Render** plays the song once from cycle 0 through the live engine, with the speakers off, and records superdough's
output with the recorder of Record, for the song's length plus 2 s of tail (`renderSong` in `src/webview/main.ts`). It
takes as long as the song, and the file is what the song sounds like: every effect, ducking, the firmwares. In order: the
song stops; `destinationGain` is disconnected from the speakers (the recorder and the master meter still hear it); MIDI
is muted (`setMidiMuted`), so a synth does not play along; the take starts; the song plays; the scheduler gets the same
pattern without the notes at or after the length (`filterHaps`), so it does not start a second round into the tail; at
the length the song stops, and the tail records what still sounds. The take keeps 0.25 s before the song starts. The
length is the song's header `// @length <cycles>` (the demo says 104), else the setting `strdltn.render.cycles` (16).
The host shows a notification for the length of the render; its Cancel stops the song, which ends the render without a
file. Audio must be on: in a window where it never was, the render asks for a click in the editor.

Measured on 2026-11-22 in a muted window: the demo (104 cycles, 187.7 s) rendered in 194 s into 189.9 s of audio, every
bar of every section with sound where the arrangement has it and the END silent; an 8-bar song with the kick masked on its
last bar had its first kick 0.12 s in, its last kick at 12.2 s, and nothing after.

The offline render it replaces is in the drawer ("Rendering a song offline").

**The MP3** is encoded in the host with `@breezystack/lamejs` 1.2.7 (LGPL-3.0, a maintained fork of lamejs), in
slices of about a second so the host stays responsive, at `strdltn.render.mp3Bitrate` (320 kbit/s by default). It is
the last step: the WAV is on disk even when the encoding fails.

Measured on 2026-11-22 in a development host on Windows: `07-vibefm1-obervave.strudel`, 16 cycles at 118 BPM
(32.5 s), rendered in 5.4 s, WAV 6.2 MB and MP3 1.3 MB; a 9 s Record of the demo gave 8.4 s of audio. Both showed under
Render in the Library.

## Devices

The Devices view is a tab of the bottom panel beside the Mixer (`strdltn.devices`, in its own container
`strdltn-devices`). It shows one panel per firmware copy that plays: one per firmware and orbit, as `vibefm1` runs
them. A panel has the firmware's own display, six soft keys F1 to F6 under it, and the parameters the firmware
declared (`vibe_wasm_param_info`) as sliders beside it. Built on 2026-11-21 on `feat/devices`; phase 4 steps 1 to 4
of `doc/DAW-PLAN.md`.

The firmware runs in the AudioWorklet of the engine that plays the song; the view is another webview. So:

| From | To | Message | What |
|---|---|---|---|
| worklet | engine page | `ready` with the parameter list | When the copy starts. The page keeps the copies that run in `running` (`src/webview/vibe/index.ts`) |
| engine | host | `devices {devices}` | When a copy starts or ends. The host keeps a list per engine (`DevicesView`) and sends the view all of them, with the song's file name and an id per engine |
| view | host | `request {engine, action, key, ...}` | Routed to the engine by its id, as `device {request}` |
| view | worklet | `draw {on}` | A panel open and shown: draw. Folded, or the view hidden: stop |
| worklet | view | `frame {px, values}` | `vibe_wasm_draw` between two blocks, about 30 a second, the whole 480 x 320 RGB565 frame as a `Uint8Array`, and every parameter's value. A frame equal to the last with the same values is not sent |
| view | worklet | `painted` | After the frame is on the canvas. The worklet sends no second frame before it: one frame in flight per panel, the rule of spike F1. A page that goes away without answering leaves the worklet waiting, so it draws nothing more until a new page asks |
| view | worklet | `param {index, value}` | A slider moved: `vibe_wasm_param_set` at the current frame. The slider stops following the frames while the hand holds it |
| view | worklet | `control {event, id, down, value}` | F1 to F6 as `VIBE_EV_BUTTON` (3) ids 0 to 5, down and up; the mouse wheel on the display as `VIBE_EV_ENCODER` (4) id `VE_DATA` (6), one detent a notch |

The view's page is not kept while hidden (no `retainContextWhenHidden`): a hidden page draws nothing.

**Fold, maximize, take out.** A panel folds with its arrow; the fold is kept per `<id>@<orbit>`, so the same
firmware on the same orbit stays folded in the next song. Maximize (the diagonal arrow) hides the other panels and
gives the screen the room of the view; the screen keeps its 3:2 with `object-fit: contain`. Take out (the arrow up
right) opens an editor tab `strdltn.deviceTab` with the same page for that one device. The firmware stays in the
engine; only its picture moves. The host keeps, per copy, the page that asked to draw it last (`owner` in
`DevicesView`): frames go only there, and a `draw off` or a `painted` from another page is ignored, so one frame
stays in flight per copy wherever it is shown. In the view, a panel that is in a tab says so; unfolding it brings
the picture back to the view, and the tab stops getting frames. A tab whose copy ends closes itself.

**SHRUB.** With the setting `strdltn.experimental.shrubEditor` on, the view ends with a SHRUB panel: Xfer's editor
(`https://shrub.audio/editor/`) in a frame, the same CSP as the mockup tab (`frame-src https://shrub.audio`). It is
its own synth, not in our mix. Folded, it is hidden with CSS and not removed, so its unsaved patches stay. Its take
out opens the mockup tab ("SHRUB editor panel" below). Phase 4 step 6.

Checked by hand on 2026-11-21 in a development host on Windows, with `template/examples/07-vibefm1-obervave.strudel`
playing: OBERVAVE's panels for orbits 2 and 3 in view, each with its own display ("56 DEEP BASS", "44 DARK PAD")
and its parameter values moving; the panel of orbit 4 is off to the right and was not looked at. Picture: `doc/screenshot-devices.png`. The maintainer's hand test of the same day passed: all three panels, the
wheel, F3 and F4 (PRG- and PRG+), a parameter slider, fold and unfold. Maximize and take out were then checked in a
development host with clicks sent through DevTools, from screenshots: one panel fills the view; the tab shows the
whole screen while the view's panel says "in a tab" and the other panels keep drawing. The SHRUB panel was seen with
the setting on, its frame blank because shrub.audio did not answer from that machine that evening. The integration
test records the copies, the frames that reached the view and a picture while `07-vibefm1-obervave.strudel` plays
(`steps.devices`, `tmp/shots/devices.png`). Not checked: a Codespace.

## SHRUB editor panel

An experimental mockup, to see how the SHRUB web editor would look inside VS Code. Off unless the setting
`strdltn.experimental.shrubEditor` is on; then the command "strdltn: Open SHRUB editor (experimental)" shows in the
palette and in the title bar of the Browser. Turning the setting off closes the tab. The tab is a `WebviewPanel` with
a toolbar and an `iframe` of `https://shrub.audio/editor/`. Its CSP allows frames from that origin only, and scripts only
with its nonce. `retainContextWhenHidden` keeps the editor's page, and its unsaved patches, while the tab is hidden.
"Open in browser" goes through `vscode.env.openExternal`. "Use in song" is disabled: it marks where a VIBE FM build of
SHRUB would connect.

Measured on 2026-11-21 (spike F3), desktop VS Code 1.147 on Windows 11, with the editor in a frame of a webview view in
the bottom panel and the mockup's CSP. shrub.audio sends no `X-Frame-Options` and no `frame-ancestors`, and the whole
editor loads in the frame: tabs, oscillators, keyboard. Its `AudioContext` is created at the first click on a key,
suspended, and runs right after it: on a real mouse press sent to the frame through DevTools, an analyser on its output
read an RMS of 0.31, at 4% render capacity. The window was muted (`--mute-audio`), so this proves the graph renders,
not that the speakers played. The click must be inside SHRUB's frame. A mouse press sent to the VS Code window at the
same spot reached the frame in one of three runs; one sent to the frame's own DevTools target always did. Why it stays
a mockup is in the drawer.
## Status bar

One item on the right of the status bar says what the song in front does. It replaced a
line of debug text in the corner of the webview.

| Text | When |
|---|---|
| `strdltn: loading` | The webview has no content yet |
| `strdltn: stopped`, `strdltn: playing` | The scheduler of that webview |
| `strdltn: click in the editor for sound` | The click overlay is up (see "Starting audio"). "stage" in the stage |
| `strdltn: error in the code`, `strdltn: playing, error in the code` | The last evaluation failed. Red background. The message is in the tooltip |
| `strdltn: <file> playing` | The tab in front is not a Strudel file and that song plays in another tab |

"The song in front" is the session whose panel is active (the Strudel editor or the
stage), or the stage of the native editor that is active. A Strudel file in the native
editor that has not played yet has no session and shows `stopped`. In any other tab the
item is hidden, unless a song plays in the background.

A click runs `strdltn.togglePlay`: stop when that song plays, play otherwise.

The webview sends `state` when the scheduler starts or stops, when the `AudioContext`
changes state, and when the overlay comes or goes.

## Stop

`strdltn.stop` (Ctrl+.) stops the song in front. When nothing plays there, it stops the
song that plays in another tab, the one the user was in last. So the key always ends a
sound that is heard, and a second press ends the next one. `strdltn.stopAll` stops
every song. It has no key.

## Errors in the code

Upstream reports a failed evaluation through `onEvalError`, as an `Error`. The webview
sends it to the host (`evaluated {error}`), and the host sets one diagnostic on the
document, with the source `strdltn`. It shows in the Problems view and as a squiggle in
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
| shown call | A message that shows a call, as our MIDI messages do: `... for example midin('...')` | The first call of `midin(` |

The last two take the first place the name is written outside a comment
(`withoutComments` blanks comments and skips strings, so the `//` of an address in a
string stays code). Before that, the `.midi()` in the header of
`examples/09-midi-out.strudel` took the mark. When the name is written more than once in
the code, that may still be the wrong one. An error that no rule places goes on the first
line.

The diagnostic is removed by the next evaluation that works, by closing the editor, and
by any edit of the document. After an edit the range would mark other text, and nothing
can check the code again without playing it. The status bar keeps the error and its
message until the next evaluation.

A sound that is not found, or a sample that does not load, is not an evaluation error.
It happens later, while the pattern plays, and only goes to Output > `strdltn`.

## Theme and font

| Setting | Default | Meaning |
|---|---|---|
| `strdltn.editor.theme` | `strudelTheme` | One of the 39 themes of `@strudel/codemirror` 1.3.0. It also colors the stage |
| `strdltn.editor.fontFamily` | empty | Empty: `editor.fontFamily` of VS Code |
| `strdltn.editor.fontSize` | 0 | 0: `editor.fontSize` of VS Code |

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
| The microphone in a webview (`getUserMedia({ audio: true })`), to get the outputs' names (spike S6, 2026-11-22, VS Code 1.147) | Refused: `NotAllowedError: Permission denied`, at once. After it, still 1 output with an empty label and id, so `setSinkId` has nothing to pick |
| A native MIDI module (`@julusian/midi`) in the extension host's runtime | Loads, lists inputs and outputs, sends in 0.05 ms |
| A 20 ms timer in the extension host's runtime, Windows | Late by 10 ms in the middle, 16 ms at the 95th percentile, 80 ms at worst |
| Drum machine banks in the Sounds view | 138 |
| Every file in `template/lib` and `template/examples` plays | 27 files, no error |
| A song with `samples('github:eddyflux/crate')`: sounds listed before the first play | Works, 18 sounds |
| The same pack copied to `.strdltn/cache/` and then answered from there | Works: 367 files, 175 MB |

In VS Code 1.147.0 on Windows, with `pnpm test:vscode`, on the branch `feat/m1-solid-core`:

| What | Result |
|---|---|
| Everything in the table above that the test covers | Still works. 134 drum machine banks now, the upstream list changed |
| A call of a function that does not exist (`.lfpx(200)`) | One problem on the document, on `lfpx` (rule "call"). The status bar says "playing, error in the code" and the old pattern keeps playing |
| A syntax error (`s("bd"))`) | One problem on the extra `)` (rule "position") |
| A mini-notation error (`s("bd [sd")`) | One problem on that line (rule "mini line") |
| An edit after an error | The problem is gone |
| A good evaluation after an error | The status bar says "playing" again |
| `strdltn.editor.theme` and `strdltn.editor.fontSize` changed while a song plays | The webview gets them without a reload. A new editor starts with the font of VS Code (Consolas, 14) |
| The sound list kept for the next start | 1651 sounds written and read back |
| Two songs playing, `strdltn.stop` in the tab of one | Only that one stops |
| `strdltn.stop` again, from a plain text tab | The status bar named the other song ("demo.strudel playing"), and it stops. Then the item hides |
| `strdltn.stopAll` with two songs playing | Both stop |
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
`strdltn.editor.theme` only colors the Strudel editor and the stage, as built; the
native editor keeps the VS Code theme.

Full `pnpm test:vscode` for the release of 1.0.0, in VS Code 1.147.0 on Windows, build
`v0.1.0-35-g4c54aec`: every step passed, the 27 template files played with no problem,
the Files view listed 29 songs, and the Sounds view had no Firmware group. That build was
the stable line without Firmware Hub; `main` holds Firmware Hub again since the merge of
`experimental`, and no full test has run on it yet.

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

The test can also click and type with real input. It drops `<name>.input`: the text the
target editor holds (`match`, because a Strudel editor kept in the background still says
it is visible) and a list of actions. The runner sends them to the window with
`Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`, which the browser treats as a
person's input, and writes `<name>.done` with what the editor holds after. To aim a
click, it asks the page for the screen position of a character through a small
read-only hook (`window.__strdltnTest`), and adds the place of the webview's frame in
the window. The DevTools target of a webview is VS Code's outer page; ours is a frame
inside it, so the runner reaches it through `iframe.contentWindow`. The cases ("typing"
and "typingCrlf" in the report) click into a string, after an inline scope, type fast,
type while the host edits the file (once, and ten times 20 ms apart), type while a fader
writes, undo, and click six places of `demo.strudel` while it plays with its visuals.
Each says where the click put the cursor, whether the document is the text expected,
whether the editor holds the same, and whether the file kept its line endings.

## Build pipeline

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests and on tags. It
installs with pnpm, type checks, runs the unit tests, and builds the `.vsix`, which it
uploads as an artifact. On a tag `v*` it also checks that the tag matches the version in
`package.json` and creates a GitHub release with two files: `strdltn-<version>.vsix`
and `strdltn.vsix`. The second has a fixed name so that
`releases/latest/download/strdltn.vsix` always works.

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

[str]dltn Live[code] has no page on the home page yet. What follows is how the page of
vstrudel is built, and the same steps would apply with new names.

The `doc/ABOUT.md` of vstrudel is shown at <https://www-alienmind.vercel.app/vstrudel/index.html>. The
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
| Promoted | `.bin/strdltn.vsix`, installed into the maintainer's VS Code | Every normal VS Code window | Only when `pnpm promote` runs |

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

To see which copy a window runs: the first line of Output > `strdltn`, or the command
"strdltn: Show version and build". It shows the version, the `git describe` of the
build, and `production` or `development`.

For fast work on the work in progress: `pnpm watch`, press F5 once, and use "Developer:
Reload Window" in the development host after a change.

## MIDI

A webview may not use WebMIDI, so MIDI goes through the extension host with
`@julusian/midi` 3.9.0 (MIT), see "MIDI" in `doc/TODO.md`.

```
webview (src/webview/midi.ts)          host (src/extension/midi.ts)     worker (midi-worker.ts)
.midi() onTrigger -> hapMessages   -> midiOut {port?, bytes, at} ->  resolves the port, queue,
  at = heard time on the host clock                                  sleeps, spins, sends
midiPing every 5 s                 <- midiPong {now}                 reads the ports every 2 s
midin()/midikeys() <- midiIn       <- for engines that listen    <- input message
stop -> midiPanic                  -> panic(engine)              -> notes off of that engine
```

- The Library's MIDI category lists the outputs ("Outputs: instruments") and the inputs
  ("Inputs: controllers") as `midiItem`s. The extension starts the worker at activation
  where the host is local (`vscode.env.remoteName` unset) and passes each new port list
  to the Browser (`MidiBridge.onPorts`), so a device plugged in shows within 2 s. A click
  types `.midi('name')` or `const cc = await midin('name')` (single quotes: a double-quoted
  string is mini-notation, a pattern of its words, which upstream's `midin` refuses; ours joins
  the words of its first cycle back into the name, so `midin("MPK mini 3")` works too, measured
  with loopMIDI on 2026-11-22). Inside a string it types the name alone, inside the empty
  parentheses of `.midi()`, `midin()` or `midikeys()` the name in quotes (`chooseInsert` in
  `src/shared/context.ts`, the item's `argument`). Copy copies the name.
- Debugging: the setting `strdltn.midi.debug` (the command "strdltn: Show MIDI messages in
  the Output" turns it on and off) writes every message in and out to Output > strdltn as
  text (`describeMidi`): `in <- MPK mini 3: CC 70 = 64 (ch 1)`, `out -> M-VAVE FM-1: note on
  c3 (48) vel 94 (ch 1)`, and "no song listens to this device" when nothing called `midin`
  for it. While it is on, the bridge opens every input, so a controller shows before any
  song uses it. Seen on 2026-11-22 in a muted window: CC 70 = 94 sent into loopMIDI, and the
  next note of `velocity(knobs(70))` went out with velocity 94.
- Devices tried by hand on 2026-11-22: the maintainer's MPK mini 3 sends CC 1 to 8 from its
  eight knobs; Xfer's SHRUB on the M-VAVE FM-1 takes CC 74 as its filter cutoff (the stock
  firmware has cutoff on CC 2). SHRUB's macros are said to be on CC 16 to 19, not tried.
- Our `.midi()`, `midin()`, `midikeys()`, `midimaps()` and `defaultmidimap()` take the
  upstream names and options, so a song from strudel.cc runs. `@strudel/midi` is not
  bundled (it needs WebMIDI). The rules that turn a hap into bytes, pick a port and keep
  the queue are in `src/shared/midi.ts`, with unit tests.
- Time: `onTrigger` gives the AudioContext time a note is due. The webview turns it into
  the time it is heard with `getOutputTimestamp()`, then into the host's clock
  (`performance.timeOrigin + performance.now()` on both sides) with the offset that
  `ClockOffset` keeps from pings: the guess of the shortest round trip of the last 8. A
  note leaves about 100 ms early; `latencyMs` of `.midi()` adds to its time.
- The worker starts with the first MIDI message of a song, so a song without MIDI never
  loads the native module. It owns every port (a WinMM port opens once only). It resolves
  the port a song names (index, name, part of a name, else the first IAC or first port)
  itself, because it reads the ports before it takes a message; so the first notes of a
  song do not wait for the port list. A port opens when its first events arrive, and an
  active sensing byte warms it up.
- Panic: a stop drops the engine's queued events and sends a note off for each note it
  holds; closing the extension sends CC 123 on every channel of every open port too.
- Packaging: the worker is its own bundle, `dist/midi-worker.cjs`. The loader of
  `@julusian/midi` looks for the binaries in `<bundle's folder>/prebuilds`, so the build
  copies them to `dist/prebuilds/` (2.2 MB, every platform). `pnpm-workspace.yaml` says
  `false` for its install script, which only checks for them or runs node-gyp.

Measured end to end on 2026-11-21, in a muted VS Code 1.147 window with a song that sends
`note("c3*8")` at 120 BPM to loopMIDI, the notes taken back from loopMIDI's input by
another process: 55 notes, the spacing within 0.09 ms of 250 ms in the middle, 1.0 ms at
the 95th percentile, 1.34 ms at worst; the worker sent at most 0.02 ms late. A second run
with `midin('loopMIDI')` reading CC 7 into the velocity: the velocity followed the CC
(13, then 127), spacing 3.1 ms at worst. Not measured: how close the MIDI is to the sound
of the same song at the speakers.

Spike S5 measured
how exactly the host can send, on 2026-11-21, on the maintainer's Windows 11 machine, in
VS Code 1.147's Electron 43.8.9 run as Node (`ELECTRON_RUN_AS_NODE=1`), with
`@julusian/midi` 3.9.0. The setup: a `worker_thread` keeps the notes in a queue ordered
by due time; the main thread posts each note 100 to 150 ms before it is due, a new one
every 10 to 30 ms, and is kept busy 0 to 20 ms of every 50; 1000 notes a run.

| How the worker waits | Port | Late: middle | 95th | 99th | worst |
|---|---|---|---|---|---|
| Plain `setTimeout` on the main thread | loopMIDI | 0.16 ms | 10.9 ms | 16.2 ms | 20.9 ms |
| `Atomics.wait` to 1 ms before, then spin | loopMIDI | 0 | 1.0 ms | 10.0 ms | 35.7 ms |
| The same, process priority high | loopMIDI | 0 | 0.84 ms | 1.15 ms | 1.6 ms |
| The same, process priority high | UMC404HD (hardware) | 5.7 ms | 13.6 ms | 14.9 ms | 17.1 ms |
| `Atomics.wait` to 17 ms before, then spin, priority high | UMC404HD | 0 | 0 | 0.10 ms | 0.45 ms |
| The same | Microsoft GS Wavetable Synth | 0 | 0 | 0.02 ms | 10.6 ms |

What we learned from it:

- `Atomics.wait` sleeps in steps of Windows' timer tick, 15.6 ms, unless something in the
  process asked for a finer timer. Opening the loopMIDI port seems to do that (its runs
  overslept by about 1 ms); the hardware port and the GS synth do not (10 to 15 ms). A
  sender that trusts a short sleep is exact only by luck. So the worker sleeps until 17 ms
  before a note and spins from there. That costs CPU: the whole process used 0.55 of a
  core against 0.2 for the short margin, with the main thread's own load in both.
- High process priority (`os.setPriority`) removed the long outliers of 20 to 80 ms.
  It is the priority of the whole extension host, so every other extension is raised
  too. That is why it is the setting `strdltn.midi.highPriority`, off by default: the
  bridge raises the priority when its worker starts and puts the old one back when the
  worker ends or the setting goes off.
- The GS Wavetable Synth's `sendMessage` itself sometimes blocks 8 to 14 ms. It is a
  software synth; a hardware port returned in under 0.5 ms.
- A WinMM output can be open in one place only: a second `openPort` fails with
  `MMRESULT 4` (already allocated). One owner per port, the worker.
- The first notes after start are late (4 to 74 ms): the first send costs about 40 ms. A
  silent message at open warms it up.

## Sliders on knobs

`slider(800, 200, 4000).knob(74)`: CC 74 of any MIDI input moves that slider, as a drag
does. The rules are in `src/shared/knob.ts` with tests; the page side is in
`src/webview/main.ts` ("Sliders on knobs").

- The song defines `knob` itself, with a snippet that MIDI learn puts after the header
  the first time: `register('knob', (cc, pat) => pat)`. It returns the pattern as it is,
  so the song is standard Strudel and plays on strudel.cc, where the knob does nothing.
  This is less than the first design (the knob would change the sound on strudel.cc too):
  that needed `midin()`, and upstream's `midin()` without a name takes the first input
  and throws when there is none (read in `@strudel/midi` 1.2.6), while the maintainer
  wanted any controller and no failure without one. A knob there would also not know the
  slider's range.
- In [str]dltn the page reads the bindings from the code it evaluated (`findKnobs`), so
  each binding's `from` is the slider's id (`slider_<from>`). It listens to every MIDI
  input (`listenEverywhere`), and a CC goes through `pickup` and then `moveSlider`, the
  same path as a Mixer fader: the sound at once, the widget and the number in the code at
  most every 150 ms.
- Pickup (the maintainer's choice): a knob moves the slider only once it reaches or passes
  the slider's value. The value it compares with is upstream's `sliderValues[id]`, not the
  number in the code: the code follows 150 ms late, so a turning knob would read its own
  move as a drag and let go. A drag, a fader or an edit that sets another value drops the
  knob until it catches up again. A new evaluation starts every knob over.
- MIDI learn is done by the host (`src/extension/knobs.ts`, `KnobLearn.learn`), which owns
  the ports: `MidiBridge.captureCC` opens every input and waits up to 10 s for the next CC.
  Then `knobEdits` writes `.knob(cc)` on the slider call, or changes the number of the one
  there, plus the snippet the first time, as one `WorkspaceEdit`, and the song is evaluated
  again where it plays, so the knob works at once. It works with no song playing and in
  either editor. The places that ask, each giving where the slider's number starts:
  - the knob button left of a line in the Strudel editor: a CodeMirror `gutter()` of ours
    with `Prec.highest`, so it comes before upstream's line numbers (`lineActions` in
    `src/webview/main.ts`). The page sends `knobLearnAt`;
  - a double click on a slider's widget (`knobLearnAt` too);
  - the knob button on every fader of the Mixer, which knows its slider's `from`.
    `readChains` reads `.knob(n)` on a slider as `MixerSlider.knob`, so the button shows
    the CC;
  - in the native editor: an icon in the glyph margin on every line with a slider
    (`gutterIconPath`, filled when mapped), and the line number menu
    (`editor/lineNumber/context`, "Map a MIDI knob to this line's slider");
  - `strdltn.knobLearn` (Ctrl+Alt+K) for the slider under the cursor, in either editor.
- The native editor's icon: VS Code's API gives no click on a gutter icon. A click in the
  glyph margin is expected to select the whole line, as a click on a line number does, and
  `onDidChangeTextEditorSelection` with `kind == Mouse` sees that. `KnobLearn` takes a whole
  line selected by the mouse on a line with a slider as a click on its knob, and logs it.
  Expected, not measured; the catch is that a click on that line's number does the same.
- The Mixer's faders follow live. The Mixer reads the code again only 300 ms after the
  last change, and a turning knob writes every 150 ms, so its fader waited until the knob
  stopped. Now the page passes every `cm-slider` message (a drag, a knob, a fader) to the
  host as `sliderLive` with where the number is now, and the Mixer moves the fader of the
  slider that starts there. Not while one of its own faders is held.
- A knob already in the code should work on the stage too, as the fader does: expected,
  not tested.

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

Found on 2026-11-21: the workflow has never run on this repository (zero runs; Actions shows as enabled), so the
tag `v0.3.0` built nothing. Measured on 2026-11-22: still zero runs after the merge of PR #9 to `main`, although the
API says Actions is enabled with all actions allowed and `ci.yml` is `active`. The repository is not a fork in
GitHub's eyes (`fork: false`), so the fork rule (workflows off until enabled once) is not the reason, or not the
whole one. vstrudel ran the same workflow 32 times, the last on 2026-11-20 at 14:48, six minutes before this
repository was made. The reason, seen on 2026-11-22: the Actions tab showed "Workflows aren't being run on this
repository" with a button "Enable Actions on this repository", which the API does not offer and does not report
(it said `enabled: true` all along). One click turned the workflows on. That release was made by hand, the same steps as `ci.yml`: the tag checked out, `pnpm typecheck`,
`pnpm test:unit`, `pnpm package`, a copy as `strdltn.vsix`, then `gh release create v0.3.0 *.vsix --generate-notes`.
The promo video went in as a third asset, `strdltn-promo.mp4`. GitHub serves release assets as
`application/octet-stream` whatever type they were uploaded with, so a link to it downloads the file; it does not play
in a browser or a link preview.

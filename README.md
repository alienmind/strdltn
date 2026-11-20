<p align="center">
  <img src="doc/logo.jpg" alt="vstrudel - VS Code extension, live coding in strudel.cc" width="760">
</p>

# vstrudel

**vstrudel is a VS Code extension. It turns your editor into a Strudel IDE whenever you
open a `.strudel` file.**

[Strudel](https://strudel.cc) is a language for making music with code. vstrudel embeds
the real Strudel, the same editor and the same sound engine as strudel.cc, and adds
panels around it for the things a web page cannot give you:

- **Files**: the songs of your project, without everything else.
- **Sounds**: every instrument you can play, to browse, hear and insert. Drum machines
  by bank, synths, soundfonts, and your own samples.
- **Snippets**: your own library of reusable code, with a description and a preview of
  each piece, one click away from your song.
- **Your files**: songs, samples and snippets are plain files in a folder, so they work
  with git, search and everything else in your editor.

It also runs in **GitHub Codespaces**. That gives a second way to use it: keep each
music project as a repository and open it in a browser from any machine, with nothing
installed. Fork this repository, open your fork in a Codespace, and start from the
`template/` folder.

Free and open source, AGPL-3.0-or-later like Strudel. **Version 0.2.0.** See
`doc/TODO.md` for what is missing.

## Install

**In VS Code:** download `vstrudel.vsix` from the
[latest release](https://github.com/alienmind/vstrudel/releases/latest). In the
Extensions view press `...` and choose "Install from VSIX...". Then make a file called
`song.strudel`, type `s("bd sd, hh*4")`, click in the code and press Ctrl+Enter.

**In Codespaces:** on GitHub press Code, Codespaces, `...`, "New with options", and
choose the configuration "vstrudel template (released extension)". Open
`demo.strudel`, click in the code and press Ctrl+Enter. The sound comes out of your
browser.

## Features

**Editor**

- The real Strudel editor for `.strudel` files: the upstream packages, not a copy.
- Inline scopes, piano rolls and other visuals under the line that makes them.
- Sliders inside the code that you drag while the song plays.
- The notes that are sounding are outlined in the code.
- Hydra visuals behind the code.
- One button switches a file between the Strudel editor and the native VS Code editor.
- A stage beside the native editor: sliders and visuals, each with a name taken from
  your code.
- Edits from outside (git, another editor, an AI agent) show up at once, while it plays.
- An error in the code is underlined and listed in the Problems view, and the song keeps
  playing what worked last.
- A status bar item says what the song does (playing, stopped, error) and plays or stops
  it with a click.
- Settings for the theme of the editor (the 39 themes of strudel.cc) and its font. By
  default the font and size are those of your VS Code editor.
- Ctrl+. stops the song in front. Press it again to stop a song that plays in another
  tab. "vstrudel: Stop all" stops every song.

**Sounds**

- All the sounds of strudel.cc: drum machines, piano, the VCSL instruments, the General
  MIDI soundfonts, the synths.
- A Sounds view that lists everything you can play, with an icon per kind.
- Drum machines grouped by bank.
- A click on a sound plays it when preview is on. It never types.
- Two buttons on each sound: one types its name at the cursor, one plays it.
- A button on a bank types `.bank("...")`.
- The list is there as soon as VS Code starts, before you open a song.
- Your own samples: audio files in a `samples/` folder are sounds, with no setup. New
  files appear without a reload.
- Sample packs from GitHub (`samples('github:user/repo')`) or from any address
  (`samples('https://.../strudel.json')`) are listed before you press play, get their
  own group, and are copied into your project so they play offline.
- Commands show how much space the copies take, and delete them.
- Synths from [The Firmware Hub](https://thefirmwarehub.com): put VIBE FM firmwares
  (`.wasm`) in a `firmware/` folder, or load one from an address with
  `firmware('https://.../name.wasm')`, which is kept in your project so it plays
  offline. Play them through one instrument, `s("vibefm1:<name>")`, in time with the
  rest of the song. The firmware can change per step (`s("vibefm1:<obervave sloop>")`)
  and `.progNum()` picks its sound. Two examples show how. Effects on its line, such as
  `.room()`, do not reach it yet.

**Snippets**

- A Snippets view over the `.strudel` files in your `lib/` folder, grouped by folder,
  with a colored dot per category and the tags of each snippet.
- Rest the mouse on a snippet: its description and its code in color float beside it.
- Two buttons on each snippet: one inserts the code at the cursor, one opens the file.
- Snippets describe themselves in comments at the top of the file.

**Projects**

- Songs, samples and snippets are plain files: git, search and folders work as usual.
- A Files view lists every folder of your project that holds songs, and only those.
- Ready for AI assistants such as Copilot: the template tells them that "add a bass line"
  means a change to the song you have open, and gives them the Strudel reference and
  tutorial to look things up.
- A template to start from, with a demo song, examples and a library of snippets.
- Runs in GitHub Codespaces: fork, open, play.

Experimental, off by default: the setting `vstrudel.experimental.shrubEditor` adds a tab
with Xfer's SHRUB web editor, to see how it would look. It is not connected to your songs.

Not there yet: MIDI, sound across a switch of editor, completion and hover in the code,
the Marketplace. See `doc/TODO.md`.

## A closer look

### The Strudel editor

`.strudel` files open in the editor of strudel.cc: inline scopes and piano rolls under
the line that makes them, sliders inside the code, and an outline on the notes that are
playing. Hydra visuals work too.

A button in the title bar switches the same file to the native VS Code editor, for
bigger edits with your own keys, extensions and AI completion. Press play there and a
stage opens beside the code. It lists the sliders of the song, then its visuals. Each
row is named from your code: the name of the pattern (`$kick:`), the name of a variable,
the comment above the line, or the code itself. Drag a slider there and the number in
the code follows.

Edits made outside the editor, by git or by an agent, show up at once, even while the
song plays.

### Sounds

The vstrudel icon in the activity bar opens the side bar: the logo, then the Files,
Sounds and Snippets views. Sounds lists what the engine can play, your own samples
first:

- A click on a sound plays it when preview is on. The title of the view says "preview
  on" or "preview off", and the speaker button at the top switches it.
- A click never types. The first button on a row types the name at the cursor, the
  second plays it.
- Drum machines are grouped by bank. The button on a bank types `.bank("RolandTR909")`.

Your own samples need no setup. A folder `samples/kick/` with audio files in it becomes
`s("kick")`, and `s("kick:1")` is its second file. A new folder shows up a few seconds
after you copy it in.

A song can load a pack from GitHub with `samples('github:user/repo')`, or from any
address with `samples('https://.../strudel.json')`. The pack shows up in the Sounds view
when you open the file, and it is copied into `.vstrudel/` in your project, so next time
it plays without the network. That folder ignores itself for git. "vstrudel: Show sample
pack cache size" says how much it holds, and "vstrudel: Clear sample pack cache" deletes
it.

### Snippets

Put `.strudel` files in a `lib/` folder and they appear in the Snippets view, grouped by
folder. Rest the mouse on a snippet to see its description and its code. The first
button on the row inserts the code at the cursor, the second opens the file.

A snippet describes itself in comments at the top:

```
// @title Four on the floor
// @category drums
// @details Kick on every beat, clap on 2 and 4, open hat on the off beat.
// @tags house, techno, 909
// @by alienmind
s("bd*4, ~ cp ~ cp, [~ oh]*4").bank("RolandTR909")
```

Only the code is inserted. The categories are `drums`, `bass`, `melody`, `chords`,
`texture`, `effect`, `function`, `song` and `visual`.

### Errors and the status bar

When the code has an error, the song keeps playing what worked last. The error is
underlined in the native editor, listed in the Problems view, and the status bar item
turns red with the message. The item also says whether the song plays, and a click on it
plays or stops.

### Settings

| Setting | Does |
|---|---|
| `vstrudel.editor.theme` | The color theme of the Strudel editor, one of the themes of strudel.cc |
| `vstrudel.editor.fontFamily`, `vstrudel.editor.fontSize` | Its font. Empty and 0 take the font of your VS Code editor |
| `vstrudel.samplesFolder` | The folder of your own samples. Default `samples` |
| `vstrudel.libFolder` | The folder of your snippets. Default `lib` |
| `vstrudel.remoteSamples.cache`, `vstrudel.remoteSamples.maxFiles` | Whether packs are copied into the project, and up to how many files |

## Keys

| Key | Does |
|---|---|
| Ctrl+Enter | Play, or update the playing pattern |
| Ctrl+. | Stop the song in front. Again: stop the song that plays in another tab |
| Ctrl+Alt+M | Switch between the Strudel editor and the native editor |

On a Mac use Cmd in place of Ctrl.

The first time you press play from a button or from the native editor, the page may ask
for one click ("Click to enable audio"). Browsers do not start sound without a click.

## The template

`template/` is a starting point for a music project:

| Folder | Holds |
|---|---|
| `demo.strudel` | A first song |
| `examples/` | Songs to learn from and to play, from a first beat to full tracks |
| `lib/` | Snippets: drums, bass lines, chords, effects, helper functions |
| `samples/` | Your own audio files |
| `AGENTS.md`, `.github/` | Rules for an AI assistant such as Copilot: a request like "add a bass line" changes the song you have open |
| `reference/` | Every Strudel function and the strudel.cc tutorial as text, for the assistant to look things up |

## Work on vstrudel itself

You need Node 24 and pnpm.

```
pnpm install
pnpm build
```

Then press F5 in VS Code. A second window opens on the `template/` folder with the
extension loaded.

| Command | Does |
|---|---|
| `pnpm watch` | Rebuild on every change |
| `pnpm typecheck` | Type check without building |
| `pnpm test:unit` | Run the unit tests, for now the rules that name things in the stage |
| `pnpm smoke` | Serve the editor in a plain browser, muted, to test without VS Code |
| `pnpm test:quick` | The integration test for a small change: silent, about 75 seconds |
| `pnpm test:vscode` | The full integration test inside a real VS Code. Plays sound, about ten minutes |
| `pnpm reference`, `pnpm tutorial` | Write `template/reference/` again from upstream |
| `pnpm package` | Build a `.vsix` |
| `pnpm promote` | Build a release copy into `.bin/` and install it in your own VS Code |

| Folder | Holds |
|---|---|
| `src/extension/` | The part that runs in VS Code |
| `src/webview/` | The page that hosts the Strudel editor and makes the sound |
| `doc/` | Architecture, open work and dropped ideas |

## Thanks

All of the music making is [Strudel](https://codeberg.org/uzu/strudel), by Felix Roos,
Alex McLean and the Strudel contributors. vstrudel hosts the upstream `@strudel/*`
packages unchanged.

<p align="center">
  <img src="doc/logo.jpg" alt="vstrudel - VS Code extension, live coding in strudel.cc" width="760">
</p>

# vstrudel

**vstrudel is a VS Code extension. It turns your editor into a Strudel IDE whenever you
open a `.strudel` file.**

[Strudel](https://strudel.cc) is a language for making music with code. vstrudel embeds
the real Strudel, the same editor and the same sound engine as strudel.cc, and adds
panels around it for the things a web page cannot give you:

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

Free and open source, AGPL-3.0-or-later like Strudel. **Early: version 0.0.3.** See
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

## What you get

### The Strudel editor

`.strudel` files open in the editor of strudel.cc: inline scopes and piano rolls under
the line that makes them, sliders inside the code, and an outline on the notes that are
playing. Hydra visuals work too.

A button in the title bar switches the same file to the native VS Code editor, for
bigger edits with your own keys, extensions and AI completion. Press play there and a
stage opens beside the code with the visuals.

Edits made outside the editor, by git or by an agent, show up at once, even while the
song plays.

### Sounds

The vstrudel icon in the activity bar opens the Sounds view. It lists what the engine
can play, your own samples first:

- A click types the name of the sound at the cursor.
- With the speaker button at the top of the view on, the click also plays the sound.
- Drum machines are grouped by bank. The button on a bank types `.bank("RolandTR909")`.

Your own samples need no setup. A folder `samples/kick/` with audio files in it becomes
`s("kick")`, and `s("kick:1")` is its second file. A new folder shows up a few seconds
after you copy it in.

### Snippets

Put `.strudel` files in a `lib/` folder and they appear in the Snippets view, grouped by
folder. A click opens a card with a description, the code in color and an "Insert at
cursor" button. A double click opens the file.

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

## Keys

| Key | Does |
|---|---|
| Ctrl+Enter | Play, or update the playing pattern |
| Ctrl+. | Stop |
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
| `pnpm smoke` | Serve the editor in a plain browser, muted, to test without VS Code |
| `pnpm test:vscode` | Run the integration test inside a real VS Code |
| `pnpm package` | Build a `.vsix` |
| `pnpm promote` | Build a release copy into `.bin/` and install it in your own VS Code |

| Folder | Holds |
|---|---|
| `src/extension/` | The part that runs in VS Code |
| `src/webview/` | The page that hosts the Strudel editor and makes the sound |
| `src/snippets-view/` | The page of the Snippets view |
| `doc/` | Architecture, open work and dropped ideas |

## Thanks

All of the music making is [Strudel](https://codeberg.org/uzu/strudel), by Felix Roos,
Alex McLean and the Strudel contributors. vstrudel hosts the upstream `@strudel/*`
packages unchanged.

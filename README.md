# vstrudel

[Strudel](https://strudel.cc) live coding inside VS Code. Open a `.strudel` file, press
Ctrl+Enter, and it plays. Your patterns are plain files in a folder, next to your own
samples and your own library of snippets.

vstrudel hosts the upstream Strudel packages (`@strudel/*`, source at
[codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel)). It is licensed
AGPL-3.0-or-later, like Strudel.

**Status: early, version 0.0.2.** Version 0.0.1 was heard playing on desktop and in
Codespaces. An automated test covers the rest. See `doc/TODO.md` for what is missing.

## What works

- `.strudel` files open in the Strudel editor: the same editor as strudel.cc, with
  inline scopes, piano rolls, sliders and highlighting of the notes that are playing.
- A button in the title bar switches the same file between the Strudel editor and the
  native VS Code editor.
- In the native editor, play opens a stage beside the code. The stage shows the visuals
  without the code.
- Audio files under `samples/` in your project are sounds. A folder `samples/kick/`
  becomes `s("kick")`. New files work without a reload.
- The sounds of strudel.cc are there: drum machines, piano, the VCSL instruments, the
  General MIDI soundfonts and the synths.
- The Strudel icon in the activity bar opens two views. **Sounds** lists everything you
  can play, your own samples first. Click a sound to hear it, press the insert button to
  type its name at the cursor. **Snippets** lists the `.strudel` files in your `lib/`
  folder. Click one to paste it at the cursor.
- Edits made outside the editor (another editor, git, an agent) show up live.

The first time you press play from a button or from the native editor, the page may ask
for one click ("Click to enable audio"). Browsers do not start sound without a click.

## Try it in Codespaces

Create a Codespace on this repo and choose the configuration "vstrudel template
(released extension)". It opens the `template/` folder with the extension installed.
Open `demo.strudel`, click in the code and press Ctrl+Enter.

## Keys

| Key | Does |
|---|---|
| Ctrl+Enter | Play, or update the playing pattern |
| Ctrl+. | Stop |
| Ctrl+Alt+M | Switch between Strudel editor and native editor |

## Run it from source

You need Node 24 and pnpm. A tag `v*` on GitHub builds a release with the `.vsix`.

```
pnpm install
pnpm build
```

Then press F5 in VS Code. A second window opens on the `template/` folder with the
extension loaded. Open `demo.strudel`.

Other commands:

| Command | Does |
|---|---|
| `pnpm watch` | Rebuild on every change |
| `pnpm typecheck` | Type check without building |
| `pnpm smoke` | Serve the editor in a plain browser, muted, to test without VS Code |
| `pnpm test:vscode` | Run the integration test inside a real VS Code |
| `pnpm package` | Build a `.vsix` |

## Folders

| Folder | Holds |
|---|---|
| `src/extension/` | The part that runs in VS Code |
| `src/webview/` | The page that hosts the Strudel editor and makes the sound |
| `template/` | The starter project: `samples/`, `lib/` and a demo song |
| `doc/` | Architecture, open work and dropped ideas |

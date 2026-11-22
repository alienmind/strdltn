<p align="center">
  <img src="doc/logo.jpg" alt="[str]dltn Live[code] - your IDE is your DAW" width="760">
</p>

# [str]dltn Live[code]

> **[UNOFFICIAL NOTE]** [str]dltn Live[code] is an independent project. It is neither an
> official project nor a component of Strudel, and it is not endorsed or supported by the
> Strudel authors. It is an independent, AGPL-3.0-or-later derivative work that uses
> Strudel's published packages (`@strudel/*` on npm). For Strudel itself, see
> [strudel.cc](https://strudel.cc) and its source at
> [codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel). Please report problems with
> this extension [here](https://github.com/alienmind/strdltn/issues), not to the Strudel
> project.

**[str]dltn Live[code] is a VS Code extension for Strudel live coding. However it is much more than that...
it turns your editor in a DAW for Strudel music production.**

[Strudel](https://strudel.cc) is a language for making music with code. [str]dltn Live[code] embeds
the real Strudel, the same editor and the same sound engine as strudel.cc, and adds
panels around it for the things a web page cannot give you, in the manner of Ableton
Live:

- **Mixer**: a strip per part of the song you play, with faders, mute, solo and sidechain
  cables you drag. Every change is plain Strudel code.
- **Music Controls**: Play, Stop and the BPM of the song, in one row at the top of the Library.
- **Browser**: every sound, snippet, song and function, with one search, colors and tags.
  Click a sound to hear it, even with no song open.
- **Your files**: songs, samples and snippets are plain files in a folder, so they work
  with git, search and everything else in your editor.

![demo.strudel playing: the Strudel editor, the Browser on the left, the Mixer below](doc/screenshot-overview.png)

It also runs in **GitHub Codespaces**. That gives a second way to use it: keep each
music project as a repository and open it in a browser from any machine, with nothing
installed. Fork this repository, open your fork in a Codespace, and start from the
`template/` folder.

Free and open source, AGPL-3.0-or-later like Strudel. **Version 0.4.0**, in progress: MIDI on desktop. See
`doc/TODO.md` for what is missing.

This project is a fork of [vstrudel](https://github.com/alienmind/vstrudel). We forked
it because the scope grew beyond a VS Code extension.

## Install

**In VS Code:** download `strdltn.vsix` from the
[latest release](https://github.com/alienmind/strdltn/releases/latest). In the
Extensions view press `...` and choose "Install from VSIX...". Then make a file called
`song.strudel`, type `s("bd sd, hh*4")`, click in the code and press Ctrl+Enter.

**In Codespaces:** on GitHub press Code, Codespaces, `...`, "New with options", and
choose the configuration "[str]dltn Live[code] template (released extension)". Open
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
  tab. "strdltn: Stop all" stops every song.

**Mixer and Music Controls**

- Music Controls, one row at the top of the Library, with Play, Stop and the BPM of the song. Type a BPM to write `setcpm(<bpm>/4)`;
  double click it to go back to Strudel's default, 120.
- A mixer in the bottom panel, next to Terminal: one strip per chain of the song in front
  (`$kick:`, `bass:`), side by side as in the Session view of Live.
- A strip shows the slider in the chain's `.gain()` as a fader. Unfold it to see every
  other slider of the chain. A slider assigned to a constant (`const KICK_VOL =
  slider(...)`) shows in the chain that uses the constant.
- M and S on each strip, above its scope. M mutes and S solos the chain, written as
  upstream's own labels (`_kick:`, `Skick:`); a song that plays is updated at once.
- A click on the gain fader's triangle, without dragging it, takes the gain fader out of the
  code; on a chain without one, the dim triangle puts one in (`.gain(slider(1, 0, 1))`).
  The gain's value shows in the corner of the strip's scope.
- The jack at the foot of a strip tells its orbit when the mouse is over it.
- Sidechain cables: a chain with `.duck("2:3")` is cabled to the chains on those orbits.
  Drag from the jack at the foot of a strip onto another strip to duck it; pull a cable off
  by its end to stop. The code gets the `.duck()`, and an `.orbit()` of its own for a
  target that had none.
- A fader changes the sound at once and the number in the code a moment later, like the
  slider in the code. Moving the slider in the code moves the fader.
- A pump meter under the faders of each strip: it pumps with the chain's notes while the
  song plays, green when the chain has `._scope()`, a gray flat line when not. A click
  adds or removes `._scope()`.
- A song or snippet without `$:` labels shows as one strip named after the file.
- The Mixer comes to the front when a song starts playing.
- The window button in the Mixer's title floats it in a window of its own. The dock
  button, or closing that window, puts it back in the panel.

- A level meter behind each strip's gain fader, as in Live: two bars on a 0 to 60 dB scale, and the highest peak
  above them, orange when it went over 0 dB. A click starts the peak again. A Master strip meters the whole mix.

**Render and record**

- Record, the red circle in Music Controls: plays the song and records what you hear into a `.wav` and an `.mp3` next to
  it. Click again, or Stop, to end the take. Each take is kept.
- Render audio, the arrow down: makes the whole song at full speed, without sound, into `<song>.wav` and `<song>.mp3`.
  A song says its length with `// @length <cycles>` in its header; without it, 16 cycles (setting
  `strdltn.render.cycles`). Firmwares are in the render too.
- The MP3's bitrate is the setting `strdltn.render.mp3Bitrate` (320 kbit/s by default).
- Renders and recordings show under Render in the Library. A click plays one.

**Devices**

- A Devices tab in the bottom panel, next to the Mixer: one panel per firmware that plays
  (`s("vibefm1:obervave")`), with the firmware's own screen, its six soft keys F1 to F6
  and its parameters as sliders. The mouse wheel over the screen turns its DATA knob.
- Fold a panel, fill the view with it, or take it out into a tab of its own.

![OBERVAVE playing on two orbits, each with its own panel in the Devices tab](doc/screenshot-devices.png)

**Browser**

- A Browser in the side bar, like the browser of Ableton Live, in four views. Library
  (search, seven colors, a Built-in switch, and Sounds, Drums, Samples, Instruments),
  Songs and Snippets, and Reference (every function of Strudel) pick what you see;
  Results shows it all in one list, with tag chips and details.
- Search by name, bank, folder, description or tag. Every word must match. `#kick`
  looks only at tags.
- Tags come by themselves from the names: Kick, Snare, Hihat... for drums, Bass, Pad,
  Keys... for instruments, the maker of a drum machine, where a sound comes from. Click a
  chip to filter, Ctrl+click to take several of a group.
- Put anything in a collection: the tag button on a row, the color dots under the
  selected item, or the keys 1 to 7 (0 clears). Your own tags come from the same button
  ("Edit tags...") or the "Tags..." button. They are kept in `strdltn.index.json` in your project, so they travel with it.
  Tags of a snippet go into its own header.
- Save a search: it becomes a row under Collections.
- A click on a sound plays it when preview is on. It never types. Enter, a double click
  or the insert button types the code that plays it at the cursor: `s("bd")`,
  `s("bd").bank("RolandTR909")`, `note("c3").s("sawtooth")`. Inside a string, only the
  name. Copy gives the name. A bank heading has a button that types
  `.bank("...")`.
- While a song plays, a preview starts on its next beat and lasts one beat, so you hear
  the sound against the music.
- A pane at the bottom shows the selected item: its tags, a snippet's description and
  code, a function's parameters and an example.
- The list is there as soon as VS Code starts, before you open a song.

**Sounds**

- All the sounds of strudel.cc: drum machines, piano, the VCSL instruments, the General
  MIDI soundfonts, the synths.
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

- The `.strudel` files in your `lib/` folder are the Snippets of the Browser, grouped by
  category, with their tags.
- Two buttons on each snippet: one inserts the code at the cursor, one opens the file.
- Snippets describe themselves in comments at the top of the file.

**Projects**

- Songs, samples and snippets are plain files: git, search and folders work as usual.
- The Songs of the Browser are every `.strudel` file of your project, by folder, and
  only those. A click opens one.
- Ready for AI assistants such as Copilot: the template tells them that "add a bass line"
  means a change to the song you have open, and gives them the Strudel reference and
  tutorial to look things up.
- MIDI on desktop: Strudel's `.midi()` plays a synth or a drum machine on a MIDI device,
  in time with the sound, and `midin()` and `midikeys()` read a controller or a keyboard.
  `midimaps()` and `defaultmidimap()` name the CCs. See `examples/09-midi-out.strudel`.
- A template to start from, with a demo song, examples and a library of snippets.
- Runs in GitHub Codespaces: fork, open, play.

Experimental, off by default: the setting `strdltn.experimental.shrubEditor` adds a tab
with Xfer's SHRUB web editor, to see how it would look. It is not connected to your songs.

Not there yet: MIDI in Codespaces, MIDI devices in the Browser and the Mixer, sound across a switch of editor, completion and hover in the code,
the Marketplace. See `doc/TODO.md`.

## A closer look

### The Strudel editor

`.strudel` files open in the editor of strudel.cc: inline scopes and piano rolls under
the line that makes them, sliders inside the code, and an outline on the notes that are
playing. Hydra visuals work too.

A button in the title bar switches the same file to the native VS Code editor, for
bigger edits with your own keys, extensions and AI completion. Press play there and a
stage opens below the code with the visuals of the song. Each is named from your code:
the name of the pattern (`$kick:`), the name of a variable, the comment above the line,
or the code itself. The sliders are faders in the Mixer.

![The native editor with the stage below it and the Mixer](doc/screenshot-stage.png)

[Hydra](https://hydra.ojack.xyz) works as on strudel.cc: call `initHydra()` and the
visuals draw behind your code, driven by your pattern.

![Hydra shapes behind the code](doc/screenshot-hydra.png)

Edits made outside the editor, by git or by an agent, show up at once, even while the
song plays.

### The Mixer and Music Controls

![The Mixer: a strip per part with faders, M, S, G and sidechain cables](doc/screenshot-music.png)

The bottom panel has a tab called Mixer, for the song in front. Each part of the song (`$kick:`, `bass:`) is a strip with its faders. M mutes, S solos, a click on
the gain fader's triangle adds or removes it. Drag from the jack at the foot of a strip onto another strip and
the first ducks the second (`.duck()`); pull the cable off to stop. Type a BPM to set the
tempo in Music Controls, at the top of the Library, with Play and Stop. Every change is
an edit of the song, so undo takes it back.

### The Browser

<img src="doc/screenshot-browser.png" alt="The Browser: Library with the search and colors, Songs and Snippets, Reference, and Results" width="300" align="right">

The [str]dltn Live[code] icon in the activity bar opens the Browser, four views that
each fold and move on their own. The first three pick what is shown, the last shows it.
Everything you set, in any of them, acts on Results.

- **Search** (Library). Ctrl+F in any of the views, or Ctrl+Alt+F from anywhere, puts the
  cursor here. Esc clears it. It searches everything.
- **Colors** (Library, under the search). Seven color dots. A click shows everything with
  that color. Right click a dot to rename it ("Favorites" is the first). Beside them, the
  Built-in button: click once for only what comes with Strudel, again for only what does
  not (your project and the packs your songs load), again for everything.
- **Collections** (Library). Your saved searches, once you have saved one.
- Every click and every search opens Results, if it is folded.
- **Categories.** The rows of each view: Sounds (synths, soundfonts), Drums (by bank),
  Samples and Instruments (VIBE FM firmwares) in the Library; Snippets and Songs in Songs
  and Snippets; Functions (every function of Strudel, with its documentation) in the
  Reference. "All" takes everything of that view. A click on the row that is picked goes
  back to everything.
- **Chips** (Results). The tags of what is shown, by group. They narrow the results.
- **Results.** Under headings: the bank, the folder, the category. Arrow keys move,
  Enter inserts (or opens a song), Space plays, 1 to 7 color, right click for more.
  Ctrl+click and Shift+click select several rows.
- **Details.** The selected item: seven dots that put it in or take it out of a
  collection, a "Tags..." button, its tags (a click filters by one), its description, code
  or parameters.

The speaker button beside the search turns preview on click on or off. Samples, drum
machines and the plain waves play at once, with no song open. While a song plays, a
preview waits for the next beat of the song. Soundfonts, supersaw and firmwares need a
song open.

Colors, your own tags and saved searches are kept in `strdltn.index.json` at the root of
your project. Commit it and they travel with your songs.

Your own samples need no setup. A folder `samples/kick/` with audio files in it becomes
`s("kick")`, and `s("kick:1")` is its second file. A new folder shows up a few seconds
after you copy it in.

A song can load a pack from GitHub with `samples('github:user/repo')`, or from any
address with `samples('https://.../strudel.json')`. The pack shows up in the Browser
when you open the file, and it is copied into `.strdltn/` in your project, so next time
it plays without the network. That folder ignores itself for git. "strdltn: Show sample
pack cache size" says how much it holds, and "strdltn: Clear sample pack cache" deletes
it.

### Snippets

Put `.strudel` files in a `lib/` folder and they appear under Snippets in the Browser,
grouped by category. Select one to see its description and its code below the list. The
first button on the row inserts the code at the cursor, the second opens the file.

A snippet describes itself in comments at the top:

```
// @title Four on the floor
// @category drums
// @details Kick on every beat, clap on 2 and 4, open hat on the off beat.
// @tags house, techno, 909
// @by alienmind
s("bd*4, ~ cp ~ cp, [~ oh]*4").bank("RolandTR909")
```

A long value goes on over the next lines, indented two spaces after the `//`:

```
// @details Kick on every beat, clap on 2 and 4,
//   open hat on the off beat.
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
| `strdltn.editor.theme` | The color theme of the Strudel editor, one of the themes of strudel.cc |
| `strdltn.editor.fontFamily`, `strdltn.editor.fontSize` | Its font. Empty and 0 take the font of your VS Code editor |
| `strdltn.samplesFolder` | The folder of your own samples. Default `samples` |
| `strdltn.libFolder` | The folder of your snippets. Default `lib` |
| `strdltn.remoteSamples.cache`, `strdltn.remoteSamples.maxFiles` | Whether packs are copied into the project, and up to how many files |

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

## Work on [str]dltn Live[code] itself

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
Alex McLean and the Strudel contributors. [str]dltn Live[code] hosts the upstream `@strudel/*`
packages unchanged.

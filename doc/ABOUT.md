---
title: "[str]dltn Live[code]"
---

# [str]dltn Live[code]

![[str]dltn Live[code] logo](logo.jpg)

**[str]dltn Live[code] is a VS Code extension. It turns your editor into a Strudel IDE whenever you
open a `.strudel` file.**

[Strudel](https://strudel.cc) is a language for making music with code. Its home is a
web page, and a web page is a hard place to keep a growing pile of songs, samples and
reusable ideas. [str]dltn Live[code] embeds the real Strudel, the same editor and the same sound
engine, and adds panels around it, in the manner of Ableton Live: a browser of every
sound, snippet, song and function, a mixer and music controls for the song you play, and
your music as plain files in a project.

![demo.strudel playing: the Strudel editor, the Browser on the left, the Mixer below](screenshot-overview.png)

[Download the latest release](https://github.com/alienmind/strdltn/releases/latest) | [Source on GitHub](https://github.com/alienmind/strdltn)

Free and open source (AGPL-3.0-or-later, like Strudel). It runs on desktop VS Code and
in GitHub Codespaces, so you can also keep a music project as a repository and play it
from a browser on any machine, with nothing installed.

> **Version 0.4.0**, in progress: MIDI on desktop. Strudel's `.midi()` plays a device in
> time with the sound, and `midin()` and `midikeys()` read a controller or a keyboard.
> Version 0.3.0 brought a Devices view: each firmware a song plays shows its own screen, keys
> and knobs, and can fill the view or move to a tab of its own. The demo song now plays
> itself, from a countdown to a countdown, with a fader for every part. Version 0.2.0
> brought the Mixer, Music Controls and the Browser in four views. See "What is missing" at
> the end.

This project is a fork of [vstrudel](https://github.com/alienmind/vstrudel). We forked
it because the scope grew beyond a VS Code extension.

---

## Features

**Editor**

- The real Strudel editor for `.strudel` files: the upstream packages, not a copy.
- Inline scopes, piano rolls and other visuals under the line that makes them.
- Sliders inside the code that you drag while the song plays.
- The notes that are sounding are outlined in the code.
- Hydra visuals behind the code.
- One button switches a file between the Strudel editor and the native VS Code editor.
- A stage beside the native editor, with the visuals of the song, each with a name taken
  from your code.
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

- A mixer in the bottom panel: one strip per part of the song (`$kick:`, `bass:`), side by
  side as in the Session view of Live. A song or snippet without parts is one strip.
- Each slider in the code is a fader. Moving it changes the sound at once and the number
  in the code a moment later. Under the faders, a meter pumps with the part's notes; a click
  on a gray one adds `._scope()` to the part.
- M mutes, S solos, and a click on the gain fader's triangle adds or removes it. Each writes
  Strudel's own code, so the song plays the same on strudel.cc.
- Sidechain as cables: drag from a strip's jack onto another strip to duck it, pull the
  cable off to stop. The code gets the `.duck()` and `.orbit()` for it.
- Music Controls at the top of the Library: Play, Stop and the BPM of the song. Type a
  BPM to set it, double click for Strudel's 120.
- The Mixer can float in a window of its own, and comes to the front when a song plays.

**Sounds**

- All the sounds of strudel.cc: drum machines, piano, the VCSL instruments, the General
  MIDI soundfonts, the synths.
- A Browser like the one of Ableton Live, in four views: Library (sounds), Songs and
  Snippets, Reference (every function of Strudel), and Results. One search, seven colors
  and a Built-in switch act on all of them, and Results shows everything they pick in one
  list with tag chips.
- Drum machines grouped by bank.
- A click on a sound plays it when preview is on, with no song open: samples, drum
  machines and the plain synths. It never types.
- Two buttons on each sound: one types its name at the cursor, one plays it.
- A button on a bank types `.bank("...")`.
- The list is there as soon as VS Code starts, before you open a song.
- Your own samples: audio files in a `samples/` folder are sounds, with no setup. New
  files appear without a reload.
- Sample packs from GitHub (`samples('github:user/repo')`) or from any address
  (`samples('https://.../strudel.json')`) are listed before you press play, get their
  own group, and are copied into your project so they play offline.
- Commands show how much space the copies take, and delete them.

**Snippets**

- The Browser's Snippets: the `.strudel` files in your `lib/` folder, grouped by category,
  with the tags of each snippet. Select one to read its description and code.
- Two buttons on each snippet: one inserts the code at the cursor, one opens the file.
- Snippets describe themselves in comments at the top of the file.

**Projects**

- Songs, samples and snippets are plain files: git, search and folders work as usual.
- Songs and Snippets lists every `.strudel` file of your project, by folder.
- Ready for AI assistants such as Copilot: the template tells them that "add a bass line"
  means a change to the song you have open, and gives them the Strudel reference and
  tutorial to look things up.
- A template to start from, with a demo song, examples and a library of snippets.
- Runs in GitHub Codespaces: fork, open, play.

---

## A closer look

### The Strudel editor

[str]dltn Live[code] does not imitate Strudel. It hosts the upstream Strudel packages, so you get
the same editor and engine as on strudel.cc, and new Strudel features arrive with a
version bump.

### The Mixer

![The Mixer: a strip per part with faders, M, S, G and sidechain cables](screenshot-music.png)

The bottom panel has a tab called Mixer. It shows the song in front: a strip
for each part, with its fader on a level meter, M and S, and orange cables for the sidechain. Drag
from the jack at the foot of a strip onto another strip and the first ducks the second;
the code gets `.duck("2")` and, if needed, an `.orbit()` of its own for the target. Every
change is an edit of the song, so undo takes it back and the song stays plain Strudel.

### Sounds

<img src="screenshot-browser.png" alt="The Browser: Library with the search and colors, Songs and Snippets, Reference, and Results" width="300" align="right">

The **Library** lists what the engine can play, and **Results** shows what you pick.
Click a sound to hear it, even with no song open. The buttons on the row type it where
your cursor is, or play it. The speaker button beside the search decides whether a click
plays.

Your own samples need no setup. Put audio files in a `samples/` folder:

```
samples/
  kick/
    kick1.wav
    kick2.wav
  snare/
    snare.wav
```

Now `s("kick snare")` plays them, and `s("kick:1")` picks the second kick.

A song can also load a pack from GitHub with `samples('github:user/repo')`, or from any
address with `samples('https://.../strudel.json')`. [str]dltn Live[code] sees that line when you
open the file: the pack shows up in the Browser at once, and it is copied into a
`.strdltn/` folder of your project so it plays without the network next time.

### Snippets

Put `.strudel` files in a `lib/` folder. **Songs and Snippets** shows them by folder.
Rest the mouse on one to see what it is and its code. A button inserts it at the cursor.

A snippet describes itself in comments at the top of the file:

```
// @title Four on the floor
// @category drums
// @details Kick on every beat, clap on 2 and 4, open hat on the off beat.
// @tags house, techno, 909
// @by alienmind
s("bd*4, ~ cp ~ cp, [~ oh]*4").bank("RolandTR909")
```

Only the code is inserted. The template comes with a starting library: drums, bass
lines, chords, melodies, effects, helper functions and song skeletons.

### Errors and the status bar

When the code has an error, the song keeps playing what worked last. The error is
underlined in the native editor and listed in the Problems view, and the status bar
turns red with the message. The status bar also says whether the song plays, and a click
on it plays or stops.

### With an AI assistant

The template tells assistants such as Copilot how a song is written, and that a request
like "add a bass line" means a new line in the song you have open. It also holds the
whole Strudel reference and the strudel.cc tutorial as text, so the assistant can look up
a function instead of guessing one.

### Two ways to edit the same file

One button in the title bar switches a file between two editors:

- The **Strudel editor**, for playing: visuals and sliders inside the code.
- The **native VS Code editor**, for bigger edits: multi-cursor, your keybindings, your
  other extensions, AI completion. Press play there and a **stage** opens beside the
  code.

![The native editor with the stage below it and the Mixer](screenshot-stage.png)

The stage shows the visuals of the song. Each one is named from your code: the name of
the pattern (`$kick:`), the name of a variable, the comment above the line, or the code
itself. The sliders are in the Mixer.

### Hydra visuals

[Hydra](https://hydra.ojack.xyz) works as it does on strudel.cc. Call `initHydra()` and
the visuals draw behind your code, driven by your pattern.

![Hydra shapes behind the code](screenshot-hydra.png)

---

## Install

### In VS Code

1. Download `strdltn.vsix` from the
   [latest release](https://github.com/alienmind/strdltn/releases/latest).
2. In VS Code open the Extensions view, press `...` at the top, and choose
   **Install from VSIX...**
3. Make a file called `song.strudel`, type `s("bd sd, hh*4")`, click in the code and
   press **Ctrl+Enter**.

### In GitHub Codespaces

1. Open [github.com/alienmind/strdltn](https://github.com/alienmind/strdltn).
2. Press **Code**, then **Codespaces**, then `...` and **New with options**.
3. Choose the configuration **[str]dltn Live[code] template (released extension)** and create it.
4. Open `demo.strudel`, click in the code and press **Ctrl+Enter**.

The sound comes out of your browser.

## Keys

| Key | Does |
|---|---|
| Ctrl+Enter | Play, or update the playing pattern |
| Ctrl+. | Stop the song in front. Again: stop the song that plays in another tab |
| Ctrl+Alt+M | Switch between the Strudel editor and the native editor |

On a Mac use Cmd in place of Ctrl.

## Good to know

- **"Click to enable audio."** A browser does not start sound without a click. When you
  press play from a button or from the native editor, the page may ask for one click
  first. Pressing Ctrl+Enter inside the Strudel editor counts as that click.
- **The network.** The default sounds and Hydra are downloaded when they are used.
  Offline, the synths, your own samples and the packs already copied still play.
- **Disk space.** A pack is copied whole. Some are large. "strdltn: Show sample pack
  cache size" says how much, and "strdltn: Clear sample pack cache" gets the space
  back.

## What is missing

- MIDI in Codespaces. VS Code does not let an extension's page use MIDI, so MIDI goes
  through the part of the extension that runs on your machine. In a Codespace that part
  runs in the cloud and cannot see your devices. MIDI devices are not in the Browser or
  the Mixer yet either.
- The sound stops when you switch between the two editors.
- Playing notes are not outlined in the native editor.
- No completion or documentation on hover in the code yet. The Reference lists the
  functions; the tutorial of strudel.cc is planned for it.
- Soundfonts, supersaw and firmwares still need a song open to preview.
- Record and Record Automation are in Music Controls, but not built yet.
- It is not on the VS Code Marketplace yet. Install it from the `.vsix` file.

## Thanks

All of the music making is [Strudel](https://codeberg.org/uzu/strudel), by Felix Roos,
Alex McLean and the Strudel contributors. [str]dltn Live[code] is only the VS Code part around it.

The template includes `coastline` by eddyflux, from Strudel's own examples, and "Array
(Lil Data Edit)" by DJ_Dave. Several snippets use techniques learned from Switch Angel
and from the Art Haus live coding workshop.

# Walkthrough video: script

A long tour of [str]dltn Live[code], about 12 minutes in 11 chapters, written to be read
aloud: by a text-to-speech voice, or by the maintainer into a microphone. Each chapter is a
separate recording, so one can be redone alone.

How to read this file:

- **Screen** is what the capture shows while the line is spoken. **Say** is the narration.
- The narration is written as speech: short sentences, "you" and "we", contractions. It
  is meant to sound like someone showing a friend their setup, not like a feature list.
  Change any wording that does not sound like you; keep the order of the screen actions.
- Pauses are marked `(pause)`. Let the music play there: it is part of the demo.
- Times are a guide at about 140 words a minute, plus the pauses.

The short promo is `video/script.json`; how both are captured and put together is in
`doc/VIDEO.md`.

---

## 1. Hello (0:40)

**Screen:** VS Code, `demo.strudel` open in the Strudel editor, not playing yet. Then
Ctrl+Enter, and the song starts: the code lights up, the Mixer meters move.

**Say:**
This is VS Code. And this is a song. (pause)
It's written in Strudel, a little language for making music with code. Normally you'd play
it on the Strudel website. Here it plays right inside my editor, with the real Strudel
engine, and with a few things a web page can't give you: a mixer, a sound library, MIDI
knobs, and hardware synths.
Let me show you around.

## 2. Your first sound (0:50)

**Screen:** A new file, `hello.strudel`. Type `s("bd sd, hh*4")`, Ctrl+Enter. Then change
`hh*4` to `hh*8` and press Ctrl+Enter again. Then Ctrl+. to stop.

**Say:**
Let's start from nothing. A new file, ending in dot strudel. One line: a kick, a snare, and
four hi-hats. Control and Enter plays it.
Now I change four hats to eight, and Control Enter again. Notice the music doesn't stop. It
just picks up the change on the next beat. That's live coding.
Control and dot stops it.

## 3. The Strudel editor (1:20)

**Screen:** Back to `demo.strudel`, playing. Zoom on an inline scope under a line, then on a
piano roll. Then on a `slider(...)` in the code; drag it, the sound changes, the number
updates when released.

**Say:**
Back to the demo. This is the same editor you'd get on strudel.cc, so everything works the
way you'd expect.
These little waves under the lines are scopes. They show what each part is doing right now.
This one is a piano roll, so you can see the notes go by.
And this, inside the code, is a slider. I can grab it while the song plays. (pause)
The sound changes straight away, and when I let go, the number in the code changes too.
Your tweaks end up in the file, so nothing gets lost.

## 4. Two editors, one file (1:00)

**Screen:** Ctrl+Alt+M: the same file in the native VS Code editor. Press play; the stage
opens below with the visuals, each one labelled. Zoom on a label. Ctrl+Alt+M back.

**Say:**
Sometimes you want a plain code editor: your own shortcuts, your extensions. One button
switches the same file over.
When you play from here, a stage opens underneath with the visuals. Each one gets a name
from your code: the name of the part, a variable, or the comment just above it.
And one more press brings me back to the Strudel editor.

## 5. The Library (1:30)

**Screen:** The side bar: the Library. Click Drums, then the TR-909 heading. Click a few
sounds (they play). Type `909 bd` in the search. Press Enter on a result: `s("bd").bank(...)`
lands at the cursor. Color a sound with the key 1. Open Snippets, double click one: it opens.

**Say:**
On the left is the Library. Every sound Strudel knows is in here: drum machines, synths,
sampled instruments, and your own samples too.
Click a sound and you hear it, even with nothing playing. (pause)
If a song is playing, the preview waits for the next beat, so you hear it in time with your
music.
The search looks everywhere. Found what you want? Press Enter, and the code that plays it is
typed right where your cursor is.
You can color anything, like favourites, and the colors are saved with your project.
And down here are your songs and snippets. Double click one to open it.

## 6. The Mixer (2:00)

**Screen:** The Mixer tab. Point at the Master, then at the strips. Unfold `bass` with its
arrow. Drag a fader; the number in the code follows. Press M on `hh`, then S on `bass`, then
undo both. Drag a cable from the kick's jack onto the pad. Then press the blue `>` at the
left, then `<`.

**Say:**
Down below is the mixer. The Master comes first, and then one strip for each part of the
song.
Here's the nice bit: the mixer reads your code. Every part with a label gets a strip, and the
slider inside its gain becomes the fader. Nothing to set up.
This little arrow opens a strip and shows the rest of its sliders: filters, effects,
whatever the part uses.
Move a fader, and look at the code. (pause) It's the same number. The mixer doesn't keep a
copy of anything; everything it does is an edit of your song, so you can undo it like any
other edit.
M mutes, S solos. Same thing: they're written into the code.
These meters show the real level of each part, and the number on top turns orange if it
clips.
And these orange cables are sidechains. The kick is pushing the bass and the pad down every
time it hits. That's what makes it pump. To add one, I just drag from the kick to another
strip.
The two blue buttons on the left open every strip at once, or close them all again.

## 7. MIDI knobs (1:40)

**Screen:** A MIDI controller in shot, or a picture of it. In the code, the knob column left
of the line numbers. Click a knob button: it turns red and blinks. Turn a knob: the button
turns green, `.knob(74)` appears in the code. Play and turn: the slider and the Mixer fader
follow. Open "Show MIDI Mappings" in the Mixer.

**Say:**
If you have a MIDI controller, every slider can be a real knob.
See these little knobs next to the line numbers? There's one on every line with a slider.
I click one, it turns red, it's listening. I turn a knob on my controller, and it turns
green. That's it. It's mapped.
Now when I turn it, the slider moves, the sound changes, and the fader in the mixer moves too.
(pause)
The knob only grabs the slider once it gets to the same value. So if your knob is sitting
somewhere else, the sound won't suddenly jump. Just sweep past the value and it catches on.
The mapping is saved in your code, so it's still there tomorrow. And this window in the mixer
lists all of them, with a button to remove each one.

## 8. MIDI out (0:50)

**Screen:** `examples/09-midi-out.strudel`. The Library's MIDI category with the devices.
Click a device: `.midi('...')` is typed. Play: a hardware synth plays along (or the MIDI
messages scroll in the Output).

**Say:**
MIDI goes the other way too. Any part of your song can play a hardware synth or a drum
machine.
The Library lists the devices you have plugged in. Click one, and the code to use it is typed
for you. Then the notes go out, in time with everything else.

## 9. Synth firmwares (1:10)

**Screen:** `examples/07-vibefm1-obervave.strudel` playing. The Devices tab: two OBERVAVE
panels with their screens moving. Press F3 and F4 on one; turn its DATA knob with the mouse
wheel; move one of its parameter sliders.

**Say:**
This one's a bit special. These are synth firmwares from The Firmware Hub, made for a little
hardware synth called the VIBE FM. Here they run right inside VS Code, as instruments in your
song.
Each one gets its own panel, with its real screen. You can press its buttons, turn its main
knob with the mouse wheel, or move any of its parameters.
In the code, it's just one more sound name.

## 10. Recording (0:50)

**Screen:** Music Controls at the top of the Library. Press Record, play with a knob for a
few bars, press Record again. The take appears under Render in the Library; click it to
play it. Then the Render button and its notification.

**Say:**
When something sounds good, keep it. The red circle up here records exactly what you hear,
knob moves and all, into a wav and an mp3 next to your song.
And the arrow next to it renders the whole song, from start to end, without you having to sit
through it.
Your takes show up in the Library, ready to play.

## 11. It's all just files (1:00)

**Screen:** The Explorer: songs, `samples/`, `lib/`. A sample dropped into `samples/`
appears in the Library. The demo's `samples('github:...')` line. Then the end card: logo,
`github.com/alienmind/strdltn`.

**Say:**
Last thing, and maybe my favourite. Everything here is a plain file. Your songs, your
samples, your snippets. Drop a sound in the samples folder and it's in the Library a second
later.
That means git works, and you can even open the
whole project in a Codespace and play it from a browser.
And because it's real Strudel, you can paste a song into strudel.cc and it just plays.
[str]dltn is free and open source. You'll find it on GitHub. Have fun making music.

---

## Notes for recording

- Read each chapter twice before recording it. If a sentence trips you up, change it: the
  words here are a starting point, not a script to follow letter by letter.
- Leave a second of silence at the start and end of each file; the composition trims it.
- Record the voice before the capture: the length of each chapter sets the length of its
  scene, as for the promo.
- The name: say it however you say it, or not at all. The end card shows it written.

---
name: strudel-midi
description: Help a user play a Strudel song with MIDI hardware in [str]dltn Live[code]. Find the names of their MIDI devices and the CC numbers their knobs send, send notes and CCs to a synth, and turn the sliders of a song into physical knobs. Use when the user mentions MIDI, a controller, a keyboard, knobs, a synth or a CC, or asks to control a song with hardware.
---

# MIDI in a Strudel song

The songs are `.strudel` files played by the [str]dltn Live[code] extension of VS Code.
MIDI works there on desktop VS Code only, through the extension: not in a Codespace,
and not from a plain browser page.

## What you cannot see, and how to find it

You cannot list the user's MIDI devices or watch their knobs yourself. Ask the user for
one of these, and use what they paste:

| To find | Ask the user to |
|---|---|
| The device names | Open the Library's **MIDI** category: outputs (instruments) and inputs (controllers) are listed by name. A click there types the name into the song |
| What a knob sends | Run the command **"strdltn: Show MIDI messages in the Output"**, turn the knob, and paste the lines from Output > strdltn |

The lines read like this:

```
[midi] in <- MPK mini 3: CC 1 = 64 (ch 1)
[midi] out -> M-VAVE FM-1: note on c3 (48) vel 94 (ch 1)
[midi] in <- MPK mini 3: CC 2 = 12 (ch 1)   (no song listens to this device)
```

`CC 1 = 64` is the knob's CC number (1) and its value (0 to 127). One knob per line;
ask the user to turn the knobs in order, so each CC can be matched to its knob.

## Writing it

- **Device names in single quotes.** `midin('MPK mini 3')`, `.midi('M-VAVE FM-1')`. In
  double quotes Strudel reads mini-notation; the extension still copes, but single quotes
  are what works on strudel.cc too. A part of the name is enough (`'FM-1'`).
- Put the device names in constants at the top, so the user changes them in one place.

```
const SYNTH = 'M-VAVE FM-1'
const knobs = await midin('MPK mini 3')
```

| Wanted | Code |
|---|---|
| A knob as a value, 0 to 1 | `knobs(1)` (CC 1) |
| On one channel only | `knobs(1, 2)` (channel 2) |
| In a range | `knobs(1).range(200, 4000)` |
| Notes to a synth | `note("c3 e3 g3").midi(SYNTH)` |
| Its channel | `.midichan(2)` (1 to 16) |
| How hard a note plays | `.velocity(knobs(6).range(.3, 1))` (0 to 1) |
| A CC to a synth, no notes | `ccn(74).ccv(knobs(7)).seg(16).midi(SYNTH, { isController: true })` |
| Pitch bend | `midibend(knobs(8).range(-1, 1)).seg(16).midi(SYNTH, { isController: true })` |
| Notes from a keyboard | `const kb = await midikeys('KeyStep')` then `kb().s("sawtooth")` |

`ccv` and `velocity` are 0 to 1, not 0 to 127. `.seg(16)` sends the CC 16 times a cycle;
without it a knob's value is sent once per cycle.

CCs a synth often listens to: 1 mod wheel, 7 volume, 10 pan, 71 resonance, 74 cutoff.
Known here: Xfer's SHRUB on the M-VAVE FM-1 takes its cutoff on CC 74 and its first macro
on CC 16; the FM-1's stock firmware has its cutoff on CC 2. For another synth, ask the
user or its manual.

## Turning sliders into knobs

A slider `slider(value, min, max)` becomes the knob that the user picked for it:
`knobs(cc).range(min, max)`. Keep the constant's name, so the rest of the song does not
change:

```
// before
const CUTOFF = slider(800, 200, 4000)
// after: knob 5 of the MPK mini 3
const CUTOFF = knobs(5).range(200, 4000)
```

Rules:

1. **Ask first which knob goes where**, or propose a table (knob, CC, what it does) and
   let the user change it. Read the CCs from the Output lines; do not guess them.
2. **A knob reads 0 until it moves.** A level on a knob starts silent; a filter starts
   closed. Say so in one comment line, as a mixer: "bring each part in with its knob".
   For a value that must not start at 0, keep its range away from 0
   (`.range(.3, 1)`).
3. **One `.gain()` per part.** In Strudel the last `.gain()` wins. Never add
   `.gain(slider(...))` after `.gain(KNOB)`: the knob goes silent. To have both, scale:
   `.gain(KNOB.mul(slider(1, 0, 1)))`. The Mixer's G button writes it that way.
4. A slider that stays a slider keeps working; the user may want some of each.
5. Leave the user's names, comments and order as they are. Change only what was asked.

## When it does not work

| The user sees | Cause, and what to do |
|---|---|
| `MIDI device "..." not found. Connected: ...` | The name is wrong or the device is unplugged. Use a name from the list in the message |
| A knob does nothing | Its CC is not the one in the code. Show the Output lines and match them |
| The part is silent until a knob moves | Expected: a knob reads 0 until it moves |
| A knob moved but the level did not change | A later `.gain(...)` on the same part overrides it (rule 3) |
| Notes reach the synth but a CC does nothing | The synth does not listen to that CC. Try another, or map it in the synth |
| Nothing at all, in a Codespace | MIDI needs desktop VS Code |

# AGENTS.md - rules for an AI assistant in this project

This is a music project. The songs are the `.strudel` files. They are written in
Strudel (https://strudel.cc), a language for live coding music, and played by the
[str]dltn Live[code] extension of VS Code.

## What a request means

A request about music is a request to change a song. "Add a bass line", "make the hats
busier", "more reverb on the snare", "a breakdown in the middle": each one means edit
the `.strudel` file that is open.

- Change the open `.strudel` file, and only that file.
- Write Strudel code. Not JavaScript modules, not a new file, not a build step.
- Do not touch the editor, the extension, its settings or any other tooling to answer a
  request about music. If a request can only be met by changing the tool, say so and
  stop.
- Make the smallest change that does what was asked. Keep the rest of the song as it is,
  with its names, its comments and its order.
- Say in one or two lines what was added and how to hear it (Ctrl+Enter plays).

## Folders

| Path | Holds |
|---|---|
| `*.strudel`, `examples/` | Songs |
| `lib/` | Snippets: short pieces to copy from, one folder per category (`drums`, `bass`, `chords`, `melody`, `effect`, `texture`, `function`, `song`). Read them before writing something new, they are known to play |
| `reference/strudel-functions.md` | Every Strudel function with its parameters and examples, from the upstream reference. Search it before using a function |
| `reference/strudel-tutorial.md` | The workshop and the guides of strudel.cc as plain text, with their examples. Read the part about what is asked (drums, notes, effects, signals) when writing something new |
| `samples/` | The user's own audio files. A folder `samples/kick/` is the sound `s("kick")`, and `s("kick:1")` is its second file |
| `.strdltn/` | A cache the extension fills. Never edit it |
| `strdltn.index.json` | Colors, tags and saved searches of the Browser, kept by the extension. Do not edit it by hand unless asked |

## How a song is written

A song is a list of patterns that play together. Each one starts with `$:`, or with a
name, which the editor shows beside its sliders and visuals:

```
setcpm(130/4)                 // tempo: 130 beats per minute, 4 beats per cycle

$kick: s("bd*4").bank("RolandTR909").gain(.9)
$hats: s("[~ hh]*4").bank("RolandTR909").gain(.5)
$bass: note("c2 c2 eb2 g1").s("sawtooth").lpf(600).gain(.6)
```

To add a part, add one more `$name:` pattern. Do not wrap the song in a function, and
do not replace the existing patterns with one `stack(...)`.

A pattern with `_$:` in front is muted. Use that to turn a part off without deleting it.

### Sounds

| Code | Plays |
|---|---|
| `s("bd sd hh cp")` | Samples by name |
| `s("bd").bank("RolandTR909")` | The same sound from a drum machine. The full name `s("RolandTR909_bd")` also works |
| `s("kick:2")` | The third file of a sample |
| `note("c2 eb2 g2").s("sawtooth")` | Notes on a synth: `sine`, `sawtooth`, `square`, `triangle`, `supersaw` |
| `note("c3 e3").s("piano")`, `.s("gm_acoustic_bass")` | Notes on a sampled instrument or a General MIDI soundfont (`gm_...`) |
| `n("0 2 4 7").scale("C:minor")` | Steps of a scale. The usual way to write a melody or a bass line |
| `chord("<Am7 Fmaj7>").voicing()` | Chords by name |

Only use a sound name that is in the Browser of [str]dltn Live[code], or that already appears in
this project. Do not make up names.

### Mini-notation

The text inside `"..."` is a rhythm of one cycle.

| Write | Means |
|---|---|
| `"a b c d"` | Four steps of equal length |
| `"a*4"`, `"a/2"` | Faster, slower |
| `"[a b] c"` | A group shares one step |
| `"<a b c>"` | One per cycle, in turn |
| `"a ~ a ~"` | `~` is a rest |
| `"a, b"` | Both at once |
| `"a@3 b"` | `a` lasts three steps |
| `"a!3 b"` | `a` three times |
| `"a?"` | `a` half of the time |
| `"bd(3,8)"` | Three hits spread over eight steps (Euclidean) |

### Shaping a part

| Code | Does |
|---|---|
| `.gain(.6)` | Volume |
| `.lpf(800)`, `.hpf(200)`, `.lpq(8)` | Low pass, high pass, resonance |
| `.lpenv(4).lpd(.15)` | Filter envelope, for an acid sound |
| `.attack(.01).decay(.1).sustain(.5).release(.2)` | Envelope |
| `.room(.4)`, `.delay(.5).delaytime(.25).delayfeedback(.5)` | Reverb, delay |
| `.pan(.3)`, `.orbit(2)` | Position, effect bus |
| `.fast(2)`, `.slow(2)`, `.rev()`, `.jux(rev)`, `.off(1/8, x => x.add(note(7)))` | Change the pattern in time |
| `.sometimes(x => x.speed(2))`, `.every(4, x => x.rev())` | Now and then |
| `sine.range(200, 2000).slow(8)` | A slow wave as a value, for example inside `.lpf(...)` |

### Controls and visuals

| Code | Does |
|---|---|
| `slider(.5, 0, 1)` | A slider in the editor: value, minimum, maximum. Give it a name: `const BASS_VOL = slider(.5, 0, 1)`, then `.gain(BASS_VOL)` |
| `._scope()`, `._pianoroll()` | A scope or a piano roll under that pattern |
| `samples('github:user/repo')` | Loads a sample pack. The extension keeps a copy |

## Where to look

In this order, before writing new code:

1. `lib/` and `examples/`: code that is known to play in this project. Copy its style.
2. `reference/strudel-tutorial.md`: how the language is meant to be used, with examples.
3. `reference/strudel-functions.md`: every function by name. Its first section lists all
   the names in one line.

## Do not guess

Strudel has many functions, and a name that does not exist stops the whole song. Use a
function only when it is in one of the places above. When in doubt, use the plainer way
from the tables of this file.

After an edit, an error in the code shows as a problem of the file (source `strdltn`).
Read it and fix the song.

---
applyTo: "**/*.strudel"
---

# When a `.strudel` file is open

A `.strudel` file is a song, written in Strudel (https://strudel.cc) and played by the
[str]dltn Live[code] extension.

A request about music ("add a bass line", "busier hats", "more reverb on the snare")
means: edit the open `.strudel` file, and only that file, by adding or changing a
`$name:` pattern in Strudel code. For example a bass line is one new line such as:

```
$bass: note("c2 c2 eb2 g1").s("sawtooth").lpf(600).gain(.6)
```

- Never change settings, tooling or other files to answer a request about music.
- Everything needed is inside this project. Do not look outside its folder.
- The rules for songs and a short guide to the language are in `AGENTS.md` at the root
  of this project. Read it before the first edit.
- `lib/` holds snippets that are known to play. Copy their style.
- `reference/strudel-functions.md` lists every Strudel function, and
  `reference/strudel-tutorial.md` holds the tutorial of strudel.cc.
- Do not make up function or sound names. A name that does not exist stops the song.
- For MIDI (a controller, knobs, a synth, CC numbers), read
  `.claude/skills/strudel-midi/SKILL.md` first.

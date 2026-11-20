---
applyTo: "**/*.strudel"
---

# When a `.strudel` file is open

A `.strudel` file is a song, written in Strudel (https://strudel.cc). This repository
is also the source of the [str]dltn Live[code] extension that plays it, and the two must not be
mixed up.

A request about music ("add a bass line", "busier hats", "more reverb on the snare")
means: edit the open `.strudel` file, and only that file, by adding or changing a
`$name:` pattern in Strudel code. For example a bass line is one new line such as:

```
$bass: note("c2 c2 eb2 g1").s("sawtooth").lpf(600).gain(.6)
```

- Do not read or change anything under `src/`, `scripts/`, `doc/` or `package.json` to
  answer a request about music. The extension is not the subject.
- If the request can only be met by changing the extension, say so and stop.
- The rules for songs and a short guide to the language are in `template/AGENTS.md`.
  Read it before the first edit. `template/lib/` holds snippets that are known to play.
  `template/reference/` holds every Strudel function and the tutorial of strudel.cc.
- Do not make up function or sound names. A name that does not exist stops the song.

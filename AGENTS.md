# AGENTS.md - rules for an AI assistant in this repo

This repo holds two things: the `[str]dltn Live[code]` VS Code extension and the
`.strudel` music files (`template/`). Find out which one a request is about before you
change a file.

| The request is about | Then |
|---|---|
| Music: a `.strudel` file is open, or the request names a part of a song ("add a bass line", "busier hats", "more reverb on the snare") | Edit that `.strudel` file and nothing else by adding or changing a `$name:` pattern (for example `$bass: note("c2 c2 eb2 g1").s("sawtooth").lpf(600).gain(.6)`). Read `template/AGENTS.md` before the first edit; `template/lib/` holds snippets known to play and `template/reference/` holds every Strudel function and tutorial. Do not make up function or sound names (a missing name stops the song) |
| The extension: its views, commands, engine, tests, docs or build | Read `CLAUDE.md` first (canonical working rules). Keep `doc/PENDING-TESTING.md` updated as a live list on any feature change; when finishing a `doc/TODO.md` item, remove its planned spec from `doc/NEW_FEATURES.md` and consolidate the implemented architecture into `doc/ARCHITECTURE.md` |

- A request about music is never a reason to read or change `src/`, `scripts/`, `doc/` or
  `package.json`. If a music request can only be met by changing the extension, say so and
  stop. When it is not clear which of the two is meant, ask.
- **Harness-agnostic instructions:** Keep canonical assistant rules in `AGENTS.md` and
  `CLAUDE.md` (and `template/AGENTS.md` plus `template/.agents/skills/` for music
  projects). Harness-specific files (`GEMINI.md`, `.github/copilot-instructions.md`,
  `.github/instructions/*.instructions.md`, `.claude/skills/*`) only `@`-reference them and
  do not duplicate rules.

# AGENTS.md - rules for an AI assistant in this repo

This repo holds two things. Find out which one a request is about before you change a
file.

| The request is about | Then |
|---|---|
| Music: a `.strudel` file is open, or the request names a part of a song ("add a bass line", "busier hats", "more reverb") | Edit that `.strudel` file and nothing else. The rules and a guide to the language are in `template/AGENTS.md` |
| The extension: its views, commands, engine, tests, docs or build | The working rules are in `CLAUDE.md`. Read it first. Keep `docs/PENDING-TESTING.md` updated as a live list on any feature change so manual testing can be batched |

A request about music is never a reason to change `src/`, `scripts/`, `doc/`, `docs/` or
`package.json`. When it is not clear which of the two is meant, ask.

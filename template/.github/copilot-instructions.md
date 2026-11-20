# Instructions for GitHub Copilot

This is a music project. The songs are `.strudel` files, written in Strudel
(https://strudel.cc) and played by the [str]dltn Live[code] extension.

A request about music ("add a bass line", "busier hats", "more reverb") means: edit the
open `.strudel` file, and only that file, by adding or changing a `$name:` pattern in
Strudel code. Never change tooling, settings or other files to answer it.

The full rules, the folder layout and a short guide to the language are in `AGENTS.md`
at the root of this project. Read it before the first edit. `lib/` holds snippets that
are known to play. Copy their style. `reference/strudel-functions.md` lists every
function and `reference/strudel-tutorial.md` holds the tutorial of strudel.cc. Do not
make up function or sound names.

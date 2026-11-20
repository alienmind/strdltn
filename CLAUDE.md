# CLAUDE.md - working rules for agents in this repo

This file is enough to start work in a new session. The first part, "Handover", is
about this project and is kept current. Everything after it is house rules that would
fit any project.

## Handover

### What this is

vstrudel is a VS Code extension that turns the editor into a Strudel IDE for `.strudel`
files. It hosts the upstream Strudel packages (`@strudel/*` from npm, source at
`codeberg.org/uzu/strudel`) in a webview and adds a Sounds view, a Snippets view, a
stage, and a cache for remote sample packs. It runs on desktop VS Code and in GitHub
Codespaces.

| Where | What |
|---|---|
| `github.com/alienmind/vstrudel` | This repo |
| `../alienmind-www` | The maintainer's home page. It shows `doc/ABOUT.md` of this repo |
| `README.md` | What a user gets, with the full feature list |
| `doc/ARCHITECTURE.md` | How every part works, and every fact we measured about VS Code |
| `doc/TODO.md` | What is left, the decisions waiting for the maintainer, the next hand test |
| `doc/DRAWER_OF_FAILED_IDEAS.md` | What we tried or designed and dropped, with the reason. Read it before a spike |

### State

Read the top of `doc/TODO.md` for the current state. It says which branch holds the
work, what is released, and what the next step is. The same file lists the decisions
that wait for the maintainer, the spikes that are still to run ("Spikes to run"), and
the plan for the local model.

### How to work here

| Command | Use |
|---|---|
| `pnpm build`, `pnpm typecheck` | After every change |
| `pnpm test:unit` | Fast. The rules that name things in the stage |
| `pnpm test:quick` | The same test for a small change: silent, without the long parts, about 75 seconds |
| `pnpm test:vscode` | The real test. It starts a VS Code window, plays every file of `template/`, and prints what happened as JSON. About ten minutes. Set `VSCODE_EXE` to the installed `Code.exe` to skip a download |
| `pnpm promote` | Installs a build into the maintainer's own VS Code. Only on request |
| `pnpm reference`, `pnpm tutorial` | Write `template/reference/` again from upstream. After a Strudel update |

What to know about the real test:

- It makes sound on the maintainer's speakers. Say so before a run if the maintainer is
  at the machine.
- Do not build while it runs. A build empties `dist/`, and the test window loads from
  there.
- It writes screenshots to `tmp/shots/`. Look at them: they are how we see the UI.
- It records, it does not assert. Read the JSON.
- `template/demo.strudel` is the maintainer's own song and the subject of the test. Do
  not replace it with another one.

### Standing instructions from the maintainer

- **Releases are the maintainer's call.** Do not change the version, tag, publish or
  promote unless told to. Collect work on a feature branch.
- **Commit and push on the feature branch without asking.** `main` gets the work through
  a pull request that the maintainer merges.
- **One feature branch at a time.** When a feature branch is already in use, add to it.
  Do not open a second branch or a worktree for a side task, not even for docs.
- **Several agent sessions may share this folder.** Look at `git status` and the last
  commits before you write. Commit only the files you changed, by name, and leave the
  uncommitted changes of another session alone.
- **Strudel comes from upstream npm, pinned.** No fork, no submodule, no patches.
- **Our name is vstrudel.** The side bar, the commands and the icon say vstrudel. "Strudel"
  is only used for the language and for the upstream editor.
- **Other people's work.** A file by somebody else goes in only with a license that
  allows it. A technique learned from somebody is written again as our own code, and the
  snippet says `// @credits <name>`, the name and nothing else.
- **Docs are part of the work.** `doc/TODO.md`, `doc/ARCHITECTURE.md` and the drawer are
  updated in the same change, by the rules below.

### What VS Code does that is easy to forget

These cost time once. The details are in `doc/ARCHITECTURE.md`.

- A webview starts no sound without a click inside it. A command is not a click.
- A webview may not use MIDI.
- Installing the same version again leaves the old side bar title and icon in a running
  window. `pnpm promote` gives a build that is not a release its own version.
- CodeMirror takes the canvases of inline widgets and puts them back when moved. The
  stage clears its decorations first.
- `vsce package` asks a question in a terminal when `package.json` has no `repository`.
- pnpm 11 reads build permissions from `pnpm-workspace.yaml`, not from `package.json`.

## House rules

The rest of this file is not about this project.

## Tooling

Use the package manager, runtime version and language version the repo already declares
(`packageManager` in `package.json`, `.nvmrc`). Do not add a second package manager or a
lockfile from another one.

Third-party code comes from its upstream release with pinned versions. No patches to
`node_modules`. If upstream behavior has to change, wrap it from outside or send the fix
upstream.

## Work in progress stays out of the maintainer's own tools

Some projects are a tool the maintainer also uses while working on it: an editor
extension, a command line tool. Then two copies exist, the work in progress and the
promoted copy the maintainer runs every day, and they must not mix.

- Build and test the work in progress only, in the isolated host the project provides.
- Never install, replace or reload the maintainer's copy as a side effect of other work.
- Promote as the last step of a release the maintainer approved: versioned, tagged and
  pushed. Then say that it was promoted and what the maintainer has to restart.
- The maintainer decides when there is a release. Do not change the version, tag or
  publish because a piece of work is finished. Collect the work and wait to be told.

The commands and the release steps of this project are under "Release" in
`doc/ARCHITECTURE.md`.

## Asking for a manual test

Some things cannot be proven from the terminal. A change like that lands as a build to
be tested by hand. Make that request SCHEMATIC:

1. Name the EXACT target - the app, the platform and how to launch it. Not "the app".
2. A table, and little else: check number, what to do, what should happen.
3. One line on what is expected to still be broken at this stop.
4. Ask for the result by check NUMBER, plus the log or console output when something
   fails.

Do NOT re-explain how the host application works. Example of the whole thing:

> Test on **desktop, launched with F5**.
>
> | # | Do this | Should happen |
> |---|---------|---------------|
> | 1 | Open the demo file, press Ctrl+Enter | Sound plays |
> | 2 | Save, close and reopen the file | The content comes back |
>
> Expected still broken: sound stops when the tab is hidden.

## Scratch work goes in `tmp/`

Anything exploratory - a standalone spike, a scratch harness, a dump you are reading
once - goes under `tmp/`, which is gitignored. Not the repo root.

A spike that answered its question is DELETED once the answer is written down (in
`doc/ARCHITECTURE.md` or `doc/DRAWER_OF_FAILED_IDEAS.md`). The finding is what has
value; the scaffolding that produced it is noise.

## Writing

**The goal is text that reads as though a person wrote it after doing the work.** Not
text that reads as though it was generated from a diff.

### Punctuation

Plain ASCII in documentation, commit messages and code comments. No em dashes, en
dashes, middle dots or typographic ellipses - use `-`, `...`, `,`. Signal-flow arrows
(`->`) and glyphs standing for real UI buttons are fine.

### Plain language

Every `.md` file here is written in plain language: short sentences and everyday words.
Keep every fact, name, number, link and file path. Say the thing once, in the shortest
words that are still exact.

**A heading says what the section is about. Nothing else.** No mood, no promise, no
"the one thing that", no "and why", no "up front", no "honestly". If a heading needs a
comma to hold two ideas, it is two sections or one shorter heading.

| Wrong | Right |
|---|---|
| "The things that will bite" | "Common mistakes" |
| "The verdict, up front" | "Verdict" |
| "What ports, and why it is more than it looks" | "What ports" |

Start sentences with the subject.

### No riddles

A title is not a puzzle to be solved by reading the section.

- Say what the thing IS before you say anything clever about it.
- A maintenance release says "maintenance".
- Name the feature, not the insight behind it.
- No teasing. Nothing that only makes sense after reading the thing it labels.

This applies to release names, headings, the first sentence of a section, and PR titles.

**Keep every technical word that is a name.** API names, function names and file names
are what the thing is called. A reader who cannot search for them cannot use the
document. Simplify the sentence around them.

**Facts and numbers do not get softened.** Plain language means fewer, simpler words,
not saying less.

### Say why, not only what

Every entry says what it is FOR. What changed is in the diff. Why it was worth doing is
not.

- Lead with the reason where the reason is the point.
- Write as the team. "We" is correct.
- Ordinary verbs are fine. "Fixed the installer" needs no improving.
- Say it as honestly as you know it. If a change is an investigation aid and not a fix,
  say so. Do not promote a lead into a conclusion.
- One dense paragraph beats two tidy ones.
- Cut error codes and internal proof unless the reader would search for them.

### Known and assumed are different

A doc states whether a claim was measured or is only expected. "Measured on version X"
and "expected, not tested" are both fine. An untested claim written as a fact is not.

### Comments

Comments say what the code cannot: the constraint, the trap, the thing that was measured
and cost a day. Not what the next line does. They may be as long as the mechanism needs.
State the point and stop.

### Commit messages

ONE LINE. `type: what changed`, stated plainly. No body. No scope suffix by default.

    feat: open external links in default browser
    fix: keep the cursor when switching editor mode
    docs: record the autoplay test result
    chore: bump dependencies

Everything you were about to put in the body already has a home: the constraint goes in
a comment at that line, the measurement in `doc/ARCHITECTURE.md`, the dead end in the
drawer of failed ideas, the remaining work in `doc/TODO.md`.

## Recording what was learned

Keep these files current as part of the work, not after it.

`doc/TODO.md` is the live ledger: what is in flight, the open questions, the concrete
list of things to try, and the exact next test. Finished work is DELETED from it rather
than kept as a done-list - git history is the record of what shipped.

`doc/DRAWER_OF_FAILED_IDEAS.md` is for approaches that were tried or designed and then
dropped, WITH the reason. A failure recorded there is worth as much as a feature - it
stops the same spike being run twice.

`doc/ARCHITECTURE.md` is how things are built: the parts, the protocols between them,
and every fact we measured about the platform. Implementation detail goes here.

`README.md` is for a user: what the project does and how to use it. No implementation
detail.

`doc/ABOUT.md` is the public page of the project. The home page builds it into a web
page, with the images that sit beside it in `doc/`. It is written for somebody who has
never seen the project. When a release changes what a user can do, update it.

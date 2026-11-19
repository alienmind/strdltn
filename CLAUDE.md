# CLAUDE.md - working rules for agents in this repo

Start with `README.md` for what the project is, then `doc/ARCHITECTURE.md` for how the
parts fit, and `doc/TODO.md` for what is in flight and the concrete list of things to
try next. This file is only the house rules - the things that are not derivable from
the code. Nothing here is specific to this project; project facts live in `doc/`.

## Tooling

Use the package manager, runtime version and language version the repo already declares
(`packageManager` in `package.json`, `.nvmrc`). Do not add a second package manager or a
lockfile from another one.

Third-party code comes from its upstream release with pinned versions. No patches to
`node_modules`. If upstream behavior has to change, wrap it from outside or send the fix
upstream.

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

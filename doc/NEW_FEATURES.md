# New Features - Detailed Pending Architecture

Single detailed architecture and design spec for every UNBUILT feature listed in `doc/TODO.md`.

> **Lifecycle rule (`CLAUDE.md`):** Only pending, unbuilt features live here. When a feature
> from `doc/TODO.md` is completed, DELETE its entry from `doc/TODO.md`, REMOVE its planned
> design from this file (so `doc/NEW_FEATURES.md` shrinks as work ships), consolidate the
> implemented architecture and measurements into `doc/ARCHITECTURE.md`, and add manual
> verification steps to `doc/PENDING-TESTING.md`.

Every feature obeys the project's core principle: **the code stays the song**. Every panel
either reflects the code or writes clean, undoable Strudel code that plays identically on
`strudel.cc` (apart from desktop MIDI and firmwares).

---

## 3. Browser Upgrades: Hot-Swap, Songs as Files & Tutorial (`UX-4`, `#5`, `#6d`)

### In-Place Sound Hot-Swap (`UX-4`)

- Ableton `Q`-style workflow: lock the Browser to the `s("...")` or `.bank("...")` token under
  the cursor (reusing `src/shared/context.ts` + `SyncHost`), then step `Up`/`Down` in the
  Browser to swap sounds live inside the playing mix. `Enter` keeps, `Esc` reverts in one undo.

### Songs as Files & Custom Places (`#5`)

Make the Browser's Songs category work like the Explorer for `.strudel` files:

- `+` button (`strdltn.newTrack`, `$(add)`) in `view/title` opens `Library > Songs`, creates
  `New Track.strudel` in the selected folder (or workspace root), opens it, and enters inline
  rename mode.
- F2 / context menu inline rename (`WorkspaceEdit.renameFile`, keeping `.strudel`).
- Right-click menu: Open, Rename... (F2), Reveal in Explorer (`revealInExplorer`), Reveal in
  File Explorer (`revealFileInOS`), Copy path, Remove (`useTrash: true`, stops song first).
- Custom user Places folders via `strdltn.browser.folders`.
- Open questions: Reveal in Explorer vs OS File Explorer vs both; empty header vs starter beat
  in new track; whether `lib/` snippets share the same create/rename/remove menu.

### Interactive Minigame Reference Tutorial (`#6d` - maintainer 2026-11-26)

Upgrade the Reference Tutorial from static Markdown into an **interactive Strudel coding
minigame - like `rustlings` for Rust, but live and sound-driven for Strudel** - running
alongside a `.strudel` file:

- **Lesson & level source (`dist/tutorial.json`):** Extend `scripts/build-tutorial.mjs`
  (which already fetches Strudel's AGPL MDX workshop and learn docs at the pinned commit) and
  pair it with structured minigame levels (`id`, `chapter`, `title`, `brief`, `starterCode`
  with comment instructions, `hints[]`, `checks[]`, `solution`, `parSeconds` for Hardcore
  mode).
- **Guided `.strudel` workspace file:** Picking a level under **Reference > Tutorial** (or
  from the Welcome Screen) opens a scratch/lesson `.strudel` file in the Strudel editor with
  clear inline comment prompts marking where to write or modify code (for example,
  `// TODO: add a kick drum on every beat using s("bd*4")`). Both reading mode ("Insert at
  cursor" / "Open as a song" from the Details pane) and interactive minigame mode coexist.
- **Floating Tutorial Assistant HUD:** A compact, draggable/collapsible floating overlay
  inside the Strudel editor webview that runs alongside the user like a minigame HUD:
  - Shows the current stage prompt, progress bar (`Stage 2 / 6`), live **Score**, **Streak /
    Combo** counter, and **Hardcore Mode** toggle + countdown clock.
  - Primary **"Verify"** button (plus keyboard shortcut): runs the user's `.strudel` code in
    the real Strudel engine, inspects syntax/runtime status, AST/source structure, and
    evaluated pattern haps (e.g. expected sounds, notes, effects, cycle structure, or audio
    activity), and reports **concrete, actionable feedback** on exactly what passed and what
    still needs fixing.
  - Progressive **"Hint"** button (reveals tiered hints at a small score penalty) and
    **"Next stage"** / **"Retry"** controls.
- **Immediate visual and audio feedback:**
  - **Fail state:** Turns the editor screen background **red** (translucent red wash/tint that
    **stays red until the user fixes the code and passes verification**), plays a short
    fail/buzz arcade SFX cue, and highlights the specific line or missing requirement in the
    floating window.
  - **Pass state:** Clears the red background, flashes a crisp green victory confirmation,
    plays a synthesized Web Audio success/level-up fanfare alongside the user's playing
    Strudel pattern, increments score/streak, and unlocks the next stage (letting the user
    jam before clicking Next).
- **Minigame progression & persistence (`context.globalState`):**
  - **Scoring:** Base points per stage + first-try bonus + no-hint bonus + streak combo
    multiplier (`x1`, `x2`, `x3`...).
  - **Streaks, ranks & replayability:** Tracks active consecutive-pass streak, best streak,
    stars/rank per level/chapter, personal best times, and unlockable badges in
    `context.globalState`.
  - **Sound effects:** Dedicated Web Audio minigame SFX channel (respecting a mute-SFX
    toggle) for stage start, verify pass, verify fail, streak milestone, and Hardcore
    countdown ticks.
- **Hardcore Mode (time-sensitive arcade mode):**
  - Toggleable per level or globally in the floating assistant.
  - Starts a live **countdown timer** (`parSeconds`, scaled by stage complexity) with a visual
    urgency bar and subtle tick/heartbeat audio cues in the final seconds.
  - Verifying before time runs out awards a **speed multiplier** and Hardcore completion mark;
    running out of time turns the background red, breaks the Hardcore streak (or costs a
    life / forces stage restart), and prompts a fresh timed run.

---

## 4. Clean DAW Profile (`UX-12`) & `template/` -> `music/` (`#19`)

### Clean DAW Profile & Auto-Hiding Views (`UX-12` - maintainer 2026-11-26)

VS Code has no extension API to hide or restore built-in bottom panel tabs (`Ports`,
`Comments`, `Debug Console`) per file type, and Profiles are scoped per workspace/window.
We combine three supported mechanisms instead:

1. **Importable `template/strdltn.code-profile` + Welcome Screen action:** `template/strdltn.code-profile`
   (already committed) ships a clean `"Strudel"` DAW profile (`[str]dltn` enabled, `files.autoSave: off`
   for `.strudel`/`markdown`, `Ports`/`Comments`/`Debug Console`/`Test Results` unpinned,
   `Mixer` and `Devices` pinned first). Add an **"Import clean DAW Profile"** button/card in
   `UX-5` Welcome Screen and document `Profiles: Import Profile...` in `README.md` / `doc/USERMANUAL.md`.
2. **Auto-hide our own panels on non-`.strudel` files:** Maintain a `strdltn.isStrudelFile`
   context key on active-editor changes so `Mixer` and `Devices` automatically hide on code
   files and reappear + focus `Mixer` when a `.strudel` file is active (behind an optional
   setting, default on).
3. **Folder binding & Windows `.strudel` launch:** Document binding a music folder with
   `code --profile "Strudel" <folder>` and optional Windows `.strudel` file association
   (`code --profile "Strudel" "%1"`).

### Rename `template/` to `music/` (`#19` - maintainer 2026-11-26)

- Move `template/` to `music/` (making the repo's music folder self-describing and cleanly
  bindable to the `"Strudel"` VS Code Profile) and refactor all ~19 referencing files
  (`.gitignore`, `.vscode/launch.json`, `AGENTS.md`, `CLAUDE.md`, `.github/instructions/strudel.instructions.md`,
  `README.md`, `doc/*.md`, `scripts/build-reference.mjs`, `scripts/build-tutorial.mjs`,
  `scripts/smoke/smoke.html`, `src/shared/chains.ts`, `src/shared/chains.test.ts`, and
  `.strudel` comments). Run as its own clean commit when no parallel edits are touching `src/`
  or `template/`.

---

## 5. Devices Rotary Knob Grid, Param Search & Remaining Firmware Runtime (`UX-6`)

Firmware Hub discovery, install, batch download, VIBE `.wasm`, `SHRUB (WASM)`, `.fwsc`
(`fm1-emu` and native `fm1-live`), Hardware MIDI profiles, and Devices live screens/soft keys
are **already shipped** (see `doc/ARCHITECTURE.md`). Only these enhancements remain unbuilt:

- **SVG rotary arc knobs (`src/devices/main.ts`, `devices.css`):** Replace stacked raw
  `<input type="range">` bars with a compact grid of SVG rotary knobs (vertical drag,
  `Shift`+drag fine control, double-click reset to `param.def`, right-click **"Copy
  `.vp(id, val)`"** or **"Insert slider"**).
- **Parameter search & auto-grouping:** Filter box inside `.params` and prefix-based group tabs
  (`OSC`, `FLT`, `ENV`, `FX`) for large synths like OBERVAVE (236 parameters).
- **Display bezel & soft keys:** Subtle hardware bezel around the 480x320 `<canvas>`, tactile
  F1-F6 alignment, and subtle active-LED glow on note hits.
- **Per-firmware continuous stream FX bus (same pattern as `djf`, Decision 14):** Insert one
  persistent Web Audio FX chain per firmware instance (`id@orbit`) right before
  `orbit.summingNode` (`worklet -> hpf -> lpf -> pan -> gain -> orbit.summingNode`, plus
  persistent `roomSend -> orbit.getReverb()` and `delaySend -> orbit.getDelay()` taps),
  scheduling `setValueAtTime` from each hap in `trigger()` (and in offline render). Works for
  both `vibefm1` and `fm1` with zero stream duplication / chord-doubling.
- **`.vp()` automation, persistent store & `.midi("vibefm1:...")`:** Wire `.vp(id, val)`
  through `VIBE_EV_PARAM` so sliders in code automate firmware parameters; persist
  `vibe_host_store` writes in `.strdltn/firmware-store/<id>/`; route `.midi("vibefm1:...")`
  (CCs + `midimaps`) to running VIBE firmwares; add a "Clear firmware cache" command for
  global storage; and verify transport sync on a self-sequencing firmware (SLOOP).
- Open decision (19 in `doc/TODO.md`): turning a knob in Devices changes sound only + "Copy as
  code" (recommended) vs writing `.vp()` directly into code.

---

## 6. Per-Chain Effect Rack (`UX-7`) & Visual Filter Curve (`UX-8`)

### Key `superdough@1.3.0` DSP Facts

- Per-hap audio FX execute in a **fixed DSP signal order** regardless of code order:
  `Source -> LPF -> HPF -> BPF -> Vowel -> Coarse -> Crush -> Shape -> Distort -> Tremolo -> Compressor -> Pan -> Phaser -> Postgain -> Orbit Bus (Delay, Room, DJF, Ducking)`.
- **Pattern transformers** (`.fast()`, `.slow()`, `.euclid()`, `.struct()`, `.mask()`, `.jux()`,
  `.rev()`, `.echo()`, `.ply()`, `.rib()`, `.swingBy()`, `.degradeBy()`) ARE genuinely
  order-dependent.
- Native filter/tone capabilities: serial per-hap **LPF** (`.lpf/.lpq`), **HPF** (`.hpf/.hpq`),
  **BPF** (`.bpf/.bpq`), slope/model (`.ftype('12db' | '24db' | 'ladder')`), filter envelopes
  (`lpenv/hpenv/bpenv`), filter LFOs (`lprate/lpdepth`), **Vowel** (`.vowel()`), and orbit
  **DJF** (`.djf()`). No native peaking/lowshelf/highshelf/notch parametric bands exist in
  `superdough@1.3.0`.

### Ableton-Style Per-Chain Effect Rack (`UX-7`)

Left-to-right track chain (**Pattern FX -> Source/Instrument -> Audio FX -> Orbit Sends**) in
the bottom `Devices` panel, synced to the selected Mixer strip / cursor chain:

1. **AST Spine Parser (`src/shared/rack.ts`, extending `chains.ts`):** Groups related calls into
   logical Device Cards (`.delay(.4).delaytime(.375).delayfeedback(.45)` -> one **Delay** card
   with Mix, Time, Feedback knobs). Pattern FX sit left of Source and are drag-reorderable;
   Audio FX snap into true `superdough` DSP order with `->` arrows.
2. **Code sync:** Existing `slider(...)` drives `moveSlider()` at 60 fps with zero stutter;
   numeric literals update on mouse-up (150 ms debounced + re-eval) with a 1-click **"Pin as
   Slider"** button; modulated expressions badge `~ Modulated` without clobbering them.
3. **`strudel.cc`-safe bypass LED:** Clicking a card's power LED wraps/unwraps its method calls
   in an inline block comment (`/* .dist(2).distvol(.3) */`) in one undo step.
4. **`+ Add Effect` popover:** Appends defaults or slider-backed calls onto the chain spine.

### Visual Filter Curve + Live Chain FFT Spectrum (`UX-8`)

Flagship Rack device using 100% pure standard Strudel filter calls:

1. **Free live per-chain FFT spectrum:** `meterOrbits()` in `src/webview/main.ts` already taps
   every chain into its own `AnalyserNode` (`fftSize = 2048`). Read `getByteFrequencyData()` on
   the single selected chain, downsample to 64 log-spaced bins (20 Hz - 20 kHz), and send
   `Uint8Array(64)` at 20 fps (~1.2 KB/s) - zero extra WebAudio nodes.
2. **Analytical response curve:** Log 20 Hz - 20 kHz grid showing combined RBJ biquad response
   of `.hpf/.hpq`, `.bpf/.bpq`, `.lpf/.lpq`, and `.ftype()`, plus dashed ghost curve for
   `.lpenv` / modulated cutoffs and formant markers (`F1, F2, F3`) for `.vowel()`.
3. **Tactile controls:** 3 color-coded draggable nodes (HPF cyan, BPF amber, LPF orange/track
   color; X = log freq, Y = Q, wheel = fine Q), double-click empty canvas to add nearest band,
   slope pill (`12dB` / `24dB` / `Ladder`), and **"Pin as Sliders"**.

---

## 7. Mixer Stacks (`#6b`) & MIDI Routing in Mixer (`DAW-5`)

### Stacks in the Mixer (`#6b`)

- A chain made of `stack(a, b, c)` renders as a foldable group strip (like Live's Group Track /
  Instrument Rack): folded shows name, M, S, and outer gain; unfolded shows member strips inside
  its border, each foldable on its own. Nested `stack()` calls nest.
- `readChains()` adds `parent` on member chains and a list of stack ranges. Duck cables land on
  the stack jack when every member shares the ducked orbit, else on individual members.

### MIDI Routing in the Mixer (`DAW-5` - Phase 5 remainder)

- Top Mixer view switch `[ ALL | CHAINS | MIDI ]` (starts on `CHAINS`; unlocks "Show MIDI
  Routing" in Mixer toolbar).
- **MIDI device strips** (in `MIDI` and on the right of `ALL`): name, MIDI port, channel 1-16,
  purple input jack, note activity LED, `+ device` button to add strips (multiple channels per
  port allowed).
- **Purple solid MIDI cables** (`--vscode-charts-purple`): drag from a chain's `midi` jack onto
  a device strip to write `.midi("Port", { midichannel: 2 })`; pull off to remove.
- In Codespaces, the Browser's MIDI category shows an explicit note that hardware MIDI requires
  desktop VS Code (or Phase 7 browser engine).

---

## 8. DJ Two-Deck Performance Suite & Split-Mono Cue (`DAW-8` - Phase 8)

Adds a fourth Mixer view `[ ALL | CHAINS | MIDI | DECKS ]` for live DJing between two open
`.strudel` songs (each already runs its own `AudioContext` + scheduler with
`retainContextWhenHidden`).

- **Beat & phase sync:** Each scheduler knows `cps` and exact cycle (`BPM = cps * 240`, with
  `x2` / `/2`). Engines map audio time to shared wall clock via
  `AudioContext.getOutputTimestamp()` + `performance.timeOrigin` (Spike J1). Sync matches `cps`
  (re-applied in `afterEval` as a performance override, preserving master tempo) and aligns
  downbeats via short tempo nudges (`setCps`, Spike J4).
- **Deck audio chain (Spike J2):** Intercepts `getSuperdoughAudioController().output.destinationGain`
  (re-attaching after `reset()`):
  `destinationGain -> 3-band EQ / isolator -> bipolar DJ filter -> channel fader -> crossfader gain -> analyser -> destination`.
- **Deck strip controls:** Load to Deck A/B from Browser, Play/Stop/Cue (quantized to next bar),
  tempo slider (+-8%), BPM + `x2`/`/2`, Sync + nudge `-/+`, twin 4-beat scrolling phase bars,
  High/Mid/Low EQ knobs (with kill), bipolar Filter knob, channel fader, level meter, hold-to-engage
  beat-repeat / loop-freeze pads, and central horizontal Equal-Power / Hard-Cut crossfader
  (all MIDI-learnable).
- **Split-Mono Headphone Cueing (workaround for Spike S6):** Because VS Code webviews cannot
  enumerate audio output devices for `setSinkId` (Spike S6 -> Spike J3 blocked), provide a
  **"Split Mono Cue (L=Master / R=Cue)"** toggle using a `ChannelMergerNode(2)` so a standard
  DJ stereo-to-dual-mono splitter cable gives zero-latency headphone pre-listening on desktop
  and Codespaces.
- **Messages:** `clock {cps, cycle, wallTime}`, `deck {gain, xfade, eq, filter}`,
  `tempo {cps, keep}`, `nudge {factor, ms}`, `startAt {wallTime}`.
- **Open decisions (in `doc/TODO.md`):** Decision 20 (start deck settings at neutral vs
  remember in `strdltn.index.json`); Decision 21 (isolator kill EQ vs shelving EQ).

---

## 9. Recording (`DAW-9`), Arrangement View & Session Clip Matrix (`DAW-10`)

### Performance & Automation Recording (`DAW-9` - Phase 9)

- **Record Automation** button (empty red circle beside Record audio in Music Controls) records
  every performance action against the scheduler's cycle: evaluated code snapshots (stored as
  diffs from `afterEval`), slider/fader/knob trajectories (<=50 Hz, keyed by semantic name such
  as `KICK_VOL` or `bass.lpf` rather than text offset), mute/solo/cable edits, and deck controls.
- Saved beside the song as `<song>.arrangement.json` (plain git-friendly file; song `.strudel`
  stays pure Strudel). Supports count-in, punch-in over a bar range, and cycle-accurate playback
  (evaluating code ahead by measured lead time, Spikes A1-A2).
- Open decision (22 in `doc/TODO.md`): optional "record untried typing" for code-writing video
  replay (off by default).

### Arrangement View & Live Session Clip Matrix (`DAW-10` - Phase 10)

- **Arrangement custom editor (`*.arrangement.json`):** Bar/beat ruler with playhead, code
  evaluation marks, one lane per chain (showing active bars; deleting a range inserts a
  mute/unmute pair), foldable slider automation curve lanes (drag points, pencil draw, snap to
  step), deck lanes, range copy/paste, and **Export to plain Strudel** via `arrange([bars, part])`
  and value patterns (Spike A3).
- **Live Session Clip Matrix:** Compact Ableton Session View grid where columns are `$chain:`
  tracks and rows are scenes/sections auto-detected from `arrange()` / `pick()` / `mask()` (or
  recorded snapshots), with quantized next-bar launch countdown.

---

## 10. Advanced Sequencing, Melody/Drum Line Actions, MIDI Clips & Macros (`DAW-11`, `UX-9`, `#17`, `#18`)

All sequencing devices open as bottom-panel `Devices` panels (or from line-action buttons beside
`M / S / C` in the editor gutter), read calls via `src/shared/chains.ts`, and write clean,
undoable Strudel mini-notation back into the song (Spikes Q1-Q2).

- **Melody & Drum Rack line actions (`doc/TODO.md` #20):**
  - **Melody button** on pitched lines (`note(...)`, `n(...).scale(...)`): opens a scale-fitted
    piano roll that records quantized notes from MIDI keyboard or computer keyboard (absolute
    `c3 e3 g3` or scale-relative `0 2 4`, replace/overdub, held notes `note@k`).
  - **Drum Rack button** on drum lines (`s("bd sd hh")`, `.bank(...)`): 4x4 pad grid (C1 to
    D#2), sample names, M/S/play per pad, customizable MIDI note map, and loop-record arm.
- **Step Sequencer & Circular Euclidean Rhythm Ring:** 8/12/16/32-step grid with live playhead,
  drag velocity (`.velocity(...)`), right-click step chance (`?`), and visual circular Euclid
  ring writing `beat("0,4,8,11", 16)` or `.euclidRot(5, 16, 2)`.
- **Visual Breakbeat Slicer:** Waveform cut into 4/8/16 clickable/MIDI-mappable pads writing
  `.slice(8, "0 3 [2 2] 5 4 7 6 1")` or `.splice(...)`.
- **Additional Phase 11 generators:** Chords/Arp (`chord(...).voicing().arp(...)`), Groove
  (`.swingBy()` / `.nudge()`), Chance (`.degradeBy()`), Note Repeat (`.ply()` / `"hh*8"`),
  Echo (`.echo()`).
- **Visual LFO & Parameter Modulation Drawer:** Right-click any Mixer fader or Rack knob ->
  **"Modulate (LFO)..."**: waveform picker (`sine`, `tri`, `saw`, `isaw`, `square`, `perlin`,
  `rand`), rate, and min/max with live cycle-synced curve preview writing
  `.lpf(sine.slow(4).range(200, 2000))`.
- **Global Performance Macro Rack & Morphable Scene Snapshots (`UX-9`):** 8-knob Macro bar
  mapping one knob to multiple sliders with custom/inverted ranges (e.g. a single "BUILDUP"
  macro), plus 8 recallable/morphable slider snapshots stored in `strdltn.index.json` while
  keeping live numbers in code `slider(...)` calls.
- **MIDI Clips (`#17`, `#18`):**
  - **Render pattern to `.mid`:** Query `[0, cycles)` via `queryArc`, map notes/velocities/
    `midichan`/CCs to a standard format-1 `.mid` file next to the song (480 ticks/beat).
  - **Record MIDI into a pattern:** Arm, count-in, quantize MIDI input from `MidiBridge` into
    mini-notation (`[a,b]` chords, `~` rests, `note@k` ties, parallel `.velocity("...")`).

---

## 11. Shared Browser Engine (`DAW-6`) & Browser Page Engine (`DAW-7`)

### One Shared Engine in the Browser (`DAW-6` - Phase 6)

- Move Strudel's `AudioContext` + `superdough` into the long-lived Browser webview
  (`retainContextWhenHidden`) and run code evaluation + clock + `queryArc` lookahead in a
  dedicated Web Worker (matching `m4l-gugelhupf`).
- Editors and Stage become lightweight views receiving highlight/draw events through the host.
- **Unlocks:** sound continues seamlessly across Strudel <-> native editor switches, one audio
  unlock per VS Code window, exact shared clock across decks, and Stage dock/float.
- **Gated by spikes:** E1 (hidden webview audio/timers), E2 (remote highlighting/drawing in
  editor), E4 (worker evaluation + superdough timing), E5 (long-lived `AudioContext` stability).

### Engine as a Browser Page (`DAW-7` - Phase 7)

- Serve the engine bundle + workspace files from a small host server and connect editor, Browser,
  and Mixer over WebSocket.
- Opened in the user's real browser (via forwarded port in Codespaces), giving **WebMIDI in
  Codespaces** and real output device selection (`setSinkId`) with upstream `@strudel/midi`
  unchanged. Gated by Spike E3.

---

## 12. Recommended Execution Batches

| Batch | Scope | Effort | Spikes / Dependencies |
|---|---|---|---|
| **Batch A (Active: `feat/ui-overhaul`)** | Visual UX/UI Overhaul (`UX-10` Full-Screen Synths Gallery, `UX-5` Welcome Screen with screenshots, `UX-6` Devices SVG Rotary Knobs/Param Search/Bezel) | 2-3 sessions | None (pure visual/ergonomic wins; no deep DAW spikes) |
| **Batch B (Interactive Tools)** | `UX-4` In-Place Sound Hot-Swap + `#6d` Interactive Minigame Tutorial (`rustlings` for Strudel + Hardcore Mode) + `#5` Songs as Files & Places + `UX-6` Runtime (per-firmware stream FX bus like `djf`, `.vp()`, `vibe_host_store`, `.midi("vibefm1:...")`, cache clear) | 2-3 sessions | Decision 14/19 |
| **Batch C1 (Track DSP UI)** | `UX-7` Per-Chain Effect Rack (`src/shared/rack.ts`) + `UX-8` Visual Filter Curve & Live FFT | 3-4 sessions | Existing `chains.ts` & `meterOrbits()` |
| **Batch C2 (Mixer MIDI & DJ)** | `#6b` Mixer Stacks + `DAW-5` Mixer MIDI strips/cables + `DAW-8` DJ Two-Deck Suite & Split-Mono Cue | 3-4 sessions | Spikes J1, J2, J4 |
| **Batch C3 (Arrangement & Sequencing)** | `DAW-9/10` Recording, Arrangement & Session Matrix + `DAW-11` Sequencing/Slicer/LFO + `UX-9` Macros + `#17`/`#18` MIDI Clips | 4-6 sessions | Spikes A1-A3, Q1-Q2 |
| **Batch C4 (Engine Architecture)** | `DAW-6` Shared Browser Engine + `DAW-7` Browser Page Engine (Codespaces WebMIDI) | Largest | Spikes E1-E5 |

# UX/UI Overhaul & Standout DAW/DJ Roadmap (Handover)

Handover document for the next agent session working on the visual redesign, tactile DAW
instruments, Welcome Screen, and DJ features of `[str]dltn Live[code]`. Grounded in the
current codebase (`src/browser/`, `src/mixer/`, `src/devices/`, `src/webview/`,
`src/shared/chains.ts`), `doc/DAW-PLAN.md`, `doc/ARCHITECTURE.md`,
`doc/DRAWER_OF_FAILED_IDEAS.md`, and pinned `superdough@1.3.0` / `@strudel/*`.

Read `CLAUDE.md` and `doc/PENDING-TESTING.md` first before changing files.

---

## Already Done (Do Not Redo)

These items from the earlier discovery pass are already implemented on `feat/firmware-marketplace`:

- **Drag-and-drop from Browser into Strudel editor, native editor, and Mixer**
  (`src/shared/drop.ts`, `src/extension/extension.ts`, `src/mixer/main.ts`, `src/webview/main.ts`):
  context-aware `$name:` lines, bare names inside strings, effect drops onto existing chains,
  and drops onto the Mixer strip area.
- **Unified `Plugins > FM-1 Synths` (`Installed` / `Available`)** with `WASM`, `FWSC`, `EXT`,
  and `MIDI` badges, `Runtime/...` and `Repo/...` chips, firmware repositories (`The Firmware Hub`,
  direct `shrub.audio` `.fwsc` download, custom URLs), batch download (`Download all (N)`),
  centered pre-loaded screen thumbnails, native `fm1-live` JIT runner, and experimental USB-MIDI
  SysEx flashing (`strdltn.experimental.fm1Flash`, off by default).
- **Controls pane layout** (centered BPM box, Back/Forward history on the right of search,
  Undo/Redo, all-synth 1-loop previews with smooth fade-out).
- **Aligned `M / S / C` line actions** in both the Strudel editor and the native VS Code editor
  (`src/shared/lineActions.ts`, `src/webview/main.ts`, `src/extension/knobs.ts`).
- **Unnamed Mixer strips** auto-named from their synth/instrument (`chainInstrument()` in
  `src/shared/chains.ts`).

---

## 1. Visual Redesign & Polish

Right now most views rely on flat VS Code defaults (`1px solid var(--vscode-panel-border)`, raw
native `<input type="range">`, monochrome mixer strips, bare `#unlock` overlay). Elevate them
into a tactile instrument without adding a UI framework or breaking VS Code light/dark/high-contrast
theme harmony.

### A. Cohesive Color System & Visual Hierarchy (Across All Views)

- **Track Colors first (`// @color <name>` - `doc/DAW-PLAN.md` Decision 24):** Highest-leverage
  visual upgrade across the entire extension. Once `readChains()` reads/writes track colors from
  a curated Ableton-inspired 12-16 color palette:
  - **Mixer:** 3px top accent bar on each strip header, subtle tinted hover/selected glow,
    track-colored active pump scope (with soft vertical gradient fill), and color-coded plug
    collar on the jack (keeping sidechain cables dashed orange and MIDI cables solid purple).
  - **Editor gutter:** thin 2-3px vertical colored bar in the `strdltn-actions` gutter along
    each chain block so the eye maps code lines to mixer strips immediately.
  - **Devices:** show the owning chain's color swatch in the firmware/effect header.
- **Semantic Role Tokens:** Shared CSS variable layer (`--strdltn-play`, `--strdltn-rec`,
  `--strdltn-warn`, `--strdltn-sidechain`, `--strdltn-midi`, `--strdltn-surface-raised`,
  `--strdltn-surface-recessed`) across Browser, Mixer, Devices, and Stage.
- **Tabular Numerals:** Enforce `font-variant-numeric: tabular-nums` on every live readout
  (`BPM`, `.peakhold`, `.fader .value`, `.scope-value`, `.param .pvalue`, pane counts) so
  numbers never jitter horizontally while playing or turning knobs.

### B. Mixer (`src/mixer/main.ts`, `src/mixer/mixer.css`, `src/mixer/cables.ts`)

1. **Custom styled sub-control faders:** Replace raw Chromium `<input type="range">` on unfolded
   sub-controls (`lpenv`, `lpf`, `dist`) with recessed vertical tracks, a filled value bar
   (bottom-up accent fill, or center-out bipolar fill for `pan`), and a crisp 2px horizontal cap.
2. **Pro-Grade Level Meters (`drawMeter`):**
   - Subtle 1px segmented LED gaps or a crisp 2px floating peak-hold tick inside L/R bars.
   - Subtle -6 dB / 0 dB guide hairlines across the meter well and a red clip LED cap at top.
   - Distinct darker/recessed Master strip with thicker right separator and wider stereo meter.
3. **M / S / Active State Micro-Interactions:**
   - Distinct active colors for **M** (amber/orange `#e5a00d`) and **S** (vivid blue `#3794ff`),
     harmonized across Mixer and Editor `M/S` actions.
   - Chain activity LED (6px pulsing dot beside strip name using existing `ScopeFrame.level`).
   - Soft vertical gradient fill beneath the pump scope waveform and recessed bezel.
4. **Cables Polish (`src/mixer/cables.ts`):**
   - Dark under-stroke halo (`rgba(0,0,0,0.45)`, `stroke-width: 5`) behind crossing cables.
   - Rounded pill backdrop (`<rect rx="3">`) behind orbit labels.
   - Briefly brighten/thicken outgoing orange sidechain cables when a ducking chain fires
     (`frame.level > 0.2`).
5. **Utility Column Ergonomics (`.tools`):** Replace rotated sideways text buttons
   (`writing-mode: vertical-rl`) with a crisp top Mixer toolbar or icon-with-tooltip rail.

### C. Browser (`src/browser/main.ts`, `src/browser/browser.css`, `src/browser/controls.ts`)

1. **Transport Strip as a DAW Header:**
   - Recessed pill container around `Play / Stop / Rec / Render`, 4-dot beat pulse indicator
     synced to the active song's cycle, **Tap Tempo** (clicking `BPM` label 4 times), and
     **vertical drag on BPM** (like Ableton's BPM box) alongside typing.
   - Compact active-song sub-row with live status dot (green = playing, red = error/recording,
     gray = stopped).
2. **Waveform Sparklines in Details Pane:** `playPreview()` already decodes the `AudioBuffer` -
   render a 40px waveform `<canvas>` in `.details` with moving playhead, duration, and sample rate.
3. **Rows & Breadcrumbs:**
   - Animated mini-EQ / playing indicator on the row currently previewing.
   - Removable breadcrumb pill in `.resultbar` (`Drums > RolandTR909 x`).

### D. Devices (`src/devices/main.ts`, `src/devices/devices.css`)

- **Hardware-Style Rotary Knobs:** Replace stacked `<input type="range">` bars with a compact
  grid of SVG rotary arc knobs (vertical drag, `Shift`+drag fine control, double-click reset to
  `param.def`, right-click *"Copy `.vp(id, val)`"* or *"Insert slider"*).
- **Parameter Search & Auto-Grouping:** Filter box inside `.params` and auto-grouping by prefix
  (`OSC`, `FLT`, `ENV`, `FX`) for synths like OBERVAVE (236 parameters).
- **Display & Soft-Keys Frame:** Subtle hardware bezel around the 480x320 `<canvas>`, tactile
  F1-F6 buttons aligned under display labels, and subtle active-LED glow on note hits.

### E. Editor & Stage (`src/webview/main.ts`, `src/extension/session.ts`)

- **Upgrade `#unlock` Overlay:** Replace bare `"Click to enable audio"` with a glassmorphic card
  showing the `[str]dltn` mark, prominent Play button, and 1-line hint.
- **Stage Dock Cards:** Frosted dark backdrop (`backdrop-filter: blur(8px)`) on `.dock-group` so
  visuals stay legible over Hydra backgrounds.
- **Inline Error Toast in Strudel Editor:** Compact dismissible bottom error toast with a
  *"Jump to error"* button wired to `locateError()`.

### F. Colorful First-Install Welcome Screen (`doc/TODO.md` #16)

- Requested by the maintainer on 2026-11-26: an Eclipse/IDE-style **Welcome Screen** webview tab
  shown automatically once on first install, explaining the main features with **colorful visual
  cards and real screenshots** (from `doc/screenshot-*.png` / `doc/manual/*.png`), plus a
  **"Do not show me this again"** checkbox persisted in `globalState` (and a Command Palette
  command `strdltn: Open Welcome Screen` to re-open anytime).

---

## 2. Tactile Track Instruments & Audio Rack

### A. Ableton-Style Effect Rack per `$` Chain (`src/shared/rack.ts` + Devices Panel)

Key `superdough@1.3.0` DSP fact:
- Per-hap audio FX run in a **fixed DSP signal order** regardless of code order:
  `Source -> LPF -> HPF -> BPF -> Vowel -> Coarse -> Crush -> Shape -> Distort -> Tremolo -> Compressor -> Pan -> Phaser -> Postgain -> Orbit Bus (Delay, Room, DJF, Ducking)`.
- **Pattern transformers** (`.fast()`, `.slow()`, `.euclid()`, `.struct()`, `.mask()`, `.jux()`,
  `.rev()`, `.echo()`, `.ply()`, `.rib()`, `.swingBy()`, `.degradeBy()`) ARE order-dependent.

Design:
1. **AST Spine Parser (`src/shared/rack.ts`, extending `chains.ts`):** Group related calls into
   logical Device Cards (`.delay(.4).delaytime(.375).delayfeedback(.45)` -> one Delay card with
   3 rotary knobs). Pattern FX sit left of Source and are drag-reorderable; Audio FX snap into
   their true `superdough` DSP order with `->` arrows.
2. **Code Sync:** Drive existing `slider(...)` at 60 fps via `moveSlider()`; update numeric
   literals on mouse-up (150 ms debounced + re-eval) with a 1-click **"Pin as Slider"** button;
   badge modulated expressions `~ Modulated` without clobbering them.
3. **strudel.cc-Safe Bypass Toggle:** Power LED wraps/unwraps a card's method calls in an inline
   block comment (`/* .dist(2).distvol(.3) */`) in one undo step.
4. **`+ Add Effect` Popover:** Appends sensible defaults or slider-backed calls to the spine.

### B. Visual Filter Curve + Live Chain FFT Spectrum (Flagship Rack Device)

Honest `superdough@1.3.0` capability check:
- Natively supported: serial per-hap **LPF** (`.lpf/.lpq`), **HPF** (`.hpf/.hpq`), **BPF**
  (`.bpf/.bpq`), slope/model (`.ftype('12db' | '24db' | 'ladder')`), filter envelopes
  (`lpenv/hpenv/bpenv`), filter LFOs (`lprate/lpdepth`), **Vowel formants** (`.vowel()`), and
  orbit **DJF** (`.djf()`). No native peaking/shelf/notch parametric EQ in `superdough@1.3.0`.
- **Free Live Per-Chain FFT Spectrum:** `meterOrbits()` in `src/webview/main.ts` ALREADY taps
  every chain into its own `AnalyserNode` (`fftSize = 2048`). Reading `getByteFrequencyData()` on
  the single selected chain, downsampling to 64 log-spaced bins (20 Hz - 20 kHz), and sending a
  `Uint8Array(64)` at 20 fps (~1.2 KB/s) draws a live spectrum behind the curve with zero extra
  WebAudio nodes.
- **Analytical Curve & Tactile Nodes:** Log 20 Hz - 20 kHz grid with exact RBJ biquad response,
  3 color-coded draggable nodes (HPF cyan, BPF amber, LPF orange/track color; X = freq, Y = Q,
  wheel = fine Q), dashed ghost curve for `.lpenv`, slope pill (`12dB` / `24dB` / `Ladder`), and
  double-click to add an inactive band.

---

## 3. Standout DAW & DJ Features

All features keep *"the code stays the song"*, map to real Strudel functions, respect VS Code
webview limits, and avoid dead ends in `doc/DRAWER_OF_FAILED_IDEAS.md`:

1. **DJ Two-Deck Performance Suite + Split-Mono Headphone Cueing (`doc/DAW-PLAN.md` Phase 8):**
   - Twin decks with scrolling 4-beat phase-alignment bars, WebAudio 3-band kill-isolator EQ on
     deck buses, bipolar DJ filter, crossfader (Equal Power / Hard Cut), and hold-to-engage
     beat-repeat / loop-freeze pads.
   - **Workaround for Spike S6 (no `setSinkId` in webviews):** **"Split Mono Cue (L=Master /
     R=Cue)"** toggle using a `ChannelMergerNode(2)` for zero-latency headphone cueing with a
     standard stereo-to-dual-mono DJ splitter cable (works on desktop and Codespaces).
2. **Live Session Clip Matrix & Section Launcher (Over `arrange` / `pick` / `mask`):**
   - Ableton Session View grid where columns are `$chain:` tracks and rows are scenes/sections
     auto-detected from `arrange()` / `pick()` arrays, with quantized next-bar launch countdown.
3. **Instant Sample Waveform Trim & Visual Breakbeat Slicer:**
   - Zoomable waveform in Browser Details with draggable `.begin()`/`.end()` trim handles.
   - Line-action Visual Slicer for `s("break")` lines splitting into 4/8/16 pads writing
     `.slice(8, "0 3 [2 2] 5 4 7 6 1")` or `.splice(...)`.
4. **Interactive Mini-Notation Rhythm & Euclid Strip (`doc/TODO.md` #20):**
   - 16-step sequencer strip with live playhead, drag velocity (`.velocity(...)`), right-click
     step chance (`?`), and a visual circular Euclidean Rhythm Ring writing `beat(...)` /
     `.euclidRot(...)`.
5. **In-Place Sound Hot-Swap ("Live Audition in the Mix"):**
   - Ableton `Q` Hot-Swap: lock Browser to a chain's `s("...")`/`.bank("...")` token, step with
     `Up`/`Down` to swap sounds live in the playing mix (`Enter` keeps, `Esc` reverts in 1 undo).
6. **Global Performance Macro Rack & Morphable Scene Snapshots:**
   - 8-knob Macro bar mapping one knob to multiple sliders with custom/inverted ranges, plus 8
     recallable/morphable slider snapshots stored in `strdltn.index.json`.
7. **Beat-Synced Transport HUD & Master Output Safety Limiter:**
   - `BAR 17 | BEAT 3`, 4 glowing beat LEDs, Tap Tempo, clickable `arrange()` / `@length` progress
     bar, and optional toggleable `DynamicsCompressorNode` brickwall limiter on `destinationGain`.
8. **Visual LFO & Parameter Modulation Drawer:**
   - Right-click any Mixer fader or Rack knob -> *"Modulate (LFO)..."*: pick waveform
     (`sine`/`tri`/`saw`/`isaw`/`square`/`perlin`/`rand`), rate, and min/max with live preview,
     writing `.lpf(sine.slow(4).range(200, 2000))`.

---

## 4. Recommended Execution Order for the Next Agent

| Wave | Focus | Effort | Dependencies |
|---|---|---|---|
| **Wave 1** | **Track Colors (`// @color`) + Visual Polish Pass** (Mixer custom sub-faders, LED meters, amber M / blue S, cable shadows/pulse, top Mixer toolbar, `tabular-nums`, frosted `#unlock` & Stage dock) | 1-2 sessions | None |
| **Wave 2** | **Beat-Synced Transport HUD + Master Safety Limiter + Browser Waveform Sparklines + In-Place Hot-Swap** | 1-2 sessions | None (`scheduler.now()`, `AudioBuffer`, `context.ts` exist) |
| **Wave 3** | **Colorful First-Install Welcome Screen** (with visual screenshots + "Do not show me this again") + **Devices Rotary Knob Grid & Param Search** | 1-2 sessions | Screenshots in `doc/` |
| **Wave 4** | **Per-Chain Effect Rack (`src/shared/rack.ts`) + Visual Filter Curve with Live Chain FFT Spectrum** | 3-4 sessions | Existing `chains.ts` and `meterOrbits()` `AnalyserNode` |
| **Wave 5** | **DJ Two-Deck Performance Suite + Split-Mono Headphone Cueing** | 3-4 sessions | Spikes J1, J2, J4 (`doc/DAW-PLAN.md` Phase 8) |
| **Wave 6** | **Session Clip Matrix + Visual Slicer + Euclid/Rhythm Strip + Macro Rack + LFO Drawer** | 4-6 sessions | Spikes A1, Q1, Q2 (`doc/DAW-PLAN.md` Phases 10-11) |

# Pending Manual Testing

Live, branch-agnostic checklist of unverified features across branches and merges.
Agents update this file in place as features change - adding new checks, revising or
removing superseded checks, and deleting items once the maintainer confirms they passed -
so the maintainer can batch many features into one manual test pass.

Target: **desktop VS Code, Extension Development Host launched with F5**, workspace `template/`.

## Browser, Controls and Previews

| # | Area | Do this | Should happen |
|---|---|---|---|
| 1 | Controls layout | Open the Browser side bar and inspect the top Controls pane | BPM box is centered in the transport row; Back/Forward history arrows sit on the right side of the search bar |
| 2 | All-synth previews (no song) | Close all `.strudel` tabs, open `Sounds > Synths`, and single-click `sine`, `sawtooth`, `supersaw`, `gm_acoustic_bass`, `zzfx` | Each plays a 1-loop preview at 120 BPM (2 s), fades out smoothly over 0.5 s, and stops cleanly; clicking Stop cuts it off at once |
| 3 | Effect drag into editor | Open a song, play it, and drag an effect function (`lpf` or `room` from `Reference > Functions`) onto an existing `$name:` chain line in the Strudel editor | Appends `.lpf(800)` or `.room(0.4)` onto that chain without breaking playback |
| 4 | Drag onto Mixer | Drag any synth, drum, sample, or FM-1 synth from the Browser and drop it onto the Mixer strip area | Mixer strip area highlights with a dashed outline while dragging; dropping appends a new playable `$name:` strip at the bottom of the song |
| 5 | Banked sound insert/drop (`#3b`) | In `Drums > RolandTR909`, insert and drag `sd` both onto a blank line and inside an existing `s("bd ")` string (with and without `.bank("RolandTR808")`) | Blank line emits `s("sd").bank("RolandTR909")` (or full `$snare:` line on drag); inside `s("bd ")` inserts `sd` and adds or updates `.bank("RolandTR909")` in one undo step |

## Mixer and Editor

| # | Area | Do this | Should happen |
|---|---|---|---|
| 5 | Unnamed synth strip naming | Add `$: note("c2 eb2 g2 bb2").s("vibefm1:obervave")` (no `$name:` label) to a song and check the Mixer | Strip is named `obervave` (picked from the synth/instrument) instead of `note("...")` |
| 6 | Editor M / S / C line actions (Strudel and native) | Open `demo.strudel` in the Strudel editor, then switch to the native VS Code editor (`Ctrl+Alt+M`), and test `M`, `S`, and `C` in both | Both editors show the same three aligned `M`, `S`, `C` badges (no old rotary knob icon); in Strudel click `M`/`S`/`C` directly; in native VS Code hover the `M`/`S`/`C` badges for clickable action links or right-click the line number; active colors match (blue M, yellow S, green C mapped, red C listening) |

## Unified Plugins > FM-1 Synths and Repositories

| # | Area | Do this | Should happen |
|---|---|---|---|
| 7 | Unified category, centered preloaded screens, and badges | Open `Library > Plugins > FM-1 Synths` | One unified `FM-1 Synths` category divided into **Installed** and **Available**; screen thumbnails are centered horizontally in every row and Details, and pre-load automatically (including Hub `.fwsc` synths and SHRUB) even before downloading the firmware; rows carry `WASM`, `FWSC`, `EXT`, `MIDI` badges and `Runtime/...` + `Repo/...` chips |
| 8 | Popover, repositories, and batch download | Click `?` on `Plugins` or `FM-1 Synths`, click `+` to open Manage Repositories, and inspect the `Download all (N)` button in the result bar (also try filtering by a chip first) | Popover explains technologies; Manage Repositories lists built-in and custom repos; `Download all (N)` downloads and installs all visible available firmwares in batch with a cancellable progress notification |
| 9 | SHRUB direct download (WASM and FWSC) and regular synth behavior | Check Settings for `shrub`, open Devices, and inspect `SHRUB (WASM)`, `SHRUB` (`FWSC`), and `SHRUB (FM-1 Hardware MIDI)` in `Plugins > FM-1 Synths` | No experimental SHRUB setting and no custom SHRUB panel in Devices; `SHRUB (WASM)` has green `WASM` badge, previews on single click, downloads `shrub_sim.wasm` directly from `shrub.audio` without a browser into `firmware/shrub-wasm/`, plays smoothly as `s("vibefm1:shrub-wasm")` (~1% CPU), and shows its live screen + Master/Cutoff/Macro sliders in Devices; `SHRUB` (`FWSC`) downloads `SHRUB.fwsc` directly without a browser |
| 10 | SHRUB Hardware MIDI drag | Drag `SHRUB (FM-1 Hardware MIDI)` into a song (editor or Mixer) | Inserts `midimaps({ 'shrub-midi': { cutoff: 74, macro1: 16, macro2: 17, macro3: 18, macro4: 19 } })` at the top once, plus `$shrub_midi: note("c2 eb2 g2 bb2").midi('<port>').midimap('shrub-midi').gain(slider(...))` |
| 11 | In-editor `.fwsc` audio stability, overload guard, and cleanup | Play `demo.strudel`, add an `.fwsc` line (try both a light synth like `felucca` and a heavy one like `shrub`), evaluate, then remove the line and re-evaluate | Strudel's other tracks keep playing without getting permanently muted; heavy `.fwsc` synths trip the real-time overload guard cleanly (logging a Run Native hint) instead of stalling the audio thread; removing the `fm1:` line disposes the worklet immediately |
| 12 | Native `fm1-live` download and launch | Click `Run Native` on `SHRUB` or any `.fwsc` synth on Windows (and macOS/Linux if available) | Downloads `fm1-emu-0.5.1-windows-x86_64.zip`, extracts `fm1-live.exe` cleanly (handling backslash zip paths), downloads `SHRUB.fwsc` automatically if not installed, and launches `fm1-live` |

## Experimental FM-1 Hardware Flashing (Use at Your Own Risk)

| # | Area | Do this | Should happen |
|---|---|---|---|
| 13 | Gated off by default | Check a `.fwsc` row in `Plugins > FM-1 Synths` (Details and context menu) and the Command Palette before changing settings | `Flash to FM-1...` button, context menu entry, and `strdltn: Flash .fwsc firmware to M-VAVE FM-1 hardware...` command are hidden while `strdltn.experimental.fm1Flash` is `false` (default) |
| 14 | Enable and flash (optional, requires M-VAVE FM-1 hardware) | Enable `strdltn.experimental.fm1Flash` in Settings, select an `.fwsc` synth, and click `Flash to FM-1...` | Action appears immediately without reload; pauses Strudel MIDI bridge, probes connected FM-1 identity, verifies model compatibility, asks for explicit confirmation, shows live SysEx progress, and resumes MIDI bridge afterward |

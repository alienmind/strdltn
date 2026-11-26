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

## Mixer and Editor

| # | Area | Do this | Should happen |
|---|---|---|---|
| 5 | Unnamed synth strip naming | Add `$: note("c2 eb2 g2 bb2").s("vibefm1:obervave")` (no `$name:` label) to a song and check the Mixer | Strip is named `obervave` (picked from the synth/instrument) instead of `note("...")` |
| 6 | Editor M / S / C line actions (Strudel and native) | Open `demo.strudel` in the Strudel editor, then switch to the native VS Code editor (`Ctrl+Alt+M`), and test `M`, `S`, and `C` in both | Both editors show the same three aligned `M`, `S`, `C` badges (no old rotary knob icon); in Strudel click `M`/`S`/`C` directly; in native VS Code hover the `M`/`S`/`C` badges for clickable action links or right-click the line number; active colors match (blue M, yellow S, green C mapped, red C listening) |

## Unified Plugins > FM-1 Synths and Repositories

| # | Area | Do this | Should happen |
|---|---|---|---|
| 7 | Unified category and badges | Open `Library > Plugins > FM-1 Synths` | One unified `FM-1 Synths` category divided into **Installed** and **Available** only; rows carry technology badges (`WASM`, `FWSC`, `EXT`, `MIDI`) and filter via `Runtime/...` and `Repo/...` tag chips |
| 8 | Popover and repositories | Click `?` on `Plugins` or `FM-1 Synths`, then click `+` (or run `strdltn: Manage FM-1 firmware repositories...`) | Popover explains `WASM`, `FWSC`, `MIDI`, `Run Native`, and repositories; Manage Repositories shows built-in repos (`The Firmware Hub`, `shrub.audio`) and lets you add/remove a custom repository URL |
| 9 | SHRUB as a regular synth | Check Settings for `shrub`, open the Devices panel, and select `SHRUB` in `Plugins > FM-1 Synths` | No experimental SHRUB setting and no custom SHRUB panel in Devices; `SHRUB` appears in `Available` (external `shrub.audio` repo, `EXT` badge, opens `https://shrub.audio/`) and `Installed` (`SHRUB (FM-1 Hardware MIDI)`, `MIDI` badge, Details show CC 74 / CC 16-19 and `Editor...` opens `https://shrub.audio/editor/` in the external browser) |
| 10 | SHRUB Hardware MIDI drag | Drag `SHRUB (FM-1 Hardware MIDI)` into a song (editor or Mixer) | Inserts `midimaps({ 'shrub': { cutoff: 74, macro1: 16, macro2: 17, macro3: 18, macro4: 19 } })` at the top once, plus `$shrub: note("c2 eb2 g2 bb2").midi('<port>').midimap('shrub').gain(slider(...))` |
| 11 | In-editor `.fwsc` preview and install | Filter `Available` by `Runtime/FM-1 Emulated`, single-click an `.fwsc` synth (e.g. Felucca), then double-click or drag it into a song and play | Preview downloads `fm1_web.wasm` once + `.fwsc`, plays 1 loop with fade-out; install verifies SHA-256, saves to `firmware/<id>/`, moves it to `Installed`, inserts `s("fm1:<id>")`, and plays in time |
| 12 | Local `.fwsc` and Run Native | Drop a local `.fwsc` (e.g. `SHRUB-V1.11.fwsc`) into `template/firmware/shrub-local/`, select it, and click `Run Native` | Appears under `Installed` with `FWSC` badge without restarting VS Code; `Run Native` launches `fm1-live` cleanly |

## Experimental FM-1 Hardware Flashing (Use at Your Own Risk)

| # | Area | Do this | Should happen |
|---|---|---|---|
| 13 | Gated off by default | Check a `.fwsc` row in `Plugins > FM-1 Synths` (Details and context menu) and the Command Palette before changing settings | `Flash to FM-1...` button, context menu entry, and `strdltn: Flash .fwsc firmware to M-VAVE FM-1 hardware...` command are hidden while `strdltn.experimental.fm1Flash` is `false` (default) |
| 14 | Enable and flash (optional, requires M-VAVE FM-1 hardware) | Enable `strdltn.experimental.fm1Flash` in Settings, select an `.fwsc` synth, and click `Flash to FM-1...` | Action appears immediately without reload; pauses Strudel MIDI bridge, probes connected FM-1 identity, verifies model compatibility, asks for explicit confirmation, shows live SysEx progress, and resumes MIDI bridge afterward |

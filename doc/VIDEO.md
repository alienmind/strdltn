# Promo video

How to make a promo video of [str]dltn Live[code]: a walkthrough of the features, captured from a real VS Code
window, with zooms, captions, a voice-over, and a song of ours as the music. The recipe was ported on 2026-11-21
from the one the maintainer used for MuseColor (`../musicapp/doc/VIDEO.md`, project in `../musicapp/video/`).

Status (2026-11-21): a first cut renders end to end, about 36 s: five captured scenes and an end card with the
GitHub address, a Piper voice, and `demo.strudel` from its drop under all of it, ducked under the voice. The
draft and the final are in `tmp/promo/out/`. The final is an asset of the release v0.3.0:
`https://github.com/alienmind/strdltn/releases/download/v0.3.0/strdltn-promo.mp4`. GitHub serves it as a download,
not as a video that plays in place, so for a post the file is uploaded to the site itself.

Status (2026-11-22): not recorded again. The script is draft 2: the maintainer found the narration robotic (the
sentences, not the voice), so every line was rewritten as speech, and a scene for MIDI knobs was added
(`03b-knobs`). A second, longer video is planned: the walkthrough, about 12 minutes, in `video/walkthrough.md`,
written so the maintainer can record the voice himself. See "Walkthrough". The capture driver
(`video/scripts/driver.cjs`) has no step for `03b-knobs` yet: it needs a MIDI controller, or the knob's states shown
through the extension's API, as the other scenes are.

## Tools

| Piece | Tool | Notes |
|---|---|---|
| Script and timing | `video/script.json`, one block per scene | The script drives everything else |
| Voice-over | Piper (free, offline) for the draft; the final engine decided after hearing it | One audio file per scene, so a scene can be redone alone |
| Screen capture | The VS Code window driven through the Chrome DevTools Protocol, as `scripts/test-vscode.mjs` does | Repeatable. Run it again when the UI changes |
| Composition | Remotion (video written as React components) | Zooms, captions, transitions, audio mix. It ships its own ffmpeg |
| Music | A song of ours, played by strdltn itself | No licence to clear. See "Sound" |

Nothing here needs a paid service.

## Layout

As in MuseColor: a `video/` folder with its own `package.json` (not part of the extension build, the typecheck or
the tests), and every generated file under `tmp/promo/`, which git ignores.

| In git | What |
|---|---|
| `video/script.json` | The scenes: the line, what the screen shows, what the camera zooms on |
| `video/video.config.json` | Voice, size, fps, the song and the workspace the capture opens |
| `video/scripts/` | Voice generation and the capture |
| `video/src/` | The Remotion composition, camera moves in `src/camera.ts` |

| Step | Command (from `video/`) | Writes |
|---|---|---|
| Voice | `pnpm voice` (needs `pip install piper-tts`) | `tmp/promo/voice/<voice>/<scene>.wav`, `durations.json` |
| Capture | `pnpm capture`, or `pnpm capture 05-devices` for one scene | `tmp/promo/captures/<scene>/*.jpg`, `manifest.json` |
| Song | `pnpm capture song` (part of `pnpm capture`) | `tmp/promo/song/demo.wav` |
| Preview | `pnpm studio` | |
| Draft | `pnpm render:draft` | `tmp/promo/out/promo-draft.mp4` (960x540) |
| Final | `pnpm render` | `tmp/promo/out/promo.mp4` (1920x1080) |

## Recipe

In this order. Each step fixes the input of the next.

1. **Write the script.** One scene per feature: the voice line (under 20 words, 140 to 150 words a minute), what
   the screen shows, what the camera zooms on. Write the line as someone talking, see "Narration".
2. **Generate the voice.** One file per scene. Listen, rewrite what sounds awkward, regenerate only that.
3. **Measure the audio.** The length of each voice file sets the length of its scene, plus about 0.7 s.
4. **Capture.** One capture per scene, sized to the measured length.
5. **Compose.** Captures on the timeline, zoom keyframes, captions, transitions; mix voice and song.
6. **Review a draft** at half size. Fix timing and wording before the final.
7. **Render the final.** Horizontal master first; a vertical cut from the same composition later.

## Capture

The capture differs from MuseColor's: the subject is a VS Code window, not a web page in Chrome. What we already
have in `scripts/test-vscode.mjs` covers most of it:

- A throwaway VS Code with its own profile, the extension from `dist/`, the workspace of the scene (`template/`, or a
  copy set up for the video). Settings for a clean window: no welcome tab, no chat, a fixed zoom level, one theme.
- The window size set through DevTools (`Browser.setWindowBounds`). Capture at 1920x1080 or larger, so a zoom up
  to about 1.5x stays sharp.
- Real input through DevTools (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`): clicks, typing in the Strudel
  editor, a fader dragged. The test already types into the editor this way.
- The audio overlay clicked with `Runtime.evaluate` and `userGesture: true`, as the test does.
- Record frames, not a video file. `video/scripts/capture.mjs` listens to Chrome's screencast events
  (`Page.startScreencast`) on the VS Code window's target, saves every repaint as a JPEG with its time, and lays
  them on a 30 fps grid, as MuseColor does. Measured: it works, webviews included, about 60 repaints a second while a
  song plays.
- The scenes are set up by `video/scripts/driver.cjs`, which runs inside the capture's VS Code
  (`extensionTestsPath`) and talks to the runner through files. It reverts and closes every song it opened, so the
  template is not written.
- The window asks for 1920x1080, but the screen limits it: on the maintainer's PC the frames are 1440x900 (16:10).
  The composition scales them to cover 16:9 and crops a little top and bottom; zooms stay under 2.1x.
- No mouse pointer shows in a capture. The first cut needs none: every action goes through the extension's API
  (`browserShow`, `mixerShow`, `mixerSlider`, `mixerReveal`). A later cut with clicks wants MuseColor's fake cursor.
- Wait for the samples and the firmware to load before the first frame. A scene that opens on a loading state is
  unusable.

## Sound

The music is our own: `demo.strudel`, recorded from the engine. The engine's test hook has `record`
(`src/webview/main.ts`): a `ScriptProcessorNode` on superdough's `destinationGain`, the node in front of the
speakers, collects the whole mix, firmwares included, and nothing else of the machine. The window is muted
(`--mute-audio`); the graph still runs. The capture records the whole song (`songSeconds`) once, with nothing else
going on, and pulls the WAV through DevTools in 1 MB base64 chunks. The composition starts it at `songStart`
(90.2 s, the DROP).

Measured on 2026-11-21: the demo's mix peaks at 2.59 times full scale (+8.3 dB). The speakers clip that; the
recorder scales the take so its peak sits at 0.95 before it writes 16 bits, and says the peak it found. The song's
levels came down on 2026-11-21: `.duck("2,3,4,5")` played the kick four times (now `"2:3:4:5"`, see "Mixer" in
`doc/ARCHITECTURE.md`), and every fader went to 0.62 of its value. Two takes then peaked at 0.78 and 0.81.

Under the voice the song steps down, as MuseColor's music does: its volume is a function of time, 0.8 in the open
and 0.22 under the voice, with 0.25 s ramps. That is the sidechain, done without audio analysis.

## Narration

The maintainer found draft 1 robotic: every line was a feature list squeezed into one sentence ("Faders and
sidechain cables write themselves back as code"). Rules for the lines, the promo's and the walkthrough's:

- Write it as you would say it to a friend looking at your screen: "you", "I", "we", contractions.
- One idea per sentence. Show the thing, then say what it means to the listener.
- A question or a small surprise opens a scene better than a statement ("Got a MIDI controller?").
- No word that only the docs use: "chain" is "part", "orbit" is left out, "evaluate" is "play".
- Read it aloud before generating the voice. If it trips you, rewrite it.

## Walkthrough

A second video, about 12 minutes, chapter by chapter: hello, a first sound, the Strudel editor, the two editors,
the Library, the Mixer, MIDI knobs, MIDI out, synth firmwares, recording, files. The script is
`video/walkthrough.md`: per chapter the screen actions and the narration, with pauses for the music. It is made
the same way as the promo (one voice file per chapter, the capture sized to it), and the maintainer may record the
voice himself instead of a text-to-speech voice. Planned, not made. The capture driver needs a step per chapter;
the promo's steps cover chapters 1, 5, 6 and 9 already.

## Scenes

A first outline, about 60 s. Every scene shows something that works today.

| # | Scene | Screen | Zoom on |
|---|---|---|---|
| 1 | Hook | `demo.strudel` playing in the Strudel editor, the code lighting up as it plays | The lit notes in the code |
| 2 | Live edit | A number typed in the code; the sound changes without a stop | The changed number |
| 3 | Browser | A search in the Library, a sound previewed, inserted as code | The result row, then the inserted line |
| 4 | Mixer | Faders moved, a part muted and soloed, a duck cable dragged, the pump meters | A fader and the number it writes in the code |
| 4b | Knobs | A knob button red, then green; a knob turned, the slider and the fader following | The knob column beside the code |
| 5 | Devices | OBERVAVE playing, its own screen and knobs in the Devices tab, F3 and F4 change its sound | The firmware's screen |
| 6 | Visuals | The stage with Hydra beside the code | The visuals |
| 7 | Outside edits | An AI agent or git changes the song while it plays, and the sound follows | The edit landing in the code |
| 8 | Close | Logo, `github.com/alienmind/strdltn`, "Runs in VS Code and Codespaces" | None |

## Licences

- **Our song.** `template/demo.strudel` is the maintainer's own song. Its samples come from packs with their own
  licences: check those the song uses before publishing.
- **Firmware.** OBERVAVE is GPL-3.0 (zvenson). Showing it running is fine; credit it in the description.
- **Voice.** Each text-to-speech voice has its own terms. Check the exact voice for commercial use.
- **Remotion.** Free for individuals and small teams. Companies above a size limit need a paid licence.
- **VS Code.** The window is VS Code's. Showing it in a video is common practice; we use no Microsoft logo of our own.

## Decisions for the first cut

| Topic | Decision | Why |
|---|---|---|
| Voice | Piper `en_US-ryan-high`, the model MuseColor downloaded (`voiceModels` in the config) | Free and offline. The final engine is the maintainer's choice |
| Name | Not spoken; on the end card only | How "[str]dltn" is pronounced is the maintainer's to say |
| Song | `demo.strudel` from its DROP | The maintainer's own song, and the energy is there |
| Scenes | Hook, Browser, Mixer, Devices (OBERVAVE from the VIBE FM SDK), files, end card | The features of the README, and the firmwares |
| End card | Logo, "A live coding DAW for Strudel, in VS Code", `github.com/alienmind/strdltn`, the not-official note and the credits | The URL last, as asked |
| Headless Chrome for Remotion | Copied from MuseColor's `node_modules/.remotion` | Its download host did not answer on 2026-11-21 |

## Open points

- Watch the cut and fix timing, camera moves and wording.
- Record the voice of draft 2 and capture `03b-knobs`.
- The walkthrough: voice, capture steps per chapter, composition.
- The demo's levels (it clips by 8.3 dB), then record the song again.
- Final voice engine, and its terms for commercial use.
- A vertical cut.
- Whether to show a Codespace in the browser too.

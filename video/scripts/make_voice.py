"""One WAV per scene with Piper, and their durations. Ported from MuseColor's video/scripts/make_voice.py.

    pip install piper-tts
    python -I scripts/make_voice.py            (voice from video.config.json)
    python -I scripts/make_voice.py en_US-lessac-high

The voice model is looked for in tmp/promo/voices/, then in `voiceModels` of the config (the
models MuseColor already downloaded), and downloaded into tmp/promo/voices/ if neither has it.
Output: tmp/promo/voice/<voice>/<scene>.wav and durations.json.
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

video = Path(__file__).resolve().parents[1]
assets = video.parent / "tmp" / "promo"
config = json.loads((video / "video.config.json").read_text(encoding="utf-8"))
voice = sys.argv[1] if len(sys.argv) > 1 else config["voice"]
models = assets / "voices"
models.mkdir(parents=True, exist_ok=True)
model = models / f"{voice}.onnx"
if not model.exists() and config.get("voiceModels"):
    shared = (video / config["voiceModels"] / f"{voice}.onnx").resolve()
    if shared.exists():
        model = shared
if not model.exists():
    subprocess.run([sys.executable, "-m", "piper.download_voices", "--download-dir", str(models), voice], check=True)

out = assets / "voice" / voice
out.mkdir(parents=True, exist_ok=True)
scenes = json.loads((video / "script.json").read_text(encoding="utf-8"))["scenes"]
total = 0.0
durations = {}
for s in scenes:
    wav = out / f"{s['id']}.wav"
    subprocess.run(
        [sys.executable, "-m", "piper", "-m", str(model), "-f", str(wav), "--sentence-silence", "0.35"],
        input=s["voice"].encode("utf-8"), check=True, capture_output=True,
    )
    with wave.open(str(wav)) as w:
        d = w.getnframes() / w.getframerate()
    durations[s["id"]] = round(d, 2)
    total += d
    print(f"{s['id']:16s} {d:5.2f} s")
(out / "durations.json").write_text(json.dumps(durations, indent=2), encoding="utf-8")
print(f"total voice {total:.1f} s")

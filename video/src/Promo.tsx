// The promo, ported from MuseColor's video/src/Promo.tsx: the captures with camera moves and captions, the voice per
// scene, and the demo song under all of it, stepping back while the voice speaks (doc/VIDEO.md).
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import config from '../video.config.json';
import { cameraAt } from './camera';

export interface SceneData {
  id: string;
  text: string;
  /** First frame of the scene on the timeline. */
  from: number;
  frames: number;
  voiceSeconds: number;
  /** Capture file per frame, or null for a scene with no capture (the end card). */
  images: string[] | null;
}

// A type alias, not an interface: Remotion wants props assignable to Record<string, unknown>.
export type PromoProps = {
  scenes: SceneData[];
};

const VOICE_DELAY = 0.3; // seconds of picture before the line starts
// The song's level: up in the open and on the end card, down under the voice. A sidechain without analysis: the
// composition knows when each line starts and ends, so the volume is a function of time with 0.25 s ramps.
const MUSIC = { open: 0.8, underVoice: 0.22 };
const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
const ACCENT = '#48C4F4';
// The captures are the whole VS Code window at 1440x900 (16:10). They are scaled to cover 16:9.
const CAPTURE = { w: 1440, h: 900 };

const Capture = ({ scene }: { scene: SceneData }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const file = scene.images?.[Math.min(frame, scene.frames - 1)];
  const cam = cameraAt(scene.id, frame / Math.max(1, scene.frames - 1));
  const fadeIn = interpolate(frame, [0, 7], [0, 1], { extrapolateRight: 'clamp' });
  // Cover: the image is as wide as the video and taller; the camera works in the image's own 0 to 1 space.
  const w = width;
  const h = (width * CAPTURE.h) / CAPTURE.w;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a', opacity: fadeIn, overflow: 'hidden' }}>
      {file ? (
        <Img
          src={staticFile(`captures/${scene.id}/${file}`)}
          style={{
            width: w,
            height: h,
            transformOrigin: '0 0',
            transform: `translate(${width / 2 - cam.cx * w * cam.s}px, ${height / 2 - cam.cy * h * cam.s}px) scale(${cam.s})`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const Caption = ({ scene }: { scene: SceneData }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // One sentence on screen at a time, each for a share of the line proportional to its length.
  const parts = scene.text.match(/[^.?!]+[.?!]+/g)?.map((p) => p.trim()) ?? [scene.text];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const t = (frame / fps - VOICE_DELAY) / scene.voiceSeconds;
  let acc = 0;
  let current = parts[parts.length - 1];
  let start = 0;
  for (const part of parts) {
    const share = part.length / total;
    if (t < acc + share) {
      current = part;
      start = acc;
      break;
    }
    acc += share;
    start = acc;
  }
  const local = (t - start) * scene.voiceSeconds * fps;
  const appear = interpolate(local, [0, 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (t < 0) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 70 }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 46,
          fontWeight: 600,
          color: '#fff',
          background: 'rgba(8, 10, 14, 0.8)',
          padding: '16px 34px',
          borderRadius: 18,
          maxWidth: 1500,
          textAlign: 'center',
          lineHeight: 1.25,
          opacity: appear,
          transform: `translateY(${(1 - appear) * 14}px)`,
          boxShadow: '0 10px 40px rgba(0,0,0,.45)',
        }}
      >
        {current}
      </div>
    </AbsoluteFill>
  );
};

const EndCard = ({ scene }: { scene: SceneData }) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const url = interpolate(frame, [18, 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [scene.frames - 15, scene.frames], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at 50% 40%, #16233a 0%, #0a0a0a 70%)',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT,
        color: '#fff',
        opacity: fadeOut,
      }}
    >
      <Img src={staticFile('logo.jpg')} style={{ width: 900, borderRadius: 18, opacity: rise, transform: `scale(${0.94 + 0.06 * rise})` }} />
      <div style={{ fontSize: 44, fontWeight: 500, marginTop: 28, opacity: rise }}>A live coding DAW for Strudel, in VS Code</div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          marginTop: 40,
          color: ACCENT,
          opacity: url,
          transform: `translateY(${(1 - url) * 12}px)`,
          fontFamily: 'Consolas, "Cascadia Code", monospace',
        }}
      >
        {config.url}
      </div>
      <div style={{ position: 'absolute', bottom: 30, fontSize: 19, opacity: 0.5, textAlign: 'center', lineHeight: 1.5 }}>
        Free and open source, AGPL-3.0. Not an official Strudel project, not endorsed by its authors.
        <br />
        Music: Sea of Souls (club mix) by AlienMind, CC BY-NC-SA 4.0. Firmware: OBERVAVE by zvenson, GPL-3.0.
      </div>
    </AbsoluteFill>
  );
};

export const Promo = ({ scenes }: PromoProps) => {
  const { fps, durationInFrames } = useVideoConfig();

  const voiceWindows = scenes.map((s) => [s.from / fps + VOICE_DELAY, s.from / fps + VOICE_DELAY + s.voiceSeconds] as const);
  const ramp = 0.25;
  const duck = (t: number, [a, b]: readonly [number, number]) =>
    Math.min(1, Math.max(0, Math.min((t - (a - ramp)) / ramp, (b + ramp - t) / ramp)));
  const musicVolume = (frame: number) => {
    const t = frame / fps;
    const underVoice = Math.max(0, ...voiceWindows.map((w) => duck(t, w)));
    const v = MUSIC.open + (MUSIC.underVoice - MUSIC.open) * underVoice;
    const fade = Math.min(1, t / 0.8, (durationInFrames / fps - t) / 1.5);
    return Math.max(0, v * fade);
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
      {scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames}>
          {scene.images ? <Capture scene={scene} /> : <EndCard scene={scene} />}
          {scene.images ? <Caption scene={scene} /> : null}
          <Sequence from={Math.round(VOICE_DELAY * fps)}>
            <Audio src={staticFile(`voice/${config.voice}/${scene.id}.wav`)} />
          </Sequence>
        </Sequence>
      ))}
      <Audio src={staticFile(`song/${config.song.replace(/\.strudel$/, '.wav')}`)} startFrom={Math.round(config.songStart * fps)} volume={musicVolume} />
    </AbsoluteFill>
  );
};

import { Composition, staticFile } from 'remotion';
import config from '../video.config.json';
import script from '../script.json';
import { Promo, type PromoProps, type SceneData } from './Promo';

const CLOSE_AIR = 2.4; // seconds the end card stays after its line

async function json<T>(path: string): Promise<T> {
  const res = await fetch(staticFile(path));
  if (!res.ok) throw new Error(`Missing asset ${path}: run the voice and capture steps first`);
  return (await res.json()) as T;
}

export const Root = () => (
  <Composition
    id="Promo"
    component={Promo}
    fps={config.fps}
    width={config.width}
    height={config.height}
    durationInFrames={config.fps * 45}
    defaultProps={{ scenes: [] } satisfies PromoProps}
    calculateMetadata={async () => {
      const captures = await json<Record<string, { seconds: number; frames: string[] }>>('captures/manifest.json');
      const voice = await json<Record<string, number>>(`voice/${config.voice}/durations.json`);
      let from = 0;
      const scenes: SceneData[] = script.scenes.map((s) => {
        const capture = captures[s.id];
        const voiceSeconds = voice[s.id] ?? 0;
        const frames = capture ? capture.frames.length : Math.round((voiceSeconds + CLOSE_AIR) * config.fps);
        const scene: SceneData = { id: s.id, text: s.voice, from, frames, voiceSeconds, images: capture?.frames ?? null };
        from += frames;
        return scene;
      });
      return { durationInFrames: from, props: { scenes } };
    }}
  />
);

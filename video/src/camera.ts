// Camera moves per scene, ported from MuseColor. `at` is the position in the scene (0 to 1). `cx`, `cy` is the point
// of the capture that sits at the center of the screen (0 to 1), `s` is the zoom. The capture is the whole VS Code
// window: the side bar is the left 24%, the editor above 64% of the height, the bottom panel below.

export interface Key {
  at: number;
  cx: number;
  cy: number;
  s: number;
}

export const CAMERA: Record<string, Key[]> = {
  '01-hook': [
    { at: 0, cx: 0.5, cy: 0.5, s: 1.0 },
    { at: 0.4, cx: 0.5, cy: 0.5, s: 1.0 },
    { at: 1, cx: 0.6, cy: 0.36, s: 1.45 },
  ],
  '02-browser': [
    { at: 0, cx: 0.3, cy: 0.5, s: 1.15 },
    { at: 0.25, cx: 0.2, cy: 0.5, s: 1.6 },
    { at: 1, cx: 0.2, cy: 0.55, s: 1.7 },
  ],
  '03-mixer': [
    { at: 0, cx: 0.6, cy: 0.6, s: 1.2 },
    { at: 0.3, cx: 0.55, cy: 0.8, s: 1.6 },
    { at: 1, cx: 0.6, cy: 0.8, s: 1.75 },
  ],
  '04-devices': [
    { at: 0, cx: 0.6, cy: 0.6, s: 1.15 },
    { at: 0.3, cx: 0.4, cy: 0.82, s: 1.9 },
    { at: 1, cx: 0.38, cy: 0.82, s: 2.1 },
  ],
  '05-files': [
    { at: 0, cx: 0.4, cy: 0.5, s: 1.15 },
    { at: 1, cx: 0.2, cy: 0.4, s: 1.6 },
  ],
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Camera at position `p` (0 to 1) of a scene: eased between the two nearest keys. */
export function cameraAt(id: string, p: number): Key {
  const keys = CAMERA[id] ?? [{ at: 0, cx: 0.5, cy: 0.5, s: 1 }];
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (p >= keys[i].at && p <= keys[i + 1].at) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const span = b.at - a.at;
  const t = span > 0 ? ease(Math.min(1, Math.max(0, (p - a.at) / span))) : 0;
  const s = a.s + (b.s - a.s) * t;
  // Keep the frame covered: the center cannot go closer to an edge than half a screen.
  const clamp = (v: number) => Math.min(1 - 0.5 / s, Math.max(0.5 / s, v));
  return { at: p, cx: clamp(a.cx + (b.cx - a.cx) * t), cy: clamp(a.cy + (b.cy - a.cy) * t), s };
}

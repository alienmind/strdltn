// The showcase: one take of demo.strudel played from start to end in VS Code (video/scripts/showcase.mjs), with
// its own sound, a drawn cursor for the clicks, and the camera easing between the parts of the window the take
// asked to show. No voice and no captions: the song is the soundtrack (tmp/RECORDING.md).
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export type Rect = { x: number; y: number; w: number; h: number };
export type ShowcaseProps = {
  frames: string[];
  fps: number;
  audioOffset: number;
  window: { w: number; h: number };
  cursor: { t: number; x: number; y: number; kind: 'from' | 'to' | 'click' | 'double' }[];
  zoom: { t: number; rect: Rect | null }[];
};

/** Seconds a camera move takes, eased in and out. */
const MOVE = 1.6;
/** The most the camera zooms in: past it the 1080p frames get soft. */
const MAX_ZOOM = 1.6;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Where the camera looks for a wish: the centre and the scale that fit the rectangle, inside the window. */
function framing(rect: Rect | null, win: { w: number; h: number }) {
  if (!rect) return { cx: win.w / 2, cy: win.h / 2, s: 1 };
  const s = Math.max(1, Math.min(MAX_ZOOM, 0.92 * Math.min(win.w / rect.w, win.h / rect.h)));
  const halfW = win.w / s / 2;
  const halfH = win.h / s / 2;
  const cx = Math.min(win.w - halfW, Math.max(halfW, rect.x + rect.w / 2));
  const cy = Math.min(win.h - halfH, Math.max(halfH, rect.y + rect.h / 2));
  return { cx, cy, s };
}

function cameraAt(t: number, zoom: ShowcaseProps['zoom'], win: ShowcaseProps['window']) {
  let i = -1;
  for (let k = 0; k < zoom.length; k++) if (zoom[k].t <= t) i = k;
  const to = framing(i >= 0 ? zoom[i].rect : null, win);
  if (i < 0) return to;
  const from = framing(i > 0 ? zoom[i - 1].rect : null, win);
  const p = ease(Math.min(1, (t - zoom[i].t) / MOVE));
  return { cx: from.cx + (to.cx - from.cx) * p, cy: from.cy + (to.cy - from.cy) * p, s: from.s + (to.s - from.s) * p };
}

/** The cursor: it glides along each logged move and pulses on a click; it fades out when nothing happens. */
function cursorAt(t: number, log: ShowcaseProps['cursor']) {
  if (!log.length || t < log[0].t - 0.3) return null;
  let x = log[0].x;
  let y = log[0].y;
  let last = log[0].t;
  let click = -Infinity;
  for (let k = 0; k < log.length; k++) {
    const e = log[k];
    if (e.t > t) {
      // Inside a move: between its `from` and its `to`.
      const prev = log[k - 1];
      if (prev && prev.kind === 'from' && e.kind === 'to') {
        const p = ease((t - prev.t) / (e.t - prev.t));
        x = prev.x + (e.x - prev.x) * p;
        y = prev.y + (e.y - prev.y) * p;
        last = t;
      }
      break;
    }
    x = e.x;
    y = e.y;
    last = e.t;
    if (e.kind === 'click' || e.kind === 'double') click = e.t;
  }
  const opacity = interpolate(t - last, [1.5, 2.2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return { x, y, opacity, pulse: t - click };
}

export const Showcase = (props: ShowcaseProps) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const file = props.frames[Math.min(frame, props.frames.length - 1)];
  const cam = cameraAt(t, props.zoom, props.window);
  const k = width / props.window.w;
  const cursor = cursorAt(t, props.cursor);
  const fade = interpolate(frame, [0, 10, durationInFrames - 25, durationInFrames - 1], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // The window's point (cx, cy) at the centre of the video, scaled by s.
  const transform = `translate(${width / 2 - cam.cx * cam.s * k}px, ${height / 2 - cam.cy * cam.s * k}px) scale(${cam.s})`;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden', opacity: fade }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width, height: (props.window.h * width) / props.window.w, transformOrigin: '0 0', transform }}>
        {file ? <Img src={staticFile(`frames/${file}`)} style={{ width: '100%', height: '100%' }} /> : null}
        {cursor && cursor.opacity > 0 ? (
          <div style={{ position: 'absolute', left: cursor.x * k, top: cursor.y * k, opacity: cursor.opacity }}>
            {cursor.pulse >= 0 && cursor.pulse < 0.45 ? (
              <div
                style={{
                  position: 'absolute',
                  left: -18,
                  top: -18,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '3px solid rgba(72, 196, 244, 0.9)',
                  transform: `scale(${0.4 + cursor.pulse * 2.2})`,
                  opacity: 1 - cursor.pulse / 0.45,
                }}
              />
            ) : null}
            <svg width="26" height="34" viewBox="0 0 13 17" style={{ position: 'absolute', left: -1, top: -1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}>
              <path d="M1 1v14l3.6-3.4 2.4 5.4 2.2-1-2.4-5.3H12z" fill="#fff" stroke="#000" strokeWidth=".9" strokeLinejoin="round" />
            </svg>
          </div>
        ) : null}
      </div>
      <Sequence from={Math.max(0, Math.round(props.audioOffset * fps))}>
        <Audio src={staticFile('song.wav')} />
      </Sequence>
    </AbsoluteFill>
  );
};

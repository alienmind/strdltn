// 40px zoomable waveform sparkline for the Browser Details pane: decodes the sample via the
// preview buffer cache, draws peak bars, animates the live playhead, and provides draggable
// `.begin()` / `.end()` trim handles plus 1-click trimmed code insertion.
import { currentSamplePlay, decodeSampleUrl, onSamplePlay, playPreview } from './preview.ts';

export interface TrimRange {
	begin: number;
	end: number;
}

export interface WaveformOptions {
	url: string;
	trim: TrimRange;
	onTrimChange: (next: TrimRange) => void;
	onInsertTrimmed: (trim: TrimRange) => void;
	onPlay: (trim: TrimRange) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

/** Computes `bins` peak amplitudes (0..1) over `[viewStart, viewEnd]` of an AudioBuffer. */
function samplePeaks(buffer: AudioBuffer, bins: number, viewStart: number, viewEnd: number): Float32Array {
	const out = new Float32Array(bins);
	const data = buffer.getChannelData(0);
	const total = data.length;
	if (!total || !bins) return out;
	const startIdx = Math.floor(viewStart * total);
	const endIdx = Math.max(startIdx + 1, Math.ceil(viewEnd * total));
	const span = endIdx - startIdx;
	for (let i = 0; i < bins; i++) {
		const a = startIdx + Math.floor((i * span) / bins);
		const b = Math.max(a + 1, startIdx + Math.floor(((i + 1) * span) / bins));
		let peak = 0;
		const step = Math.max(1, Math.floor((b - a) / 64));
		for (let j = a; j < b && j < total; j += step) {
			const v = Math.abs(data[j]);
			if (v > peak) peak = v;
		}
		out[i] = peak;
	}
	return out;
}

/** Formats trim values cleanly for Strudel `.begin(x).end(y)`. */
export function trimSuffix(trim: TrimRange): string {
	const b = Math.round(trim.begin * 100) / 100;
	const e = Math.round(trim.end * 100) / 100;
	let out = '';
	if (b > 0) out += `.begin(${b})`;
	if (e < 1) out += `.end(${e})`;
	return out;
}

/**
 * Mounts the 40px waveform widget into `container` and returns a cleanup callback (stops rAF & listener
 * when Details redraws for another row).
 */
export function mountWaveform(container: HTMLElement, options: WaveformOptions): () => void {
	const box = container.appendChild(el('div', 'waveform-box'));
	const meta = box.appendChild(el('div', 'waveform-meta'));
	const info = meta.appendChild(el('span', 'waveform-info', 'Loading waveform...'));
	const actions = meta.appendChild(el('span', 'waveform-actions'));
	const playBtn = actions.appendChild(el('button', 'chip', 'Play'));
	playBtn.title = 'Preview sample (respects trim handles)';
	const insertBtn = actions.appendChild(el('button', 'chip on', 'Insert trimmed'));
	insertBtn.title = 'Insert with .begin() / .end() at cursor';
	const resetBtn = actions.appendChild(el('button', 'chip', 'Reset'));
	resetBtn.title = 'Reset trim and zoom';

	const wrap = box.appendChild(el('div', 'waveform-wrap'));
	const canvas = wrap.appendChild(el('canvas', 'waveform'));
	canvas.title = 'Click to play. Drag handles for .begin() / .end(). Mouse wheel to zoom.';
	const handleL = wrap.appendChild(el('div', 'trim-handle left'));
	handleL.title = 'Drag to set .begin()';
	const handleR = wrap.appendChild(el('div', 'trim-handle right'));
	handleR.title = 'Drag to set .end()';

	let disposed = false;
	let buffer: AudioBuffer | undefined;
	let trim: TrimRange = { ...options.trim };
	let zoom = 1;
	let viewStart = 0;
	let raf = 0;

	const viewSpan = () => 1 / zoom;
	const viewEnd = () => Math.min(1, viewStart + viewSpan());
	const toFrac = (clientX: number) => {
		const rect = wrap.getBoundingClientRect();
		const rel = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
		return Math.max(0, Math.min(1, viewStart + rel * viewSpan()));
	};
	const toPct = (frac: number) => ((frac - viewStart) / viewSpan()) * 100;

	const updateMeta = () => {
		const trimmed = trim.begin > 0.005 || trim.end < 0.995;
		insertBtn.hidden = !trimmed;
		resetBtn.hidden = !trimmed && zoom <= 1.01;
		if (!buffer) return;
		const dur = `${buffer.duration < 10 ? buffer.duration.toFixed(2) : buffer.duration.toFixed(1)} s`;
		const rate = `${(buffer.sampleRate / 1000).toFixed(1).replace(/\.0$/, '')} kHz`;
		const suffix = trimSuffix(trim);
		const z = zoom > 1.05 ? ` - ${zoom.toFixed(1)}x` : '';
		info.textContent = `${dur} - ${rate}${suffix ? ` - ${suffix}` : ''}${z}`;
	};

	const positionHandles = () => {
		const lp = toPct(trim.begin);
		const rp = toPct(trim.end);
		handleL.style.left = `${lp}%`;
		handleR.style.left = `${rp}%`;
		handleL.hidden = lp < -2 || lp > 102;
		handleR.hidden = rp < -2 || rp > 102;
	};

	const render = () => {
		if (disposed || !canvas.isConnected) return;
		positionHandles();
		const dpr = devicePixelRatio;
		const width = (canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)));
		const height = (canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr)));
		const g = canvas.getContext('2d')!;
		g.clearRect(0, 0, width, height);
		const mid = height / 2;

		// Center hairline.
		g.fillStyle = 'rgba(128, 128, 128, 0.22)';
		g.fillRect(0, Math.round(mid), width, Math.max(1, Math.round(dpr)));

		if (!buffer) return;
		const barW = Math.max(1, Math.round(2 * dpr));
		const step = Math.max(2, Math.round(3 * dpr));
		const bins = Math.max(1, Math.floor(width / step));
		const vEnd = viewEnd();
		const peaks = samplePeaks(buffer, bins, viewStart, vEnd);
		const accent = getComputedStyle(box).getPropertyValue('--wf-accent').trim() || '#3794ff';

		// Dimmed overlays outside [trim.begin, trim.end].
		const xL = Math.max(0, Math.min(width, ((trim.begin - viewStart) / (vEnd - viewStart)) * width));
		const xR = Math.max(0, Math.min(width, ((trim.end - viewStart) / (vEnd - viewStart)) * width));
		g.fillStyle = 'rgba(0, 0, 0, 0.36)';
		if (xL > 0) g.fillRect(0, 0, xL, height);
		if (xR < width) g.fillRect(xR, 0, width - xR, height);

		for (let i = 0; i < bins; i++) {
			const x = i * step;
			const frac = viewStart + ((i + 0.5) / bins) * (vEnd - viewStart);
			const inside = frac >= trim.begin && frac <= trim.end;
			const amp = Math.max(1 * dpr, peaks[i] * (mid - 2 * dpr));
			g.fillStyle = inside ? accent : 'rgba(140, 150, 165, 0.38)';
			g.fillRect(x, mid - amp, barW, amp * 2);
		}

		// Live playhead while this sample URL is playing.
		const active = currentSamplePlay();
		if (active && active.url === options.url) {
			const elapsed = active.ctx.currentTime - active.startedAt;
			if (elapsed >= 0 && elapsed <= active.playDuration) {
				const frac = active.begin + (elapsed / active.playDuration) * (active.end - active.begin);
				if (frac >= viewStart && frac <= vEnd) {
					const px = ((frac - viewStart) / (vEnd - viewStart)) * width;
					g.fillStyle = '#ffffff';
					g.fillRect(Math.round(px), 0, Math.max(1, Math.round(1.5 * dpr)), height);
				}
				raf = requestAnimationFrame(render);
			}
		}
	};

	const startPlayhead = () => {
		cancelAnimationFrame(raf);
		const active = currentSamplePlay();
		if (active && active.url === options.url) raf = requestAnimationFrame(render);
	};

	const unsub = onSamplePlay((active) => {
		if (disposed) return;
		if (active?.url === options.url) startPlayhead();
		else render();
	});

	const dragHandle = (which: 'begin' | 'end', handle: HTMLElement) => {
		handle.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			handle.setPointerCapture(event.pointerId);
			handle.classList.add('dragging');
			const move = (e: PointerEvent) => {
				const f = toFrac(e.clientX);
				if (which === 'begin') trim = { begin: Math.max(0, Math.min(trim.end - 0.02, f)), end: trim.end };
				else trim = { begin: trim.begin, end: Math.min(1, Math.max(trim.begin + 0.02, f)) };
				options.onTrimChange({ ...trim });
				updateMeta();
				render();
			};
			const end = () => {
				handle.classList.remove('dragging');
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', end);
				handle.removeEventListener('pointercancel', end);
				// Audition trimmed slice on pointer release.
				void playPreview({ kind: 'sample', url: options.url, begin: trim.begin, end: trim.end }, () => undefined);
			};
			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', end);
			handle.addEventListener('pointercancel', end);
		});
	};
	dragHandle('begin', handleL);
	dragHandle('end', handleR);

	canvas.addEventListener('click', () => options.onPlay({ ...trim }));
	canvas.addEventListener(
		'wheel',
		(event) => {
			event.preventDefault();
			const anchor = toFrac(event.clientX);
			const factor = event.deltaY < 0 ? 1.35 : 1 / 1.35;
			zoom = Math.max(1, Math.min(8, zoom * factor));
			const span = viewSpan();
			const rel = (anchor - viewStart) / (1 / (zoom / factor));
			viewStart = Math.max(0, Math.min(1 - span, anchor - rel * span));
			updateMeta();
			render();
		},
		{ passive: false },
	);
	playBtn.addEventListener('click', () => options.onPlay({ ...trim }));
	insertBtn.addEventListener('click', () => options.onInsertTrimmed({ ...trim }));
	resetBtn.addEventListener('click', () => {
		trim = { begin: 0, end: 1 };
		zoom = 1;
		viewStart = 0;
		options.onTrimChange({ ...trim });
		updateMeta();
		render();
	});

	const ro = new ResizeObserver(() => render());
	ro.observe(wrap);

	updateMeta();
	void decodeSampleUrl(options.url)
		.then((decoded) => {
			if (disposed) return;
			buffer = decoded;
			updateMeta();
			render();
			startPlayhead();
		})
		.catch(() => {
			if (!disposed) info.textContent = 'Waveform unavailable';
		});

	return () => {
		disposed = true;
		cancelAnimationFrame(raf);
		unsub();
		ro.disconnect();
	};
}

// Music Controls in the top Controls pane: recessed transport pill, live BAR / BEAT counter
// with 4-dot beat pulse LEDs, Tap Tempo & vertical BPM drag, active-song status dot + clickable
// arrange() / @length section progress bar, and toggleable Master Safety Limiter.
import { type ControlsState, cycleToBarBeat, DEFAULT_BPM, type FromControls, tapTempoBpm } from '../shared/controls.ts';

const svg = (body: string) => `<svg viewBox="0 0 16 16" width="15" height="15">${body}</svg>`;

/**
 * Builds the Transport HUD once and returns how to update it. Updated in place, never rebuilt,
 * so typing or dragging BPM is never interrupted by incoming clock ticks.
 */
export function createControls(into: HTMLElement, post: (message: FromControls) => void): (state: ControlsState) => void {
	let state: ControlsState = { known: false, playing: false };
	const row = into.appendChild(document.createElement('div'));
	row.className = 'controls';

	// Row 1: Recessed Play/Stop/Rec/Render pill + Undo/Redo + Master Limiter toggle.
	const transportRow = row.appendChild(document.createElement('div'));
	transportRow.className = 'controls-transport';

	const pill = transportRow.appendChild(document.createElement('div'));
	pill.className = 'transport-pill';
	const makeBtn = (parent: HTMLElement, className: string, title: string, icon: string) => {
		const b = parent.appendChild(document.createElement('button'));
		b.className = className;
		b.title = title;
		b.innerHTML = svg(icon);
		return b;
	};
	const play = makeBtn(pill, 'play', 'Play / update (Ctrl+Enter in the editor)', '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>');
	play.addEventListener('click', () => post({ type: 'transport', action: 'play' }));
	makeBtn(pill, 'stop', 'Stop (Ctrl+.)', '<rect x="3" y="3" width="10" height="10" fill="currentColor"/>').addEventListener('click', () =>
		post({ type: 'transport', action: 'stop' }),
	);
	const record = makeBtn(
		pill,
		'record',
		'Record: play and record what you hear into a .wav and .mp3 next to the song. Click again or Stop to end',
		'<circle cx="8" cy="8" r="5" fill="currentColor"/>',
	);
	record.addEventListener('click', () => post({ type: 'transport', action: 'record' }));
	makeBtn(pill, 'record', 'Record automation: not built yet', '<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>').disabled = true;
	const render = makeBtn(
		pill,
		'render',
		'Render audio',
		'<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
	);
	render.addEventListener('click', () => post({ type: 'transport', action: 'render' }));

	const utils = transportRow.appendChild(document.createElement('div'));
	utils.className = 'transport-utils';
	const undo = makeBtn(
		utils,
		'undo',
		'Undo last edit to the song',
		'<path d="M4.5 6.5h5a3.5 3.5 0 1 1 0 7H7M4.5 6.5 7 4M4.5 6.5 7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
	);
	undo.disabled = true;
	undo.addEventListener('click', () => post({ type: 'transport', action: 'undo' }));
	const redo = makeBtn(
		utils,
		'redo',
		'Redo edit to the song',
		'<path d="M11.5 6.5h-5a3.5 3.5 0 1 0 0 7H9M11.5 6.5 9 4M11.5 6.5 9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
	);
	redo.disabled = true;
	redo.addEventListener('click', () => post({ type: 'transport', action: 'redo' }));

	const limiter = utils.appendChild(document.createElement('button'));
	limiter.className = 'lim-btn';
	limiter.textContent = 'LIM';
	limiter.title = 'Master output safety limiter (DynamicsCompressorNode): prevents harsh clipping during live sets';
	limiter.addEventListener('click', () => post({ type: 'limiter', on: !state.limiter }));

	// Row 2: Live BAR / BEAT HUD + 4-dot beat LEDs on left, centered BPM with Tap Tempo + vertical drag.
	const hudRow = row.appendChild(document.createElement('div'));
	hudRow.className = 'controls-hud';

	const beatHud = hudRow.appendChild(document.createElement('div'));
	beatHud.className = 'beat-hud';
	beatHud.title = 'Live BAR.BEAT counter synced to Strudel scheduler';
	const barBeatText = beatHud.appendChild(document.createElement('span'));
	barBeatText.className = 'bar-beat tabular';
	barBeatText.textContent = '001.1';
	const beatDots = beatHud.appendChild(document.createElement('span'));
	beatDots.className = 'beat-dots';
	const dots = Array.from({ length: 4 }, (_, i) => {
		const d = beatDots.appendChild(document.createElement('i'));
		d.className = i === 0 ? 'beat-dot downbeat' : 'beat-dot';
		return d;
	});

	const bpmBox = hudRow.appendChild(document.createElement('div'));
	bpmBox.className = 'bpm';
	const tapBtn = bpmBox.appendChild(document.createElement('button'));
	tapBtn.className = 'tap-btn';
	tapBtn.textContent = 'BPM';
	tapBtn.title = 'Tap 4 times for Tap Tempo';
	const bpm = bpmBox.appendChild(document.createElement('input'));
	bpm.inputMode = 'decimal';
	bpm.size = 5;

	// Tap Tempo on clicking the BPM label 4 times.
	let taps: number[] = [];
	tapBtn.addEventListener('click', () => {
		const now = performance.now();
		if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
		taps.push(now);
		tapBtn.classList.add('tap-flash');
		setTimeout(() => tapBtn.classList.remove('tap-flash'), 120);
		const computed = tapTempoBpm(taps);
		if (computed !== undefined && state.known) {
			post({ type: 'tempo', bpm: computed });
		}
	});

	// Vertical pointer drag on the BPM input (Ableton style), while preserving click-to-type and dblclick-to-reset.
	let bpmDragging = false;
	bpm.addEventListener('pointerdown', (event) => {
		if (event.button !== 0 || bpm.disabled) return;
		const startY = event.clientY;
		const startBpm = state.tempo?.bpm ?? DEFAULT_BPM;
		let current = startBpm;
		let moved = false;
		const move = (e: PointerEvent) => {
			const dy = startY - e.clientY;
			if (!moved && Math.abs(dy) < 4) return;
			if (!moved) {
				moved = true;
				bpmDragging = true;
				bpm.blur();
				bpm.setPointerCapture(event.pointerId);
				document.body.style.cursor = 'ns-resize';
			}
			const step = e.shiftKey ? 0.1 : 1;
			const next = Math.max(30, Math.min(300, Math.round((startBpm + (dy / 3) * step) * 10) / 10));
			if (next !== current) {
				current = next;
				bpm.value = String(next);
			}
		};
		const end = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', end);
			document.body.style.cursor = '';
			if (moved) {
				bpmDragging = false;
				if (current !== startBpm) post({ type: 'tempo', bpm: current });
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', end);
	});

	const showTempo = () => {
		if (bpmDragging) return;
		const tempo = state.tempo;
		bpm.classList.toggle('default', !tempo);
		bpm.disabled = !state.known || (!!tempo && tempo.bpm === undefined);
		bpm.title = !tempo
			? `Strudel's default, ${DEFAULT_BPM}. Drag up/down, type a number, or tap BPM 4 times`
			: tempo.bpm === undefined
				? 'The song sets its tempo with something that is not a plain number. Change it in the code'
				: 'Drag up/down or type and press Enter to write setcpm(<bpm>/4). Double click: back to default';
		if (document.activeElement !== bpm) bpm.value = String(tempo ? (tempo.bpm ?? '?') : DEFAULT_BPM);
	};
	bpm.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') bpm.blur();
		if (event.key === 'Escape') {
			bpm.value = '';
			bpm.blur();
		}
	});
	bpm.addEventListener('change', () => {
		const value = Number(bpm.value.replace(',', '.'));
		const now = state.tempo ? state.tempo.bpm : DEFAULT_BPM;
		if (Number.isFinite(value) && value > 0 && value !== now) post({ type: 'tempo', bpm: value });
		else showTempo();
	});
	bpm.addEventListener('blur', showTempo);
	bpm.addEventListener('dblclick', () => {
		bpm.blur();
		if (state.tempo) post({ type: 'tempo' });
	});

	// Row 3: Compact active-song status sub-row (live dot + song name) + clickable arrange()/@length progress bar.
	const statusRow = row.appendChild(document.createElement('div'));
	statusRow.className = 'controls-status';
	const statusDot = statusRow.appendChild(document.createElement('span'));
	statusDot.className = 'status-dot';
	const song = statusRow.appendChild(document.createElement('span'));
	song.className = 'song';

	const arrangeBar = row.appendChild(document.createElement('div'));
	arrangeBar.className = 'arrange-bar';
	arrangeBar.hidden = true;
	const arrangeProgress = arrangeBar.appendChild(document.createElement('div'));
	arrangeProgress.className = 'arrange-progress';
	const arrangeSections = arrangeBar.appendChild(document.createElement('div'));
	arrangeSections.className = 'arrange-sections';

	arrangeBar.addEventListener('click', (event) => {
		if (!state.lengthCycles || state.lengthCycles <= 0) return;
		const rect = arrangeBar.getBoundingClientRect();
		const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
		post({ type: 'seek', cycle: Math.floor(frac * state.lengthCycles) });
	});

	let lastSectionsKey = '';
	function renderArrangement(): void {
		const sections = state.sections ?? [];
		const total = state.lengthCycles ?? 0;
		arrangeBar.hidden = !(total > 0 && sections.length > 0);
		if (arrangeBar.hidden) return;
		const key = `${total}:${sections.map((s) => `${s.label}@${s.start}+${s.cycles}`).join('|')}`;
		if (key === lastSectionsKey) return;
		lastSectionsKey = key;
		arrangeSections.replaceChildren();
		for (const sec of sections) {
			const seg = arrangeSections.appendChild(document.createElement('span'));
			seg.className = 'arrange-seg';
			seg.style.flex = String(sec.cycles);
			seg.textContent = sec.label;
			seg.title = `${sec.label}: bars ${sec.start + 1}-${sec.start + sec.cycles} (${sec.cycles} bars). Click to seek`;
		}
	}

	let clockRaf = 0;
	function renderClock(): void {
		cancelAnimationFrame(clockRaf);
		if (!state.playing || !state.clock) {
			barBeatText.textContent = '001.1';
			beatHud.classList.remove('active');
			for (const d of dots) d.classList.remove('lit');
			arrangeProgress.style.width = '0%';
			return;
		}
		beatHud.classList.add('active');
		const elapsedSec = Math.max(0, (Date.now() - state.clock.at) / 1000);
		const cycle = state.clock.cycle + elapsedSec * state.clock.cps;
		const { bar, beat } = cycleToBarBeat(cycle);
		barBeatText.textContent = `${String(bar).padStart(3, '0')}.${beat}`;
		dots.forEach((d, idx) => d.classList.toggle('lit', idx === beat - 1));
		if (state.lengthCycles && state.lengthCycles > 0) {
			const pos = ((cycle % state.lengthCycles) + state.lengthCycles) % state.lengthCycles;
			arrangeProgress.style.width = `${(pos / state.lengthCycles) * 100}%`;
		}
		clockRaf = requestAnimationFrame(renderClock);
	}

	return (next) => {
		state = next;
		play.classList.toggle('on', next.playing);
		record.classList.toggle('on', !!next.recording);
		render.classList.toggle('busy', !!next.rendering);
		render.disabled = !!next.rendering;
		render.title = next.rendering ? 'Rendering...' : 'Render audio';
		undo.disabled = !next.canUndo;
		redo.disabled = !next.canRedo;
		limiter.classList.toggle('on', !!next.limiter);
		limiter.title = next.limiter
			? 'Master safety limiter is ON (DynamicsCompressorNode). Click to bypass'
			: 'Master safety limiter is OFF. Click to enable brickwall limiting on Master output';
		statusDot.className = `status-dot ${next.recording || next.error ? 'err' : next.playing ? 'play' : 'idle'}`;
		statusDot.title = next.recording ? 'Recording' : next.error ? 'Error in code' : next.playing ? 'Playing' : 'Stopped';
		song.textContent = next.song ?? 'No song';
		song.title = next.song ? `Play, Stop and BPM act on ${next.song}, the song the Mixer shows` : 'Open a .strudel file';
		showTempo();
		renderArrangement();
		renderClock();
	};
}

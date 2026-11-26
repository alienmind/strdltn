// Music Controls in the Library page: one row at the top, so it always fits. The maintainer
// first had them as a side bar view of their own, but VS Code gives a view whatever height
// is left and an extension cannot fix it, so the view grew to half the side bar.
// See "Music Controls" in doc/ARCHITECTURE.md.
import { type ControlsState, DEFAULT_BPM, type FromControls } from '../shared/controls.ts';

const svg = (body: string) => `<svg viewBox="0 0 16 16" width="16" height="16">${body}</svg>`;

/**
 * Builds the row once and returns how to update it. It is updated in place, never rebuilt:
 * a redraw while the BPM is typed must not take the field away.
 */
export function createControls(into: HTMLElement, post: (message: FromControls) => void): (state: ControlsState) => void {
	let state: ControlsState = { known: false, playing: false };
	const row = into.appendChild(document.createElement('div'));
	row.className = 'controls';
	const button = (className: string, title: string, icon: string) => {
		const b = row.appendChild(document.createElement('button'));
		b.className = className;
		b.title = title;
		b.innerHTML = svg(icon);
		return b;
	};
	const play = button('play', 'Play / update (Ctrl+Enter in the editor)', '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>');
	play.addEventListener('click', () => post({ type: 'transport', action: 'play' }));
	button('stop', 'Stop (Ctrl+.)', '<rect x="3" y="3" width="10" height="10" fill="currentColor"/>').addEventListener('click', () => post({ type: 'transport', action: 'stop' }));
	// Record (a filled red circle) and Record Automation (an empty one), as Live has them. Record plays the song and
	// writes what you hear next to it; a second click, or Stop, ends the take. Record automation is not built yet: see
	// "Recording and arrangement" in doc/DAW-PLAN.md.
	const record = button('record', 'Record: play and record what you hear into a .wav and .mp3 next to the song. Click again or Stop to end', '<circle cx="8" cy="8" r="5" fill="currentColor"/>');
	record.addEventListener('click', () => post({ type: 'transport', action: 'record' }));
	button('record', 'Record automation: not built yet', '<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>').disabled = true;
	// Render: the whole song made offline, at full speed and silent, into a .wav and an .mp3 next to it.
	const render = button('render', 'Render audio', '<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
	render.addEventListener('click', () => post({ type: 'transport', action: 'render' }));
	// Undo and Redo for edits to the active song (typing, Mixer toggles, cables, inserts).
	const undo = button('undo', 'Undo last edit to the song', '<path d="M4.5 6.5h5a3.5 3.5 0 1 1 0 7H7M4.5 6.5 7 4M4.5 6.5 7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>');
	undo.disabled = true;
	undo.addEventListener('click', () => post({ type: 'transport', action: 'undo' }));
	const redo = button('redo', 'Redo edit to the song', '<path d="M11.5 6.5h-5a3.5 3.5 0 1 0 0 7H9M11.5 6.5 9 4M11.5 6.5 9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>');
	redo.disabled = true;
	redo.addEventListener('click', () => post({ type: 'transport', action: 'redo' }));
	const bpmBox = row.appendChild(document.createElement('label'));
	bpmBox.className = 'bpm';
	bpmBox.appendChild(document.createElement('span')).textContent = 'BPM';
	const bpm = bpmBox.appendChild(document.createElement('input'));
	bpm.inputMode = 'decimal';
	bpm.size = 5;
	const song = row.appendChild(document.createElement('span'));
	song.className = 'song';

	const showTempo = () => {
		const tempo = state.tempo;
		bpm.classList.toggle('default', !tempo);
		bpm.disabled = !state.known || (!!tempo && tempo.bpm === undefined);
		bpm.title = !tempo
			? `Strudel's default, ${DEFAULT_BPM}: the song has no setcpm(). Type a number to write one`
			: tempo.bpm === undefined
				? 'The song sets its tempo with something that is not a plain number. Change it in the code'
				: 'Type a number and press Enter to write setcpm(<bpm>/4). Double click: back to the default';
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

	return (next) => {
		state = next;
		play.classList.toggle('on', next.playing);
		record.classList.toggle('on', !!next.recording);
		render.classList.toggle('busy', !!next.rendering);
		render.disabled = !!next.rendering;
		render.title = next.rendering ? 'Rendering...' : 'Render audio';
		undo.disabled = !next.canUndo;
		redo.disabled = !next.canRedo;
		song.textContent = next.song ?? 'No song';
		song.title = next.song ? `Play, Stop and BPM act on ${next.song}, the song the Mixer shows` : 'Open a .strudel file';
		showTempo();
	};
}

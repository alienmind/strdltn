// Music Controls: Play, Stop, Record, Render, Beat-Synced Transport HUD, Arrangement bar,
// Tap Tempo, BPM drag, and Master Safety Limiter. Both sides import this file.
import { parse } from 'acorn';

export type TransportAction = 'play' | 'stop' | 'record' | 'render' | 'undo' | 'redo';

/** Strudel's tempo when a song sets none: 0.5 cycles a second (cyclist.mjs of @strudel/core 1.2.6), 4 beats a cycle. */
export const DEFAULT_BPM = 120;

export interface ArrangementSection {
	label: string;
	start: number;
	cycles: number;
}

export interface ClockSnapshot {
	/** Scheduler cycle (`scheduler.now()`). */
	cycle: number;
	/** Cycles per second (`scheduler.cps`). */
	cps: number;
	/** Wall-clock timestamp (`Date.now()`) when this snapshot was sampled. */
	at: number;
}

export interface ControlsState {
	/** The file name of the song, or undefined before any song was in front. */
	song?: string;
	/** True once the song's code has been read: before, there is nothing to set a tempo on. */
	known: boolean;
	/** The song's `setcpm()` or `setcps()`; undefined when it has none (Strudel's default plays). `bpm` undefined: not a plain number. */
	tempo?: { bpm?: number };
	playing: boolean;
	/** True when the active song has a parse or evaluation error. */
	error?: boolean;
	/** Record is on: what plays goes to a .wav and .mp3 next to the song. */
	recording?: boolean;
	/** A render of the whole song is being made, offline. */
	rendering?: boolean;
	/** Whether the active song has edits to undo or redo. */
	canUndo?: boolean;
	canRedo?: boolean;
	/** Live scheduler clock snapshot for 60fps BAR / BEAT interpolation while playing. */
	clock?: ClockSnapshot;
	/** Total cycle length from `arrange(...)` or `// @length <N>`. */
	lengthCycles?: number;
	/** Arrangement sections parsed from `arrange([bars, expr], ...)` or a single bar span from `// @length`. */
	sections?: ArrangementSection[];
	/** Whether the Master output safety limiter (`DynamicsCompressorNode`) is enabled. */
	limiter?: boolean;
}

export type FromControls =
	/** Play, Stop, Record (on and off), Render, Undo, Redo. */
	| { type: 'transport'; action: TransportAction }
	/** The BPM box: a number writes `setcpm(<bpm>/4)`, none (a double click) takes it out. */
	| { type: 'tempo'; bpm?: number }
	/** Toggle the Master output safety limiter (`DynamicsCompressorNode`). */
	| { type: 'limiter'; on: boolean }
	/** Seek the playing song's scheduler to `cycle`. */
	| { type: 'seek'; cycle: number };

/** Converts a 0-based cycle number into 1-based `{ bar, beat }` (4 beats per cycle). */
export function cycleToBarBeat(cycle: number): { bar: number; beat: number } {
	const safe = Number.isFinite(cycle) && cycle >= 0 ? cycle : 0;
	const bar = Math.floor(safe) + 1;
	const frac = safe - Math.floor(safe);
	const beat = Math.min(4, Math.floor(frac * 4) + 1);
	return { bar, beat };
}

/**
 * Computes BPM from recent tap timestamps (ms). Resets if the gap between consecutive taps
 * exceeds 2.5 s. Returns a rounded BPM in `[30, 300]` once at least 4 taps are recorded.
 */
export function tapTempoBpm(taps: number[]): number | undefined {
	if (taps.length < 4) return undefined;
	const recent = taps.slice(-8);
	const intervals: number[] = [];
	for (let i = 1; i < recent.length; i++) {
		const dt = recent[i] - recent[i - 1];
		if (dt <= 0 || dt > 2500) return undefined;
		intervals.push(dt);
	}
	if (intervals.length < 3) return undefined;
	const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
	const bpm = Math.round((60_000 / avg) * 10) / 10;
	return Math.max(30, Math.min(300, bpm));
}

/**
 * Extracts total length and clickable sections from `arrange([cycles, part], ...)` and/or
 * `// @length <cycles>` in a Strudel song.
 */
export function parseArrangement(code: string): { lengthCycles?: number; sections: ArrangementSection[] } {
	const lengthMatch = /^\s*\/\/\s*@length\s+(\d+(?:\.\d+)?)\s*$/m.exec(code);
	const headerLength = lengthMatch ? Number(lengthMatch[1]) : undefined;
	const validHeader = headerLength !== undefined && Number.isFinite(headerLength) && headerLength > 0 ? headerLength : undefined;

	let best: ArrangementSection[] = [];
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const program = parse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, sourceType: 'script' }) as any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const visit = (node: any) => {
			if (!node || typeof node !== 'object') return;
			if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'arrange') {
				const found: ArrangementSection[] = [];
				let cursor = 0;
				for (const arg of node.arguments ?? []) {
					if (arg?.type !== 'ArrayExpression' || !arg.elements?.length) continue;
					const first = arg.elements[0];
					const cycles = first?.type === 'Literal' && typeof first.value === 'number' ? first.value : undefined;
					if (!cycles || !Number.isFinite(cycles) || cycles <= 0) continue;
					const second = arg.elements[1];
					let label = `S${found.length + 1}`;
					// Check trailing comment on the tuple's line first (e.g. `[8, intro], // Intro`).
					const lineEnd = code.indexOf('\n', arg.end);
					const tail = code.slice(arg.end, lineEnd < 0 ? code.length : lineEnd);
					const comment = /\/\/\s*(.+)$/.exec(tail)?.[1]?.trim();
					if (comment) label = comment.slice(0, 18);
					else if (second?.type === 'Identifier') label = second.name;
					else if (second?.type === 'Literal' && typeof second.value === 'string') label = second.value.slice(0, 16);
					found.push({ label, start: cursor, cycles });
					cursor += cycles;
				}
				if (found.length > best.length) best = found;
			}
			for (const key in node) {
				if (key === 'type' || key === 'start' || key === 'end') continue;
				const value = node[key];
				if (Array.isArray(value)) {
					for (const child of value) if (child && typeof child.type === 'string') visit(child);
				} else if (value && typeof value.type === 'string') {
					visit(value);
				}
			}
		};
		visit(program);
	} catch {
		// Unparseable while typing; fall back to header length below.
	}

	if (best.length) {
		const total = best.reduce((sum, s) => sum + s.cycles, 0);
		return { lengthCycles: validHeader ?? total, sections: best };
	}
	if (validHeader) {
		return { lengthCycles: validHeader, sections: [{ label: `${validHeader} bars`, start: 0, cycles: validHeader }] };
	}
	return { sections: [] };
}

// Per-line editor gutter actions (M = Mute, S = Solo, C = MIDI Capture).
// Pure functions so both the Strudel editor gutter and unit tests share one source of truth.
import { readChains } from './chains.ts';
import { sliderAt } from './knob.ts';

export interface LineAction {
	/** 0-based index into `readChains(code).chains`, present on the start line of a labeled chain. */
	chain?: number;
	muted?: boolean;
	solo?: boolean;
	/** Character offset where the first `slider(...)` number on this line starts (for MIDI Capture). */
	sliderFrom?: number;
	/** Mapped CC number on that slider, if `.knob(cc)` is present. */
	cc?: number;
}

const SLIDER_RE = /\bslider\s*\(/;
const KNOB_RE = /\.knob\(\s*(\d+)\s*\)/;
const FALLBACK_CHAIN_RE = /^\s*([_$A-Za-z][\w$]*)\s*:/;

/** Returns the 0-based line index for a character offset in `\n`-normalized text. */
function lineOfOffset(lineStarts: number[], offset: number): number {
	let lo = 0;
	let hi = lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lineStarts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/**
 * Computes the M / S / C gutter actions for every line of `code` (`\n` line endings).
 * When the code parses cleanly, chain indices and mute/solo flags come straight from `readChains`
 * so they match the Mixer 1:1. While the user is mid-keystroke with a syntax error, a line regex
 * preserves M/S state on existing chain lines so the gutter does not flicker away.
 */
export function lineActionMap(code: string): Map<number, LineAction> {
	const lines = code.split('\n');
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}

	const map = new Map<number, LineAction>();
	const put = (line: number): LineAction => {
		let entry = map.get(line);
		if (!entry) {
			entry = {};
			map.set(line, entry);
		}
		return entry;
	};

	const model = readChains(code);
	if (!('error' in model)) {
		model.chains.forEach((chain, index) => {
			if (chain.bare) return;
			const line = lineOfOffset(starts, chain.from);
			const entry = put(line);
			entry.chain = index;
			entry.muted = chain.muted;
			entry.solo = chain.solo;
		});
	} else {
		let chainIndex = 0;
		lines.forEach((text, line) => {
			const match = FALLBACK_CHAIN_RE.exec(text);
			if (!match) return;
			const label = match[1];
			// Skip JS object properties indented deeply inside blocks; top-level chains have no leading indent.
			if (/^\s+/.test(text)) return;
			const muted = label.startsWith('_') || label.endsWith('_');
			const base = label.replace(/^_+|_+$/g, '');
			const solo = base.length > 1 && base.startsWith('S');
			const entry = put(line);
			entry.chain = chainIndex++;
			entry.muted = muted;
			entry.solo = solo;
		});
	}

	lines.forEach((text, line) => {
		const match = SLIDER_RE.exec(text);
		if (!match) return;
		const from = sliderAt(code, starts[line] + match.index + match[0].length);
		if (from === undefined) return;
		const ccMatch = KNOB_RE.exec(text);
		const entry = put(line);
		entry.sliderFrom = from;
		entry.cc = ccMatch ? Number(ccMatch[1]) : undefined;
	});

	return map;
}

/**
 * Stable visual state key for a line's M / S / C badge trio, used to cache native VS Code
 * editor decorations across edits. Returns `'empty'` for lines with no actions.
 */
export function lineActionStateKey(action: LineAction | undefined, learning = false): string {
	if (!action || (action.chain === undefined && action.sliderFrom === undefined)) return 'empty';
	const m = action.chain === undefined ? '_' : action.muted ? '1' : '0';
	const s = action.chain === undefined ? '_' : action.solo ? '1' : '0';
	const c = action.sliderFrom === undefined ? '_' : learning ? '2' : action.cc === undefined ? '0' : '1';
	return `m${m}-s${s}-c${c}`;
}

/**
 * Renders the 3-column aligned M / S / C badge strip (49x15 px) matching the Strudel editor's
 * `.strdltn-act-row` CSS (`15px 15px 15px`, 2px gap). Absent slots stay transparent so every
 * line keeps identical horizontal alignment.
 */
export function lineActionSvg(action: LineAction | undefined, learning = false): string {
	const parts: string[] = [];
	const pill = (x: number, label: 'M' | 'S' | 'C', fill: string, stroke: string, text: string) => {
		parts.push(
			`<rect x="${x + 0.5}" y="0.5" width="14" height="14" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1"/>` +
				`<text x="${x + 7.5}" y="10.8" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="9.5" font-weight="700" fill="${text}">${label}</text>`,
		);
	};
	const offFill = 'rgba(128,128,128,0.14)';
	const offStroke = 'rgba(128,128,128,0.32)';
	const offText = '#8b949e';

	if (action?.chain !== undefined) {
		if (action.muted) pill(0, 'M', '#3794ff', '#3794ff', '#ffffff');
		else pill(0, 'M', offFill, offStroke, offText);
		if (action.solo) pill(17, 'S', '#d29922', '#d29922', '#111111');
		else pill(17, 'S', offFill, offStroke, offText);
	}
	if (action?.sliderFrom !== undefined) {
		if (learning) pill(34, 'C', '#f85149', '#f85149', '#ffffff');
		else if (action.cc !== undefined) pill(34, 'C', '#3fb950', '#3fb950', '#111111');
		else pill(34, 'C', offFill, offStroke, offText);
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="49" height="15" viewBox="0 0 49 15">${parts.join('')}</svg>`;
}

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

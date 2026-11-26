// Code inserted when an item from the Browser is dragged and dropped into a song editor.
// Dropping inside a string inserts only the bare name; dropping anywhere else inserts a complete, playable `$name:`
// line on its own line so existing code is never broken.
import { type CatalogItem, soundCode } from './catalog.ts';
import { insideString } from './context.ts';
import { firmwareIdFromUrl } from './firmware.ts';

/** Custom MIME type carried by Browser row drags alongside `text/plain`. */
export const DROP_MIME = 'application/vnd.strdltn.item';

export interface DropPayload {
	id: string;
	index?: number;
}

/** Valid identifier for a `$name:` label, derived from an item's name. */
function baseLabel(raw: string): string {
	const clean = raw
		.toLowerCase()
		.replace(/^gm_/, '')
		.replace(/^wt_/, '')
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');
	if (!clean) return 'part';
	return /^[0-9]/.test(clean) ? `p_${clean}` : clean;
}

/** Picks `$name` (or `$name2`, `$name3`...) not already used as a top-level label in `code`. */
export function uniqueLabel(raw: string, code: string): string {
	const base = baseLabel(raw);
	const used = new Set<string>();
	for (const match of code.matchAll(/^[ \t]*(?:\$|_|S)?([a-zA-Z_$][a-zA-Z0-9_$]*)[ \t]*:/gm)) {
		used.add(match[1].replace(/^\$/, '').toLowerCase());
	}
	if (!used.has(base)) return `$${base}`;
	for (let n = 2; n < 1000; n++) {
		if (!used.has(`${base}${n}`)) return `$${base}${n}`;
	}
	return `$${base}`;
}

/**
 * Full ready-to-play Strudel line for a dragged Browser item (synth, FM-1 firmware, soundfont, drum, sample, snippet
 * or function), with a unique `$label:` when `existingCode` is provided.
 */
export function dropLine(item: CatalogItem, existingCode = '', index?: number): { line: string; bare: string } {
	if (item.kind === 'firmware') {
		const id = item.id.startsWith('firmware:') ? item.id.slice('firmware:'.length) : firmwareIdFromUrl(item.label);
		const label = uniqueLabel(id, existingCode);
		return {
			line: `${label}: note("c3 eb3 g3 bb3").s("vibefm1:${id}").gain(slider(0.8, 0, 1))`,
			bare: `vibefm1:${id}`,
		};
	}
	if (item.kind === 'sound') {
		const tags = new Set(item.tags);
		const sound = soundCode(item, index);
		const name = sound?.name ?? item.insert ?? item.label;
		const variation = index !== undefined ? `:${index}` : '';
		if (item.category === 'drums') {
			const bank = item.bank ? `.bank("${item.bank}")` : '';
			const short = `${item.label}${variation}`;
			if (tags.has('Drums/Kick')) return { line: `${uniqueLabel('kick', existingCode)}: s("${short}*4")${bank}.gain(slider(0.9, 0, 1))`, bare: name };
			if (tags.has('Drums/Snare') || tags.has('Drums/Clap')) return { line: `${uniqueLabel('snare', existingCode)}: s("~ ${short} ~ ${short}")${bank}.gain(slider(0.8, 0, 1))`, bare: name };
			if (tags.has('Drums/Hihat')) return { line: `${uniqueLabel('hats', existingCode)}: s("[~ ${short}]*4")${bank}.gain(slider(0.6, 0, 1))`, bare: name };
			return { line: `${uniqueLabel(item.label, existingCode)}: s("${short}(3,8)")${bank}.gain(slider(0.7, 0, 1))`, bare: name };
		}
		if (item.category === 'samples') {
			return { line: `${uniqueLabel(item.label, existingCode)}: s("${item.label}${variation}").gain(slider(0.8, 0, 1))`, bare: name };
		}
		// Synths, soundfonts, wavetables: pick a musical starter suited to the instrument family.
		const target = `${item.label}${variation}`;
		if (tags.has('Sounds/Bass') || /bass/i.test(item.label)) {
			return { line: `${uniqueLabel(item.label, existingCode)}: note("c2 ~ c2 eb2 g1 ~ bb1 ~").s("${target}").gain(slider(0.8, 0, 1))`, bare: name };
		}
		if (tags.has('Sounds/Pad') || tags.has('Sounds/Strings') || tags.has('Sounds/Voice')) {
			return { line: `${uniqueLabel(item.label, existingCode)}: note("<[c3,eb3,g3,bb3] [f2,ab2,c3,eb3]>").s("${target}").room(0.5).gain(slider(0.6, 0, 1))`, bare: name };
		}
		const filter = item.soundType === 'synth' ? '.lpf(1800)' : '';
		return { line: `${uniqueLabel(item.label, existingCode)}: note("c3 eb3 g3 bb3").s("${target}")${filter}.gain(slider(0.7, 0, 1))`, bare: name };
	}
	if (item.kind === 'snippet' && item.insert) return { line: item.insert.trimEnd(), bare: item.insert.trimEnd() };
	if (item.kind === 'function') return { line: (item.code ?? item.insert ?? item.label).trimEnd(), bare: item.insert ?? item.label };
	if (item.kind === 'midi' && item.insert) return { line: item.insert, bare: item.label };
	return { line: item.insert ?? item.label, bare: item.insert ?? item.label };
}

/**
 * Computes the exact edit (`from`, `to`, `insert`) to drop an item at `offset` in `\n`-normalized `code`.
 * Inside a string, replaces nothing and inserts the bare name at `offset`. Otherwise places the full line on its own
 * line without splitting existing code on that line.
 */
export function dropEdit(item: CatalogItem, code: string, offset: number, index?: number): { from: number; to: number; insert: string } {
	const pos = Math.max(0, Math.min(code.length, offset));
	const { line, bare } = dropLine(item, code, index);
	if (insideString(code, pos)) return { from: pos, to: pos, insert: bare };
	const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
	const lineEndIdx = code.indexOf('\n', pos);
	const lineEnd = lineEndIdx < 0 ? code.length : lineEndIdx;
	const currentLine = code.slice(lineStart, lineEnd);
	// Dropped on an empty/whitespace line: replace that blank line in place.
	if (!currentLine.trim()) return { from: lineStart, to: lineEnd, insert: line };
	// Dropped on a non-empty line: insert as a new line right after it so existing code stays intact.
	return { from: lineEnd, to: lineEnd, insert: `\n${line}` };
}

// Code inserted when an item from the Browser is dragged and dropped into a song editor or Mixer.
// - Inside a string: bare sound name only.
// - Audio/pattern effect function dropped onto an existing chain: appended directly onto that chain's spine.
// - Anywhere else: a complete, playable `$name:` line on its own line so existing code is never broken.
import { readChains } from './chains.ts';
import { type CatalogItem, soundCode } from './catalog.ts';
import { chooseInsertEdits, insideString, type InsertEdit } from './context.ts';
import { firmwareIdFromUrl, HARDWARE_FM1_PROFILES } from './firmware.ts';

/** Custom MIME type carried by Browser row drags alongside `text/plain`. */
export const DROP_MIME = 'application/vnd.strdltn.item';

export interface DropPayload {
	id: string;
	index?: number;
}

/** Clean default method calls when an effect function is dragged onto an existing `$chain:`. */
const EFFECT_CALLS: Record<string, string> = {
	lpf: '.lpf(slider(1200, 100, 8000))',
	hpf: '.hpf(slider(300, 40, 4000))',
	bpf: '.bpf(slider(1000, 100, 8000))',
	lpq: '.lpq(slider(4, 0, 20))',
	room: '.room(slider(0.4, 0, 1))',
	delay: '.delay(slider(0.35, 0, 1)).delaytime(0.25)',
	distort: '.distort(slider(2, 0, 10))',
	dist: '.distort(slider(2, 0, 10))',
	shape: '.shape(slider(0.4, 0, 1))',
	crush: '.crush(slider(8, 2, 16))',
	coarse: '.coarse(slider(4, 1, 16))',
	phaser: '.phaser(slider(2, 0.2, 8))',
	tremolo: '.tremolo(slider(4, 0.5, 16))',
	vowel: '.vowel("a e i o u")',
	pan: '.pan(slider(0.5, 0, 1))',
	gain: '.gain(slider(0.8, 0, 1))',
	postgain: '.postgain(slider(0.8, 0, 1))',
	djf: '.djf(slider(0.5, 0, 1))',
	compressor: '.compressor("-20:4:6:0.005:0.05")',
	jux: '.jux(rev)',
	fast: '.fast(2)',
	slow: '.slow(2)',
	rev: '.rev()',
	degradeBy: '.degradeBy(slider(0.25, 0, 1))',
	swingBy: '.swingBy(1/3, 4)',
	echo: '.echo(3, 1/8, 0.5)',
	ply: '.ply(2)',
};

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
export function dropLine(
	item: CatalogItem,
	existingCode = '',
	index?: number,
	options?: { midiPort?: string },
): { line: string; bare: string; bank?: string } {
	if (item.kind === 'firmware') {
		const id = item.id.startsWith('firmware:') ? item.id.slice('firmware:'.length) : firmwareIdFromUrl(item.label);
		const label = uniqueLabel(id, existingCode);
		if (item.runtime === 'hardware') {
			const profile = HARDWARE_FM1_PROFILES.find((p) => p.id === id);
			const port = (options?.midiPort || profile?.defaultPort || 'M-VAVE FM-1').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
			const map = profile ? `.midimap('${profile.id}')` : '';
			return {
				line: `${label}: note("c3 eb3 g3 bb3").midi('${port}')${map}`,
				bare: port,
			};
		}
		if (item.runtime === 'fwsc') {
			return {
				line: `${label}: note("c3 eb3 g3 bb3").s("fm1:${id}").gain(slider(0.8, 0, 1))`,
				bare: `fm1:${id}`,
			};
		}
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
		const short = `${item.label}${variation}`;
		const bare = item.bank ? (sound?.short ?? short) : name;
		if (item.category === 'drums') {
			const bank = item.bank ? `.bank("${item.bank}")` : '';
			if (tags.has('Drums/Kick')) return { line: `${uniqueLabel('kick', existingCode)}: s("${short}*4")${bank}.gain(slider(0.9, 0, 1))`, bare, bank: item.bank };
			if (tags.has('Drums/Snare') || tags.has('Drums/Clap')) return { line: `${uniqueLabel('snare', existingCode)}: s("~ ${short} ~ ${short}")${bank}.gain(slider(0.8, 0, 1))`, bare, bank: item.bank };
			if (tags.has('Drums/Hihat')) return { line: `${uniqueLabel('hats', existingCode)}: s("[~ ${short}]*4")${bank}.gain(slider(0.6, 0, 1))`, bare, bank: item.bank };
			return { line: `${uniqueLabel(item.label, existingCode)}: s("${short}(3,8)")${bank}.gain(slider(0.7, 0, 1))`, bare, bank: item.bank };
		}
		if (item.category === 'samples') {
			const bank = item.bank ? `.bank("${item.bank}")` : '';
			return { line: `${uniqueLabel(item.label, existingCode)}: s("${short}")${bank}.gain(slider(0.8, 0, 1))`, bare, bank: item.bank };
		}
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
 * Computes the edit(s) (`from`, `to`, `insert`) to drop an item at `offset` in `\n`-normalized `code`.
 * - Inside a string: inserts the short/bare name at `offset`, and for banked sounds inside `s("...")` adds or
 *   updates `.bank("...")` on the chain.
 * - Effect function dropped onto an existing chain: appends the effect call directly to the end of that chain.
 * - Otherwise: places the full line on its own line without splitting existing code.
 */
export function dropEdits(
	item: CatalogItem,
	code: string,
	offset: number,
	index?: number,
	options?: { midiPort?: string },
): InsertEdit[] {
	const pos = Math.max(0, Math.min(code.length, offset));
	const { line, bare, bank } = dropLine(item, code, index, options);
	if (insideString(code, pos)) return chooseInsertEdits(code, pos, pos, line, bare, item.argument, bank);
	// Dropping an effect function (e.g. `lpf`, `room`, `delay`) onto an existing chain appends it to that chain's spine.
	if (item.kind === 'function' && EFFECT_CALLS[item.label]) {
		const model = readChains(code);
		if (!('error' in model)) {
			const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
			const lineEndIdx = code.indexOf('\n', pos);
			const lineEnd = lineEndIdx < 0 ? code.length : lineEndIdx;
			const target = model.chains.find((c) => c.from <= lineEnd && c.to >= lineStart);
			if (target) return [{ from: target.to, to: target.to, insert: EFFECT_CALLS[item.label] }];
		}
	}
	const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
	const lineEndIdx = code.indexOf('\n', pos);
	const lineEnd = lineEndIdx < 0 ? code.length : lineEndIdx;
	const currentLine = code.slice(lineStart, lineEnd);
	if (!currentLine.trim()) return [{ from: lineStart, to: lineEnd, insert: line }];
	return [{ from: lineEnd, to: lineEnd, insert: `\n${line}` }];
}

/** Single-edit convenience wrapper over `dropEdits` for callers and tests expecting one edit. */
export function dropEdit(
	item: CatalogItem,
	code: string,
	offset: number,
	index?: number,
	options?: { midiPort?: string },
): InsertEdit {
	return dropEdits(item, code, offset, index, options)[0];
}

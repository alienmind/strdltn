// The rules that tag the items of the Browser. A tag is `Group/Tag`, as the filter groups
// of the Live browser: `Drums/Kick`, `Sounds/Bass`, `Maker/Roland`. Nothing here listens to
// a sound: every rule reads a name. `tags.test.ts` holds the cases. When a sound lands in
// the wrong chip, add it there first.
import type { SoundInfo } from './protocol.ts';

/** The groups of chips, in the order the Browser shows them. */
export const TAG_GROUPS = ['Drums', 'Sounds', 'Maker', 'Source', 'Category', 'Function', 'Tag', 'Creator'] as const;

/**
 * A drum machine sound is named `<bank>_<sound>`, for example `RolandTR909_bd`, and
 * Strudel lets you write it as `s("bd").bank("RolandTR909")`. The bank is everything
 * before the last underscore.
 */
export function splitBank(name: string): { bank: string; sound: string } | undefined {
	const cut = name.lastIndexOf('_');
	return cut > 0 && cut < name.length - 1 ? { bank: name.slice(0, cut), sound: name.slice(cut + 1) } : undefined;
}

/** The short names of the tidal-drum-machines packs, and what each one is. */
const DRUM_PARTS: Record<string, string> = {
	bd: 'Kick',
	sd: 'Snare',
	rim: 'Rim',
	cp: 'Clap',
	hh: 'Hihat',
	oh: 'Hihat',
	cr: 'Cymbal',
	rd: 'Cymbal',
	lt: 'Tom',
	mt: 'Tom',
	ht: 'Tom',
	cb: 'Percussion',
	sh: 'Percussion',
	tb: 'Percussion',
	perc: 'Percussion',
	misc: 'Percussion',
	brk: 'Loop',
	fx: 'FX',
};

/** Words in the names of plain samples that say which drum they are. Checked in this order. */
const DRUM_WORDS: [RegExp, string][] = [
	[/bassdrum|kick/, 'Kick'],
	[/snare/, 'Snare'],
	[/clap/, 'Clap'],
	[/hihat|hat/, 'Hihat'],
	[/cymbal|clash|gong/, 'Cymbal'],
	[/tom|timpani|taiko/, 'Tom'],
	[/conga|bongo|cajon|darbuka|framedrum|slitdrum|oceandrum|brakedrum|steel_drums|woodblock|cowbell|clave|shaker|tambourine|cabasa|guiro|agogo|ratchet|triangles|vibraslap|sleighbells|belltree|slapstick|anvil|flexatone|marktrees/, 'Percussion'],
];

/** Instrument families, from words in a name. Covers the General MIDI soundfonts and the named samples. */
const FAMILIES: [RegExp, string][] = [
	// Before Bass: `gm_lead_8_bass_lead` is a lead.
	[/lead/, 'Lead'],
	[/bass(?!oon)|contrabass/, 'Bass'],
	[/pad/, 'Pad'],
	[/piano|epiano|harpsichord|clavinet|clavi|celesta|kawai|steinway/, 'Keys'],
	[/organ|accordion|bandoneon/, 'Keys'],
	[/guitar|banjo|sitar|koto|shamisen|strumstick|dantranh|psaltery|harp/, 'Guitar & Plucked'],
	[/violin|viola|cello|string|fiddle/, 'Strings'],
	[/trumpet|trombone|tuba|horn|brass/, 'Brass'],
	[/sax|oboe|bassoon|clarinet|piccolo|flute|recorder|ocarina|shakuhachi|whistle|bagpipe|shanai|harmonica|super64|didgeridoo|bottle|reed/, 'Woodwind'],
	[/choir|voice|vox|aahs|oohs|numbers/, 'Voice'],
	[/glockenspiel|vibraphone|marimba|xylophone|kalimba|balafon|tubular|music_box|dulcimer|bells|chimes|tinkle|wineglass|handbells/, 'Mallets'],
	[/fx|rain|atmosphere|crystal|goblins|echoes|sci_fi|soundtrack|seashore|bird|telephone|helicopter|applause|gunshot|siren|wind|insect|crow|space|noise/, 'FX'],
];

/** Oscillators and noises of superdough, by name. */
const SYNTHS: Record<string, string> = {
	sine: 'Oscillator',
	sin: 'Oscillator',
	triangle: 'Oscillator',
	tri: 'Oscillator',
	square: 'Oscillator',
	sqr: 'Oscillator',
	sawtooth: 'Oscillator',
	saw: 'Oscillator',
	supersaw: 'Oscillator',
	pulse: 'Oscillator',
	white: 'Noise',
	pink: 'Noise',
	brown: 'Noise',
	crackle: 'Noise',
};

/** Makers at the start of a lower-case bank name. Longest first, so `sequentialcircuits` wins over a shorter one. */
const MAKERS: [string, string][] = (
	[
		['roland', 'Roland'],
		['korg', 'Korg'],
		['yamaha', 'Yamaha'],
		['linn', 'Linn'],
		['akai', 'Akai'],
		['alesis', 'Alesis'],
		['boss', 'Boss'],
		['casio', 'Casio'],
		['emu', 'E-mu'],
		['doepfer', 'Doepfer'],
		['oberheim', 'Oberheim'],
		['sequentialcircuits', 'Sequential'],
		['simmons', 'Simmons'],
		['moog', 'Moog'],
		['rhodes', 'Rhodes'],
		['sakata', 'Sakata'],
		['serge', 'Serge'],
		['soundmaster', 'Soundmaster'],
		['univox', 'Univox'],
		['visco', 'Visco'],
		['mfb', 'MFB'],
	] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

/** The maker of a drum machine bank, when its name starts with one we know. `tr909` alone says nothing. */
export function makerOf(bank: string): string | undefined {
	const lower = bank.toLowerCase();
	return MAKERS.find(([prefix]) => lower.startsWith(prefix))?.[1];
}

/** `github:eddyflux/crate` or an `https://` address: a pack that a song loads by name. */
export function isPackTag(tag: string | undefined): tag is string {
	return !!tag && /^(github:|https?:\/\/)/.test(tag);
}

/** Where a sound comes from. */
export function sourceOf(sound: SoundInfo): string {
	if (sound.type === 'firmware') return 'Firmware';
	if (sound.tag === 'local') return 'Local';
	if (isPackTag(sound.tag)) return 'Pack';
	return 'Default';
}

/** Every tag a sound gets from its name, type and origin. */
export function soundTags(sound: SoundInfo): string[] {
	const tags = new Set<string>([`Source/${sourceOf(sound)}`]);
	const name = sound.name.toLowerCase();
	const split = splitBank(name);
	if (sound.tag === 'drum-machines' || (isPackTag(sound.tag) && split)) {
		// The drum machine pack also registers the bare parts (`bd`, `cp`) for `.bank()`.
		const part = DRUM_PARTS[split ? split.sound : name];
		if (part) tags.add(`Drums/${part}`);
		const maker = split && makerOf(split.bank);
		if (maker) tags.add(`Maker/${maker}`);
		return [...tags];
	}
	if (sound.type === 'synth') {
		const kind = SYNTHS[name];
		tags.add(`Sounds/${kind ?? (name.startsWith('z') ? 'ZZFX' : 'Synth')}`);
		return [...tags];
	}
	if (sound.type === 'firmware') {
		tags.add('Sounds/Synth');
		return [...tags];
	}
	if (DRUM_PARTS[name]) tags.add(`Drums/${DRUM_PARTS[name]}`);
	for (const [pattern, drum] of DRUM_WORDS) {
		if (pattern.test(name)) {
			tags.add(`Drums/${drum}`);
			break;
		}
	}
	// A drum is not also an instrument family: `timpani` is a Tom, not Mallets.
	if (![...tags].some((tag) => tag.startsWith('Drums/'))) {
		for (const [pattern, family] of FAMILIES) {
			if (pattern.test(name)) {
				tags.add(`Sounds/${family}`);
				break;
			}
		}
	}
	return [...tags];
}

/** The free words of a snippet's `@tags` line, `acid, 303, techno`. */
export function splitWords(value: string | undefined): string[] {
	return (value ?? '')
		.split(/[,;]/)
		.map((word) => word.trim())
		.filter(Boolean);
}

/** A snippet: its category, its own tags, who made it. */
export function snippetTags(fields: { name: string; value: string }[], category: string | undefined): string[] {
	const field = (name: string) => fields.find((entry) => entry.name === name)?.value;
	const tags = new Set<string>();
	if (category) tags.add(`Category/${category[0].toUpperCase()}${category.slice(1)}`);
	for (const word of splitWords(field('tags'))) tags.add(`Tag/${word}`);
	for (const name of [field('by'), field('credits')]) for (const who of splitWords(name)) tags.add(`Creator/${who}`);
	return [...tags];
}

/** The source file of a function in `@strudel/reference` says what it is about. */
const FUNCTION_FILES: Record<string, string> = {
	'controls.mjs': 'Effect',
	'pattern.mjs': 'Pattern',
	'signal.mjs': 'Signal',
	'pick.mjs': 'Pattern',
	'euclid.mjs': 'Rhythm',
	'motion.mjs': 'Input',
	'midi.mjs': 'Input',
	'osc.mjs': 'Input',
	'tonal.mjs': 'Tonal',
	'voicings.mjs': 'Tonal',
	'dough.mjs': 'Synth',
	'superdough.mjs': 'Synth',
	'sampler.mjs': 'Synth',
	'wavetable.mjs': 'Synth',
	'worklets.mjs': 'Synth',
	'ola-processor.js': 'Synth',
	'reverbGen.mjs': 'Synth',
	'pianoroll.mjs': 'Visual',
	'scope.mjs': 'Visual',
	'spectrum.mjs': 'Visual',
	'spiral.mjs': 'Visual',
	'pitchwheel.mjs': 'Visual',
	'drawLine.mjs': 'Visual',
	'codemirror.mjs': 'Visual',
	'slider.mjs': 'Visual',
	'repl.mjs': 'Song',
	'util.mjs': 'Song',
	'index.mjs': 'Song',
};

export function functionGroup(file: string | undefined): string {
	return FUNCTION_FILES[file ?? ''] ?? 'Other';
}

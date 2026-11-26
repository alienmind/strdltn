// The items of the Browser, and the file `strdltn.index.json` that keeps what the user
// gave them. Both sides import this file: the host builds the items, the webview shows
// them, and `search.ts` filters them on either side.
import type { SoundInfo } from './protocol.ts';
import type { InsertArgument } from './context.ts';
import type { SnippetInfo } from './snippet.ts';
import { firmwareCode, type FirmwareRuntime, HARDWARE_FM1_PROFILES, hardwareFirmwareCode, type HubFirmware, type InstalledFirmware } from './firmware.ts';
import { functionGroup, isPackTag, snippetTags, soundTags, splitBank, splitWords } from './tags.ts';

export type ItemKind = 'sound' | 'snippet' | 'song' | 'function' | 'render' | 'midi' | 'firmware';

/** The rows of "Library" in the Browser. */
export const CATEGORIES = [
	{ id: 'all', label: 'All', icon: 'all' },
	{ id: 'sounds', label: 'Sounds', icon: 'keyboard' },
	{ id: 'drums', label: 'Drums', icon: 'drum' },
	{ id: 'samples', label: 'Samples', icon: 'sample' },
	// Plugins, as in Live: one child per kind of plugin, more kinds to come (the maintainer, 2026-11-24).
	// FM-1 Synths unifies all FM-1 technologies (VIBE .wasm, real .fwsc, Hardware MIDI) into Installed and Available,
	// flagged with badges and filterable by Runtime/... and Repo/... tag chips.
	{ id: 'plugins', label: 'Plugins', icon: 'plugin' },
	{ id: 'fm1', label: 'FM-1 Synths', icon: 'firmware', parent: 'plugins' },
	// The audio of songs: renders and recordings, next to their song. See src/shared/render.ts.
	{ id: 'renders', label: 'Render', icon: 'render' },
	// The MIDI ports of the machine, from the extension host (src/extension/midi.ts). Desktop only.
	{ id: 'midi', label: 'MIDI', icon: 'midi' },
	{ id: 'songs', label: 'Songs', icon: 'song' },
	{ id: 'snippets', label: 'Snippets', icon: 'snippet' },
	// In the Reference view, not the Library (src/shared/browser.ts, `pageOf`).
	{ id: 'functions', label: 'Functions', icon: 'function' },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]['id'];
/** A category an item can be in: not All, and not a parent like Plugins, which shows its children's items. */
export type ItemCategory = Exclude<CategoryId, 'all' | 'plugins'>;

/** The parent of a category, for the indented rows of the Library. */
export const parentOf = (id: string): CategoryId | undefined => (CATEGORIES.find((c) => c.id === id) as { parent?: CategoryId } | undefined)?.parent;

/** Whether an item of `category` shows when `picked` is picked: the category itself, or its parent. */
export const inCategory = (category: string, picked: CategoryId): boolean => picked === 'all' || category === picked || parentOf(category) === picked;

/** The rows of "Places": where an item comes from. */
export const PLACES = [
	{ id: 'project', label: 'Current project', icon: 'folder' },
	{ id: 'packs', label: 'Packs', icon: 'pack' },
	{ id: 'builtin', label: 'Built in', icon: 'all' },
] as const;
export type PlaceId = (typeof PLACES)[number]['id'];

/** Seven colors, in the order of Live's collections. The names can be changed by the user. */
export const COLOR_COUNT = 7;
export const DEFAULT_COLOR_NAMES = ['Favorites', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Gray'];

export interface CatalogItem {
	/** `sound:bd`, `snippet:drums/four`, `song:examples/01.strudel`, `fn:lpf`. Stable across starts: user data hangs on it. */
	id: string;
	kind: ItemKind;
	/** What the row shows. */
	label: string;
	/** Dim text after the label: the bank, the folder, the tags of a snippet. */
	detail?: string;
	category: ItemCategory;
	place: PlaceId;
	/** The heading the row sits under in the results: a bank, a folder, a type. */
	group: string;
	/** For a bank heading: what its button types. */
	groupInsert?: string;
	/** Headings sort by this first, then by name: Installed before Available. */
	groupRank?: number;
	tags: string[];
	/** Lower case, everything a search term may match besides name and tags. */
	text: string;
	/** What Enter or the insert button types. Songs have none: they open. */
	insert?: string;
	/** What it types inside the empty parentheses of a call instead, `.midi(|)`: see chooseInsert. */
	argument?: InsertArgument;
	/** A sound with numbered variations. */
	count?: number;
	variations?: string[];
	/** The sound name to preview, and which variation: a firmware of `vibefm1` is picked by its position. */
	sound?: string;
	index?: number;
	/** superdough's type of the sound: a pitched one needs a note to be heard. */
	soundType?: string;
	/** The bank of a drum machine sound, for `.bank("...")`. */
	bank?: string;
	/** For the details pane. */
	description?: string;
	code?: string;
	fields?: { name: string; value: string }[];
	/** A file to open: a snippet or a song, relative to its workspace folder. */
	path?: string;
	/** A cached firmware: the address a song needs in `firmware('...')` to play it. */
	url?: string;
	/** A picture of it, as a webview URL: a firmware's screen. Its row is taller to show it. */
	image?: string;
	/** A firmware of the hub that is not installed: a double click installs it. */
	available?: boolean;
	/** For FM-1 synths: VIBE `.wasm`, emulated `.fwsc`, or real FM-1 hardware over MIDI. */
	runtime?: FirmwareRuntime;
	/** Companion web editor URL for a firmware (e.g. SHRUB's `shrub.audio/editor/`). */
	editorUrl?: string;
	/** External download/product URL for non-redistributable firmwares (e.g. `https://shrub.audio/`). */
	externalUrl?: string;
	/** Name of the firmware repository that provided this marketplace entry. */
	repo?: string;
}

/** What the user gave the items, kept in `strdltn.index.json` of the project. */
export interface UserIndex {
	version: 1;
	colorNames: string[];
	/** Per item id. Colors are 1 to 7. Tags are `Group/Tag`. */
	items: Record<string, { colors?: number[]; tags?: string[] }>;
	searches: SavedSearch[];
}

/** A search kept as a row under Collections, like "Add Label" in Live. */
export interface SavedSearch {
	name: string;
	query: string;
	category: CategoryId;
	place?: PlaceId;
	builtin?: boolean;
	color?: number;
	chips: string[];
}

/** A category kept from an earlier version: Instruments and Firmware are FM-1 Synths now, and an unknown one is All. */
export function knownCategory(id: unknown): CategoryId {
	if (id === 'instruments' || id === 'firmware' || id === 'fm1live') return 'fm1';
	return CATEGORIES.some((c) => c.id === id) ? (id as CategoryId) : 'all';
}

export function emptyUserIndex(): UserIndex {
	return { version: 1, colorNames: [...DEFAULT_COLOR_NAMES], items: {}, searches: [] };
}

/** Reads the file leniently: a hand-edited file with a missing part still works. */
export function readUserIndex(json: unknown): UserIndex {
	const base = emptyUserIndex();
	if (!json || typeof json !== 'object') return base;
	const data = json as Partial<UserIndex>;
	const names = Array.isArray(data.colorNames) ? data.colorNames : [];
	return {
		version: 1,
		colorNames: base.colorNames.map((name, i) => (typeof names[i] === 'string' && names[i] ? names[i] : name)),
		items: data.items && typeof data.items === 'object' ? data.items : {},
		searches: Array.isArray(data.searches) ? data.searches.filter((s) => s && typeof s.name === 'string').map((s) => ({ ...s, category: knownCategory(s.category) })) : [],
	};
}

/** The file as it is written: items without colors or tags are left out, so it stays small and diffs well. */
export function writeUserIndex(index: UserIndex): string {
	const items = Object.fromEntries(
		Object.entries(index.items)
			.filter(([, value]) => value.colors?.length || value.tags?.length)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([id, value]) => [id, { ...(value.colors?.length ? { colors: [...value.colors].sort() } : {}), ...(value.tags?.length ? { tags: [...value.tags].sort() } : {}) }]),
	);
	return `${JSON.stringify({ version: 1, colorNames: index.colorNames, items, searches: index.searches }, null, '\t')}\n`;
}

/** Which Library category a sound belongs to. */
function soundCategory(sound: SoundInfo): CatalogItem['category'] {
	if (sound.type === 'firmware') return 'fm1';
	if (sound.tag === 'drum-machines') return 'drums';
	if (sound.type === 'sample') return isPackTag(sound.tag) && splitBank(sound.name) ? 'drums' : 'samples';
	return 'sounds';
}

const TYPE_GROUPS: Record<string, string> = { synth: 'Synths', soundfont: 'Soundfonts', wavetable: 'Wavetables' };

/** One row per sound of the engine's list. The firmware host (`vibefm1`) has none: its firmwares are firmwareItems. */
export function soundItems(sounds: SoundInfo[]): CatalogItem[] {
	const items: CatalogItem[] = [];
	for (const sound of sounds) {
		const category = soundCategory(sound);
		const place: PlaceId = sound.tag === 'local' ? 'project' : isPackTag(sound.tag) ? 'packs' : 'builtin';
		const tags = soundTags(sound);
		// A firmware host (`vibefm1`) is shown by its firmwares, in the Firmware category: see firmwareItems.
		if (sound.type === 'firmware') continue;
		const split = splitBank(sound.name);
		const inBank = category === 'drums' && split;
		const group =
			category === 'drums'
				? split
					? split.bank
					: 'Other'
				: category === 'samples'
					? sound.tag === 'local'
						? 'Local samples'
						: isPackTag(sound.tag)
							? sound.tag
							: 'Default samples'
					: (TYPE_GROUPS[sound.type] ?? 'Other');
		items.push({
			id: `sound:${sound.name}`,
			kind: 'sound',
			label: inBank ? split.sound : sound.name,
			detail: inBank ? split.bank : undefined,
			category,
			place,
			group,
			groupInsert: inBank ? `.bank("${split.bank}")` : undefined,
			tags,
			text: [sound.name, sound.type, sound.tag ?? ''].join(' ').toLowerCase(),
			insert: sound.name,
			count: sound.count > 1 ? sound.count : undefined,
			variations: sound.variations,
			sound: sound.name,
			soundType: sound.type,
			bank: inBank ? split.bank : undefined,
		});
	}
	return items;
}

export function snippetItem(snippet: SnippetInfo, path: string): CatalogItem {
	const field = (name: string) => snippet.fields.find((entry) => entry.name === name)?.value;
	const details = field('details') ?? '';
	return {
		id: `snippet:${snippet.name}`,
		kind: 'snippet',
		label: snippet.title,
		detail: splitWords(field('tags')).join(', ') || undefined,
		category: 'snippets',
		place: 'project',
		group: snippet.category ?? (snippet.folder || 'Other'),
		tags: snippetTags(snippet.fields, snippet.category),
		text: [snippet.name, details, snippet.code.slice(0, 400)].join(' ').toLowerCase(),
		insert: snippet.code,
		description: details,
		code: snippet.code,
		fields: snippet.fields,
		path,
	};
}

/** A `.strudel` file of the workspace. `path` is relative to the workspace, with `/`. */
export function songItem(path: string): CatalogItem {
	const cut = path.lastIndexOf('/');
	const name = path.slice(cut + 1).replace(/\.strudel$/, '');
	return {
		id: `song:${path}`,
		kind: 'song',
		label: name,
		detail: cut >= 0 ? path.slice(0, cut) : undefined,
		category: 'songs',
		place: 'project',
		group: cut >= 0 ? path.slice(0, cut) : '.',
		tags: [],
		text: path.toLowerCase(),
		path,
	};
}

/**
 * A render or a recording of a song, a `.wav` or `.mp3` beside it. `song` is the song's path; the row sits under the
 * song's name, so the takes of one song are together.
 */
export function renderItem(path: string, song: string): CatalogItem {
	const cut = path.lastIndexOf('/');
	const file = path.slice(cut + 1);
	const songName = song.slice(song.lastIndexOf('/') + 1).replace(/\.strudel$/, '');
	return {
		id: `render:${path}`,
		kind: 'render',
		label: file,
		detail: cut >= 0 ? path.slice(0, cut) : undefined,
		category: 'renders',
		place: 'project',
		group: songName,
		tags: [],
		text: path.toLowerCase(),
		path,
	};
}

/**
 * A MIDI port of the machine. An output (an instrument) types `.midi('name')`, an input (a controller or a keyboard)
 * `const cc = await midin('name')`; inside a string, the name alone. Single quotes: Strudel reads a double-quoted
 * string as mini-notation, so `"MPK mini 3"` is a pattern of three words, and midin refuses a pattern. The id carries the name, so colors and tags stay
 * with a device across starts.
 */
export function midiItem(name: string, direction: 'out' | 'in'): CatalogItem {
	return {
		id: `midi:${direction}:${name}`,
		kind: 'midi',
		label: name,
		detail: direction === 'out' ? 'output' : 'input',
		category: 'midi',
		place: 'builtin',
		group: direction === 'out' ? 'Outputs: instruments' : 'Inputs: controllers',
		tags: [],
		text: `${name} midi ${direction === 'out' ? 'output instrument synth' : 'input controller keyboard'}`.toLowerCase(),
		insert: direction === 'out' ? `.midi('${quoted(name)}')` : `const cc = await midin('${quoted(name)}')`,
		argument: { calls: direction === 'out' ? ['midi'] : ['midin', 'midikeys'], text: `'${quoted(name)}'` },
	};
}

/** A device's name inside single quotes: a backslash or a quote in it is escaped. */
const quoted = (name: string) => name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * The FM-1 Synths of Plugins: Installed, one row per firmware the host found on disk, then Available, the hub's
 * firmwares that are not installed. A firmware in a `firmware/` folder wins over a cached one of the same id, as it does
 * in the engine. `engine` is the firmwares the engine of a song knows, in its order: those rows can play a test note, by
 * their position, as `vibefm1:3` would. `images` is the picture of each item's screen, by item id. An Available row keeps
 * the id it will have once installed, so its colors and tags stay with it.
 */
const RUNTIME_TAGS: Record<FirmwareRuntime, string> = {
	vibe: 'Runtime/VIBE WASM',
	fwsc: 'Runtime/FM-1 Emulated',
	hardware: 'Runtime/Hardware MIDI',
};

export function firmwareItems(
	installed: InstalledFirmware[],
	available: HubFirmware[] = [],
	engine: string[] = [],
	images: Record<string, string> = {},
	fm1Engine: string[] = [],
): CatalogItem[] {
	const byId = new Map<string, InstalledFirmware>();
	for (const fw of installed) {
		const known = byId.get(fw.id);
		if (!known || (known.from === 'cache' && fw.from === 'folder')) byId.set(fw.id, fw);
	}
	const describe = (fw: { name: string; version?: string; author?: string }) => [fw.version && `v${fw.version.replace(/^v/i, '')}`, fw.author].filter(Boolean).join('  ') || undefined;
	const tagsOf = (fw: { author?: string; runtime?: FirmwareRuntime; repo?: string }) => [
		'Source/Firmware',
		'Sounds/Synth',
		RUNTIME_TAGS[fw.runtime ?? 'vibe'],
		...(fw.repo ? [`Repo/${fw.repo}`] : []),
		...(fw.author ? [`Maker/${fw.author}`] : []),
	];
	const textOf = (fw: { id: string; name: string; author?: string; license?: string; description?: string; runtime?: FirmwareRuntime; repo?: string }) =>
		[fw.id, fw.name, fw.author ?? '', fw.license ?? '', fw.description ?? '', fw.runtime ?? 'vibe', fw.repo ?? '', 'firmware vibe fm fm-1 synth plugin'].join(' ').toLowerCase();
	const own: CatalogItem[] = [...byId.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((fw) => {
			const runtime: FirmwareRuntime = fw.runtime ?? 'vibe';
			const index = runtime === 'fwsc' ? fm1Engine.indexOf(fw.id) : engine.indexOf(fw.id);
			const id = `firmware:${fw.id}`;
			const snippet = firmwareCode(fw.id, runtime);
			return {
				id,
				kind: 'firmware',
				label: fw.name,
				detail: describe(fw),
				category: 'fm1',
				place: 'project',
				group: 'Installed',
				groupRank: 0,
				tags: tagsOf({ ...fw, runtime }),
				text: textOf({ ...fw, runtime }),
				insert: snippet.code,
				sound: runtime === 'fwsc' ? 'fm1' : 'vibefm1',
				...(index >= 0 ? { index } : {}),
				soundType: 'firmware',
				runtime,
				editorUrl: fw.editor,
				description: fw.description,
				// What insert types, with the load line a cached one also gets when the song has none (firmwareLoadEdit).
				code: fw.url && runtime === 'vibe' ? `firmware('${fw.url}')\n${snippet.code}` : snippet.code,
				fields: [
					{ name: 'id', value: snippet.name },
					{ name: 'runtime', value: runtime === 'fwsc' ? 'FM-1 .fwsc (fm1-emu)' : 'VIBE FM (.wasm)' },
					...(fw.version ? [{ name: 'version', value: fw.version }] : []),
					...(fw.author ? [{ name: 'author', value: fw.author }] : []),
					...(fw.license ? [{ name: 'license', value: fw.license }] : []),
					{ name: fw.from === 'cache' ? 'downloaded from' : 'file', value: fw.url ?? fw.path },
				],
				path: fw.path,
				url: fw.url,
				image: images[id],
			};
		});
	const hardware: CatalogItem[] = HARDWARE_FM1_PROFILES.map((profile) => {
		const id = `firmware:${profile.id}`;
		const snippet = hardwareFirmwareCode(profile);
		return {
			id,
			kind: 'firmware',
			label: profile.name,
			detail: profile.author,
			category: 'fm1',
			place: 'builtin',
			group: 'Installed',
			groupRank: 0,
			tags: tagsOf({ author: profile.author, runtime: 'hardware' }),
			text: `${textOf({ ...profile, runtime: 'hardware' })} midi hardware`.toLowerCase(),
			insert: snippet.code,
			sound: 'midi',
			soundType: 'firmware',
			runtime: 'hardware',
			editorUrl: profile.editor,
			description: profile.description,
			code: snippet.code,
			fields: [
				{ name: 'runtime', value: 'Real M-VAVE FM-1 over desktop MIDI' },
				{ name: 'port', value: profile.defaultPort },
				{ name: 'CC map', value: Object.entries(profile.midimap).map(([k, v]) => `${k}=CC${v}`).join(', ') },
				{ name: 'author', value: profile.author },
				{ name: 'license', value: profile.license },
				...(profile.editor ? [{ name: 'editor', value: profile.editor }] : []),
			],
		};
	});
	const hub: CatalogItem[] = [...available]
		.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
		.map((fw) => {
			const runtime: FirmwareRuntime = fw.runtime ?? 'vibe';
			const id = `firmware:${fw.id}`;
			const snippet = firmwareCode(fw.id, runtime);
			return {
				id,
				kind: 'firmware',
				label: fw.name,
				detail: describe(fw),
				category: 'fm1',
				place: 'packs',
				group: 'Available',
				groupRank: 1,
				tags: tagsOf({ ...fw, runtime }),
				text: textOf({ ...fw, runtime }),
				sound: runtime === 'fwsc' ? 'fm1' : 'vibefm1',
				soundType: 'firmware',
				runtime,
				editorUrl: fw.editor,
				externalUrl: fw.externalUrl,
				repo: fw.repo,
				available: true,
				description: fw.description,
				code: snippet.code,
				fields: [
					{ name: 'id once installed', value: snippet.name },
					{ name: 'runtime', value: runtime === 'fwsc' ? 'FM-1 .fwsc (fm1-live / fm1-emu)' : 'VIBE FM (.wasm)' },
					...(fw.repo ? [{ name: 'repository', value: fw.repo }] : []),
					...(fw.version ? [{ name: 'version', value: fw.version }] : []),
					...(fw.author ? [{ name: 'author', value: fw.author }] : []),
					...(fw.license ? [{ name: 'license', value: fw.license }] : []),
					...(fw.editor ? [{ name: 'editor', value: fw.editor }] : []),
					{ name: fw.externalUrl ? 'get from' : 'from', value: fw.externalUrl ?? fw.url },
					...(fw.cheat ? [{ name: 'cheat sheet', value: fw.cheat }] : []),
				],
				url: fw.url,
				image: images[id],
			};
		});
	return [...own, ...hardware, ...hub];
}

/** Songs and audio open when picked; everything else is typed at the cursor. */
export const opens = (item: CatalogItem): boolean => item.kind === 'song' || item.kind === 'render';

/** What the build keeps of `@strudel/reference` for a function. See scripts/build.mjs. */
export interface FunctionDoc {
	name: string;
	synonyms?: string[];
	/** Plain text, the HTML of the reference taken out. */
	description: string;
	params?: { name: string; type: string; description: string }[];
	example?: string;
	file?: string;
}

export function functionItem(doc: FunctionDoc): CatalogItem {
	const group = functionGroup(doc.file);
	return {
		id: `fn:${doc.name}`,
		kind: 'function',
		label: doc.name,
		detail: doc.synonyms?.length ? doc.synonyms.join(', ') : undefined,
		category: 'functions',
		place: 'builtin',
		group,
		tags: [`Function/${group}`],
		text: [doc.name, ...(doc.synonyms ?? []), doc.description].join(' ').toLowerCase(),
		insert: doc.name,
		description: doc.description,
		code: doc.example,
		fields: doc.params?.map((param) => ({ name: param.name, value: [param.type, param.description].filter(Boolean).join(': ') })),
	};
}

/** The tags of an item with the ones the user added. */
export function tagsOf(item: CatalogItem, user: UserIndex): string[] {
	const extra = user.items[item.id]?.tags ?? [];
	return extra.length ? [...new Set([...item.tags, ...extra])] : item.tags;
}

export function colorsOf(item: CatalogItem, user: UserIndex): number[] {
	return user.items[item.id]?.colors ?? [];
}

/** Sounds that need a note to make a sound: synths, soundfonts, wavetables, firmwares. */
const PITCHED = new Set(['synth', 'soundfont', 'wavetable', 'firmware']);

/**
 * What insert at the cursor types for a sound: the code that plays it, so a click on
 * insert gives a line that works. `name` is the bare name, which copy gives and which goes
 * in when the cursor is already inside a string.
 *   sample            s("bd"), s("bd:3")
 *   drum machine      s("bd").bank("RolandTR909")
 *   synth, soundfont  note("c3").s("sawtooth")
 */
export function soundCode(item: CatalogItem, index?: number): { code: string; name: string } | undefined {
	if (item.kind !== 'sound' || !item.sound) return undefined;
	const variation = index === undefined ? undefined : (item.variations?.[index] ?? String(index));
	const name = variation === undefined ? item.sound : `${item.sound}:${variation}`;
	if (item.bank) {
		const short = variation === undefined ? item.label : `${item.label}:${variation}`;
		return { code: `s("${short}").bank("${item.bank}")`, name };
	}
	if (PITCHED.has(item.soundType ?? '')) return { code: `note("c3").s("${name}")`, name };
	return { code: `s("${name}")`, name };
}

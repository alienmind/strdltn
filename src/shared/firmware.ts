// Firmwares from an address: `firmware('https://...')` in a song. The extension host uses this to find and cache
// them, the same way it caches `samples('github:...')` packs.

/** Address in the song -> webview URL of its cached copy. Only firmwares that are in the cache. */
export type FirmwareCacheMap = Record<string, string>;

const CALL = /\bfirmware\s*\(/g;
const URL_STRING = /(['"`])(https?:\/\/[^'"`\s]+)\1/g;

/**
 * The addresses a song's `firmware(...)` calls name, in order, without repeats. Both forms count:
 * `firmware('https://...')` and `firmware({ name: 'https://...' })`, also over several lines. A `//` comment does not.
 */
export function findFirmwareUrls(text: string): string[] {
	const code = text
		.split('\n')
		.map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
		.join('\n');
	const urls: string[] = [];
	for (const call of code.matchAll(CALL)) {
		// The call's own parentheses. An address has none, so the first unmatched `)` ends it.
		let depth = 1;
		let end = call.index + call[0].length;
		while (end < code.length && depth > 0) {
			if (code[end] === '(') depth++;
			else if (code[end] === ')') depth--;
			end++;
		}
		const args = code.slice(call.index + call[0].length, end - 1);
		for (const match of args.matchAll(URL_STRING)) urls.push(match[2]);
	}
	return [...new Set(urls)];
}

/** The file name to keep a download under: the last part of the address, or `firmware`. */
export function firmwareFileName(url: string): string {
	const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '');
	return /^[\w.-]+$/.test(name) ? name : 'firmware';
}

/**
 * The id a firmware from an address gets: its file name without the extension and without a `-vibe` ending, so
 * `boom-native-vibe.zip` is `boom-native` and `obervave.wasm` is `obervave`. The engine and the Library both use it.
 */
export function firmwareIdFromUrl(url: string): string {
	const file = url.split(/[?#]/)[0].split('/').pop() ?? '';
	return file
		.replace(/\.[^.]*$/, '')
		.replace(/-vibe$/, '')
		.toLowerCase();
}

/** How an FM-1 synth runs: native VIBE FM `.wasm`, emulated FM-1 hardware `.fwsc` (fm1-emu), or real FM-1 hardware over MIDI. */
export type FirmwareRuntime = 'vibe' | 'fwsc' | 'hardware';

/** A firmware on disk, as the host found it for the Library's FM-1 Synths category. */
export interface InstalledFirmware {
	/** What follows `vibefm1:` (vibe) or `fm1:` (fwsc) in a song, lower case. */
	id: string;
	name: string;
	author?: string;
	version?: string;
	license?: string;
	description?: string;
	/** `vibe` for `.wasm`/`.zip` (default), `fwsc` for real FM-1 `.fwsc` update packages. */
	runtime?: FirmwareRuntime;
	/** `folder`: in a `firmware/` folder of the project. `cache`: downloaded for a song's `firmware(url)`. */
	from: 'folder' | 'cache';
	/** The `.wasm`, `.zip` or `.fwsc`, relative to the workspace, with `/`. */
	path: string;
	/** For a cached one, the address it came from. A song needs `firmware('<url>')` to play it. */
	url?: string;
	/** Optional web editor URL (for example SHRUB or zp12). */
	editor?: string;
}

/** A real FM-1 hardware firmware profile played over desktop MIDI (e.g. SHRUB, FM-1 Stock). */
export interface HardwareFirmwareProfile {
	id: string;
	name: string;
	author: string;
	license: string;
	description: string;
	/** Default MIDI output port substring when no connected FM-1 is detected. */
	defaultPort: string;
	/** Named CC mappings written into `midimaps({ <id>: ... })`. */
	midimap: Record<string, number>;
	/** Companion web editor URL, if one exists. */
	editor?: string;
}

/** Built-in FM-1 hardware MIDI profiles shown alongside VIBE `.wasm` and `.fwsc` firmwares. */
export const HARDWARE_FM1_PROFILES: HardwareFirmwareProfile[] = [
	{
		id: 'shrub',
		name: 'SHRUB (FM-1 Hardware)',
		author: 'Xfer Records',
		license: 'Proprietary (hardware MIDI)',
		description:
			'Xfer SHRUB on a real M-VAVE FM-1 over desktop MIDI (cutoff CC 74, macros CC 16-19). Closed firmware: plays zero-dropout via MIDI; you can also drop your own SHRUB .fwsc in firmware/.',
		defaultPort: 'M-VAVE FM-1',
		midimap: { cutoff: 74, macro1: 16, macro2: 17, macro3: 18, macro4: 19 },
		editor: 'https://shrub.audio/editor/',
	},
	{
		id: 'fm1-stock',
		name: 'M-VAVE FM-1 Stock',
		author: 'M-VAVE',
		license: 'Apache-2.0 (hardware MIDI)',
		description: 'Factory M-VAVE FM-1 firmware over desktop MIDI (cutoff CC 2). Exposes USB audio on the FM-1.',
		defaultPort: 'M-VAVE FM-1',
		midimap: { cutoff: 2 },
	},
];

/** The notes a firmware's snippet plays: a minor seventh, low, so a pad or a bass both say something. */
const NOTES = 'c2 eb2 g2 bb2';

/**
 * What insert at the cursor types for a firmware: a line that plays it, and the bare name for inside a string.
 * The line starts with `$:`: without it, only the last bare pattern of a song plays, so a second instrument would be
 * silent (found in the hand test, 2026-11-24). No `.progNum()`: what a program number means differs per firmware, and a
 * program change reloads a sound.
 */
export function firmwareCode(id: string, runtime: FirmwareRuntime = 'vibe'): { code: string; name: string } {
	if (runtime === 'fwsc') return { code: `$: note("${NOTES}").s("fm1:${id}")`, name: `fm1:${id}` };
	return { code: `$: note("${NOTES}").s("vibefm1:${id}")`, name: `vibefm1:${id}` };
}

/** Snippet for a real FM-1 hardware profile played over desktop MIDI. */
export function hardwareFirmwareCode(profile: HardwareFirmwareProfile, port = profile.defaultPort): { code: string; name: string } {
	const safePort = port.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
	return {
		code: `$${profile.id.replace(/[^a-z0-9_]/gi, '_')}: note("${NOTES}").midi('${safePort}').midimap('${profile.id}')`,
		name: safePort,
	};
}

/** Inserts `midimaps({ <id>: { ... } })` after top header comments when the song does not define that map yet. */
export function midimapLoadEdit(text: string, profile: HardwareFirmwareProfile): { offset: number; text: string } | undefined {
	const id = profile.id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
	if (new RegExp(`(?:^|[{,\\s])(['"]?)${id}\\1\\s*:`).test(text) && /\bmidimaps\s*\(/.test(text)) return undefined;
	const entries = Object.entries(profile.midimap)
		.map(([k, v]) => `${k}: ${v}`)
		.join(', ');
	const line = `midimaps({ '${profile.id}': { ${entries} } })\n`;
	const lines = text.split('\n');
	let at = -1;
	while (at + 1 < lines.length && /^\s*\/\/.*/.test(lines[at + 1])) at++;
	const offset = lines.slice(0, at + 1).reduce((n, l) => n + l.length + 1, 0);
	if (offset > text.length) return { offset: text.length, text: `\n${line}` };
	return { offset, text: line };
}

/** The Playground's list of VIBE FM builds, `play.thefirmwarehub.com/firmware/index.json`. */
export const HUB_INDEX = 'https://play.thefirmwarehub.com/firmware/index.json';
/** The Firmware Hub's full catalog of real FM-1 `.fwsc` firmwares. */
export const HUB_CATALOG = 'https://thefirmwarehub.com/catalog.json';
/** MIT fm1-emu web emulator wasm (github.com/joakimeriksson/fm1-emu), fetched on demand into global storage. */
export const FM1_EMU_WASM_URL = 'https://joakimeriksson.github.io/fm1-emu/fm1_web.wasm';

/** A firmware of the hub's list that can be installed. */
export interface HubFirmware {
	/** The hub's id (`echofield-vibe` or `felucca`). Installed as `firmware/<id>/`. */
	id: string;
	name: string;
	version?: string;
	author?: string;
	license?: string;
	description?: string;
	/** `vibe` for VIBE `.wasm` builds, `fwsc` for real FM-1 `.fwsc` update packages. */
	runtime?: FirmwareRuntime;
	/** The `.wasm` or `.fwsc`, absolute. */
	url: string;
	/** Expected SHA-256 hex digest when `catalog.json` provides one. */
	sha256?: string;
	/** Companion web editor URL, if the firmware has one. */
	editor?: string;
	/** Browser playground/emulator page on the hub, if any. */
	playUrl?: string;
	/** The firmware's cheat sheet, a page on the hub. */
	cheat?: string;
	/** The hub's own order: 0 first. */
	order: number;
}

/**
 * Reads the Playground's `index.json` (fields measured on 2026-11-22, ARCHITECTURE "The hub's catalogs"). Leniently:
 * an entry without an id or a `.wasm` is left out, and unknown fields are ignored.
 */
export function parseHubIndex(json: unknown, base = HUB_INDEX): HubFirmware[] {
	if (!Array.isArray(json)) return [];
	const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
	const list: HubFirmware[] = [];
	for (const entry of json) {
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		const id = text(e.id)?.toLowerCase();
		const file = text(e.file);
		if (!id || !/^[a-z0-9._-]+$/.test(id) || !file || !/\.wasm(\?|$)/.test(file)) continue;
		let url: string;
		try {
			// `file` is relative to the Playground's root (`firmware/<id>.wasm`), not to the list's own folder.
			url = new URL(file, new URL('/', base)).toString();
		} catch {
			continue;
		}
		const cheat = text(e.cheat);
		list.push({
			id,
			name: text(e.name) ?? id.toUpperCase(),
			version: text(e.version),
			author: text(e.author),
			license: text(e.license),
			description: text(e.description),
			runtime: 'vibe',
			url,
			cheat: cheat ? new URL(cheat, new URL('/', base)).toString() : undefined,
			order: typeof e.order === 'number' ? e.order : 50,
		});
	}
	return list;
}

/**
 * Reads `thefirmwarehub.com/catalog.json` (real FM-1 `.fwsc` update packages, ~281 firmwares plus stock).
 * Leniently skips entries without an id or `.fwsc` package.
 */
export function parseHubCatalog(json: unknown, base = HUB_CATALOG): HubFirmware[] {
	if (!json || typeof json !== 'object') return [];
	const root = json as Record<string, unknown>;
	const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
	const list: HubFirmware[] = [];
	const raw = Array.isArray(root.firmwares) ? root.firmwares : [];
	for (let i = 0; i < raw.length; i++) {
		const entry = raw[i];
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		const id = text(e.id)?.toLowerCase();
		const pkg = text(e.pkg);
		if (!id || !/^[a-z0-9._-]+$/.test(id) || !pkg || !/\.fwsc(\?|$)/i.test(pkg)) continue;
		let url: string;
		try {
			url = new URL(pkg, new URL('/', base)).toString();
		} catch {
			continue;
		}
		const cheat = text(e.cheat);
		const editor = text(e.editor);
		const playUrl = text(e.play);
		list.push({
			id,
			name: text(e.name) ?? id.toUpperCase(),
			version: text(e.version),
			author: text(e.author),
			license: text(e.lic) ?? text(e.license),
			description: text(e.what) ?? text(e.description),
			runtime: 'fwsc',
			url,
			sha256: text(e.sha256),
			editor: editor && /^https?:\/\//.test(editor) ? editor : undefined,
			playUrl: playUrl && /^https?:\/\//.test(playUrl) ? playUrl : undefined,
			cheat: cheat ? new URL(cheat, new URL('/', base)).toString() : undefined,
			order: 100 + i,
		});
	}
	return list;
}

/** Normalizes a firmware id for deduplication (`obervave-vibe` and `obervave` refer to the same synth). */
const canonicalId = (id: string) => id.toLowerCase().replace(/-vibe$/, '');

/**
 * Merges VIBE `.wasm` builds and real `.fwsc` firmwares into one catalog: when both exist for the same synth, the
 * lightweight exact-timing VIBE `.wasm` build wins, and `.fwsc` covers all remaining firmwares.
 */
export function mergeHubFirmwares(vibe: HubFirmware[], fwsc: HubFirmware[]): HubFirmware[] {
	const seen = new Set<string>();
	const merged: HubFirmware[] = [];
	for (const fw of vibe) {
		seen.add(canonicalId(fw.id));
		seen.add(canonicalId(firmwareIdFromUrl(fw.url)));
		merged.push({ ...fw, runtime: 'vibe' });
	}
	for (const fw of fwsc) {
		const canon = canonicalId(fw.id);
		if (seen.has(canon)) continue;
		seen.add(canon);
		merged.push({ ...fw, runtime: 'fwsc' });
	}
	return merged;
}

/** The hub's firmwares that are not installed: none whose id, or the id its address gives, is on disk already. */
export function availableFirmware(hub: HubFirmware[], installed: InstalledFirmware[]): HubFirmware[] {
	const have = new Set(installed.flatMap((fw) => [fw.id.toLowerCase(), canonicalId(fw.id)]));
	return hub.filter((fw) => !have.has(fw.id) && !have.has(canonicalId(fw.id)) && !have.has(firmwareIdFromUrl(fw.url)));
}

/**
 * Where a song gets the `firmware('<url>')` line a cached firmware needs, or undefined when the song has it already.
 * After the song's last `firmware(` line, so the loads stay together; else after the comments at the top.
 */
export function firmwareLoadEdit(text: string, url: string): { offset: number; text: string } | undefined {
	if (findFirmwareUrls(text).includes(url)) return undefined;
	const line = `firmware('${url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')\n`;
	const lines = text.split('\n');
	let at = -1;
	lines.forEach((l, i) => {
		if (/^[^/]*\bfirmware\s*\(/.test(l)) at = i;
	});
	if (at < 0) {
		at = -1;
		while (at + 1 < lines.length && /^\s*(\/\/.*)?\r?$/.test(lines[at + 1]) && lines[at + 1].trim()) at++;
	} else {
		// A call over several lines ends at the line that closes it.
		let depth = 0;
		for (let i = at; i < lines.length; i++) {
			for (const c of lines[i].replace(/(^|[^:])\/\/.*$/, '$1')) depth += c === '(' ? 1 : c === ')' ? -1 : 0;
			at = i;
			if (depth <= 0) break;
		}
	}
	const offset = lines.slice(0, at + 1).reduce((n, l) => n + l.length + 1, 0);
	if (offset > text.length) return { offset: text.length, text: `\n${line}` };
	return { offset, text: line };
}

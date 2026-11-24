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

/** A firmware on disk, as the host found it for the Library's Firmware category. */
export interface InstalledFirmware {
	/** What follows `vibefm1:` in a song, lower case. */
	id: string;
	name: string;
	author?: string;
	version?: string;
	license?: string;
	description?: string;
	/** `folder`: in a `firmware/` folder of the project. `cache`: downloaded for a song's `firmware(url)`. */
	from: 'folder' | 'cache';
	/** The `.wasm` or `.zip`, relative to the workspace, with `/`. */
	path: string;
	/** For a cached one, the address it came from. A song needs `firmware('<url>')` to play it. */
	url?: string;
}

/** The notes a firmware's snippet plays: a minor seventh, low, so a pad or a bass both say something. */
const NOTES = 'c2 eb2 g2 bb2';

/**
 * What insert at the cursor types for a firmware: a line that plays it, and the bare name for inside a string.
 * The line starts with `$:`: without it, only the last bare pattern of a song plays, so a second instrument would be
 * silent (found in the hand test, 2026-11-24). No `.progNum()`: what a program number means differs per firmware, and a
 * program change reloads a sound.
 */
export function firmwareCode(id: string): { code: string; name: string } {
	return { code: `$: note("${NOTES}").s("vibefm1:${id}")`, name: `vibefm1:${id}` };
}

/** The Playground's list of VIBE FM builds, `play.thefirmwarehub.com/firmware/index.json`. */
export const HUB_INDEX = 'https://play.thefirmwarehub.com/firmware/index.json';

/** A firmware of the hub's list that can be installed. */
export interface HubFirmware {
	/** The hub's id, `echofield-vibe`. Installed as `firmware/<id>/`, so a song plays it as `vibefm1:<id>`. */
	id: string;
	name: string;
	version?: string;
	author?: string;
	license?: string;
	description?: string;
	/** The `.wasm`, absolute, with the hub's `?v=` stamp. */
	url: string;
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
			url,
			cheat: cheat ? new URL(cheat, new URL('/', base)).toString() : undefined,
			order: typeof e.order === 'number' ? e.order : 50,
		});
	}
	return list;
}

/** The hub's firmwares that are not installed: none whose id, or the id its address gives, is on disk already. */
export function availableFirmware(hub: HubFirmware[], installed: InstalledFirmware[]): HubFirmware[] {
	const have = new Set(installed.map((fw) => fw.id));
	return hub.filter((fw) => !have.has(fw.id) && !have.has(firmwareIdFromUrl(fw.url)));
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

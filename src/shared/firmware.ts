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
		id: 'shrub-midi',
		name: 'SHRUB (FM-1 Hardware MIDI)',
		author: 'Xfer Records',
		license: 'Proprietary (hardware MIDI)',
		description:
			'Play Xfer SHRUB on a real M-VAVE FM-1 over desktop MIDI (cutoff CC 74, macros CC 16-19). Or get SHRUB .fwsc from shrub.audio and click Run Native for 240 MHz JIT emulation.',
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
/** Xfer Records SHRUB official page, direct .fwsc/.wasm downloads, and screen preview image. */
export const SHRUB_HOME = 'https://shrub.audio/';
export const SHRUB_FWSC_URL = 'https://shrub.audio/editor/firmware/SHRUB.fwsc';
export const SHRUB_WASM_URL = 'https://shrub.audio/sim/shrub_sim.wasm';
export const SHRUB_THUMB_URL = 'https://shrub.audio/art/screens/wavetables-in-3d.png';
/** MIT fm1-emu web emulator wasm (github.com/joakimeriksson/fm1-emu), fetched on demand into global storage. */
export const FM1_EMU_WASM_URL = 'https://joakimeriksson.github.io/fm1-emu/fm1_web.wasm';

/**
 * Returns a lightweight remote screen thumbnail URL (~2-7 KB) for an FM-1 synth so previews
 * pre-load immediately without downloading full firmware binaries.
 */
export function firmwareThumbnailUrl(id: string, runtime?: FirmwareRuntime): string | undefined {
	const clean = id.toLowerCase();
	if (clean.includes('shrub')) return SHRUB_THUMB_URL;
	if (clean === 'fm1-stock' || runtime === 'hardware') return undefined;
	const base = clean.replace(/-vibe$/, '');
	if (!/^[a-z0-9._-]+$/.test(base)) return undefined;
	return `https://thefirmwarehub.com/img/w160/${base}.webp`;
}

/** A firmware marketplace repository: official Hub, external vendor page (e.g. SHRUB), or user URL. */
export interface FirmwareRepo {
	id: string;
	name: string;
	/** `index`: VIBE `.wasm` array; `catalog`: `{ firmwares: [...] }` `.fwsc` catalog; `external`: external page; `auto`: detect from URL/JSON. */
	kind: 'index' | 'catalog' | 'external' | 'auto';
	url: string;
	homepage?: string;
	/** Curated entries for `external` repositories (like SHRUB) that open the vendor's website instead of direct-downloading. */
	entries?: HubFirmware[];
}

/** User-configured repository entry in `strdltn.firmware.repositories` (plain URL or `{ name?, url, kind? }`). */
export type CustomFirmwareRepo = string | { name?: string; url: string; kind?: FirmwareRepo['kind'] };

/** A firmware of a repository that can be installed or opened externally. */
export interface HubFirmware {
	/** The firmware's id (`echofield-vibe`, `felucca`, `shrub`). Installed as `firmware/<id>/`. */
	id: string;
	name: string;
	version?: string;
	author?: string;
	license?: string;
	description?: string;
	/** `vibe` for VIBE `.wasm` builds, `fwsc` for real FM-1 `.fwsc` update packages. */
	runtime?: FirmwareRuntime;
	/** The `.wasm`, `.fwsc`, or external page URL, absolute. */
	url: string;
	/** When set, clicking Install / double-clicking opens this external website instead of downloading directly (e.g. SHRUB). */
	externalUrl?: string;
	/** Name of the repository that listed this firmware (e.g. "The Firmware Hub", "shrub.audio"). */
	repo?: string;
	/** Expected SHA-256 hex digest when a catalog provides one. */
	sha256?: string;
	/** Companion web editor URL, if the firmware has one. */
	editor?: string;
	/** Browser playground/emulator page on the hub, if any. */
	playUrl?: string;
	/** The firmware's cheat sheet, a page on the hub. */
	cheat?: string;
	/** Order within its repository: 0 first. */
	order: number;
}

/** Built-in firmware repositories: The Firmware Hub (VIBE + FM-1) and SHRUB (external link to shrub.audio). */
export const DEFAULT_FIRMWARE_REPOS: FirmwareRepo[] = [
	{
		id: 'thefirmwarehub-vibe',
		name: 'The Firmware Hub',
		kind: 'index',
		url: HUB_INDEX,
		homepage: 'https://thefirmwarehub.com/',
	},
	{
		id: 'thefirmwarehub-fwsc',
		name: 'The Firmware Hub',
		kind: 'catalog',
		url: HUB_CATALOG,
		homepage: 'https://thefirmwarehub.com/',
	},
	{
		id: 'shrub-audio',
		name: 'shrub.audio',
		kind: 'external',
		url: SHRUB_HOME,
		homepage: SHRUB_HOME,
		entries: [
			{
				id: 'shrub-wasm',
				name: 'SHRUB (WASM)',
				author: 'Xfer Records',
				license: 'Proprietary (from shrub.audio)',
				description:
					'Xfer Records SHRUB compiled natively to WebAssembly (~1% CPU, zero dropouts, live screen & Devices panel on desktop & Codespaces). Click Install to download directly from shrub.audio without a browser.',
				runtime: 'vibe',
				url: SHRUB_WASM_URL,
				repo: 'shrub.audio',
				editor: 'https://shrub.audio/editor/',
				order: 0,
			},
			{
				id: 'shrub',
				name: 'SHRUB',
				author: 'Xfer Records',
				license: 'Proprietary (from shrub.audio)',
				description:
					'Xfer Records wavetable synth firmware (.fwsc) for M-VAVE FM-1 hardware. Click Install to download SHRUB.fwsc directly from shrub.audio into firmware/, or click Run Native for 240 MHz JIT emulation.',
				runtime: 'fwsc',
				url: SHRUB_FWSC_URL,
				repo: 'shrub.audio',
				editor: 'https://shrub.audio/editor/',
				order: 1,
			},
		],
	},
];

/** Normalizes user-configured `strdltn.firmware.repositories` entries into `FirmwareRepo` descriptors. */
export function parseCustomRepos(entries: unknown): FirmwareRepo[] {
	if (!Array.isArray(entries)) return [];
	const out: FirmwareRepo[] = [];
	const seen = new Set<string>();
	for (const raw of entries) {
		const url = typeof raw === 'string' ? raw.trim() : raw && typeof raw === 'object' && typeof (raw as { url?: unknown }).url === 'string' ? (raw as { url: string }).url.trim() : '';
		if (!url || !/^https?:\/\//i.test(url)) continue;
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			continue;
		}
		if (seen.has(parsed.href)) continue;
		seen.add(parsed.href);
		const customName = raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string' ? (raw as { name: string }).name.trim() : '';
		const customKind = raw && typeof raw === 'object' ? (raw as { kind?: FirmwareRepo['kind'] }).kind : undefined;
		const name = customName || parsed.hostname.replace(/^www\./, '');
		const kind: FirmwareRepo['kind'] =
			customKind && ['index', 'catalog', 'external', 'auto'].includes(customKind)
				? customKind
				: /\.json(\?|$)/i.test(parsed.pathname)
					? 'auto'
					: /\.(wasm|fwsc)(\?|$)/i.test(parsed.pathname)
						? 'auto'
						: 'external';
		const id = `custom-${parsed.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${out.length + 1}`;
		out.push({ id, name, kind, url: parsed.href, homepage: `${parsed.origin}/` });
	}
	return out;
}

/**
 * Turns a single direct `.wasm`, `.fwsc`, or external web page URL repo into a marketplace entry, or parses a
 * JSON repository (supporting VIBE `index.json`, Firmware Hub `catalog.json`, or a `{ entries: [...] }` list).
 */
export function parseRepoPayload(repo: FirmwareRepo, json?: unknown): HubFirmware[] {
	if (repo.entries?.length) return repo.entries.map((e) => ({ ...e, repo: e.repo ?? repo.name }));
	if (json !== undefined) {
		if (repo.kind === 'index' || Array.isArray(json)) return parseHubIndex(json, repo.url, repo.name);
		if (repo.kind === 'catalog' || (json && typeof json === 'object' && 'firmwares' in (json as object))) {
			return parseHubCatalog(json, repo.url, repo.name);
		}
		if (json && typeof json === 'object' && Array.isArray((json as { entries?: unknown[] }).entries)) {
			return parseHubCatalog({ firmwares: (json as { entries: unknown[] }).entries }, repo.url, repo.name);
		}
	}
	if (/\.wasm(\?|$)/i.test(repo.url)) {
		const id = firmwareIdFromUrl(repo.url) || repo.id;
		return [{ id, name: repo.name || id.toUpperCase(), runtime: 'vibe', url: repo.url, repo: repo.name, order: 50 }];
	}
	if (/\.fwsc(\?|$)/i.test(repo.url)) {
		const id = firmwareIdFromUrl(repo.url) || repo.id;
		return [{ id, name: repo.name || id.toUpperCase(), runtime: 'fwsc', url: repo.url, repo: repo.name, order: 100 }];
	}
	if (repo.kind === 'external') {
		const hostId = repo.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || repo.id;
		return [
			{
				id: hostId,
				name: repo.name,
				description: `External FM-1 firmware repository: ${repo.url}. Open the page to download, then place the file in firmware/.`,
				runtime: 'fwsc',
				url: repo.url,
				externalUrl: repo.url,
				repo: repo.name,
				order: 20,
			},
		];
	}
	return [];
}

/**
 * Reads the Playground's `index.json` (fields measured on 2026-11-22, ARCHITECTURE "The hub's catalogs"). Leniently:
 * an entry without an id or a `.wasm` is left out, and unknown fields are ignored.
 */
export function parseHubIndex(json: unknown, base = HUB_INDEX, repo = 'The Firmware Hub'): HubFirmware[] {
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
			repo,
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
export function parseHubCatalog(json: unknown, base = HUB_CATALOG, repo = 'The Firmware Hub'): HubFirmware[] {
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
		const externalUrl = text(e.externalUrl) ?? text(e.page);
		const hasPkg = !!pkg && /\.fwsc(\?|$)/i.test(pkg);
		const hasExt = !!externalUrl && /^https?:\/\//i.test(externalUrl);
		if (!id || !/^[a-z0-9._-]+$/.test(id) || (!hasPkg && !hasExt)) continue;
		let url: string;
		try {
			url = hasPkg ? new URL(pkg!, new URL('/', base)).toString() : externalUrl!;
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
			...(hasExt && !hasPkg ? { externalUrl } : {}),
			repo,
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

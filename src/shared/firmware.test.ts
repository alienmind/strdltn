// Cases for finding `firmware(...)` addresses in a song. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	availableFirmware,
	DEFAULT_FIRMWARE_REPOS,
	findFirmwareUrls,
	firmwareCode,
	firmwareFileName,
	firmwareIdFromUrl,
	firmwareLoadEdit,
	firmwareThumbnailUrl,
	HARDWARE_FM1_PROFILES,
	hardwareFirmwareCode,
	mergeHubFirmwares,
	midimapLoadEdit,
	parseCustomRepos,
	parseHubCatalog,
	parseHubIndex,
	parseRepoPayload,
	SHRUB_FWSC_URL,
	SHRUB_THUMB_URL,
	SHRUB_WASM_URL,
} from './firmware.ts';

const A = 'https://raw.githubusercontent.com/Vibe-FM-SDK/vibe-fm-sdk/main/firmwares/obervave.wasm';
const B = 'https://thefirmwarehub.com/fw/vibe/boom-native-vibe.zip';

test('one address', () => {
	assert.deepEqual(findFirmwareUrls(`firmware('${A}')\n$a: s("vibefm1")`), [A]);
});

test('a map over several lines, with every kind of quote', () => {
	const song = `firmware({\n  obervave: "${A}",\n  boom: \`${B}\`,\n})`;
	assert.deepEqual(findFirmwareUrls(song), [A, B]);
});

test('a commented line or a trailing comment does not count, the address itself keeps its //', () => {
	const song = `// firmware('${B}')\nfirmware({\n  obervave: '${A}', // the synth\n  // boom: '${B}',\n})`;
	assert.deepEqual(findFirmwareUrls(song), [A]);
});

test('repeats once, and only inside firmware(...)', () => {
	const song = `samples('${B}')\nfirmware('${A}')\nfirmware('${A}')`;
	assert.deepEqual(findFirmwareUrls(song), [A]);
});

test('file names for the cache', () => {
	assert.equal(firmwareFileName(A), 'obervave.wasm');
	assert.equal(firmwareFileName(`${B}?v=2`), 'boom-native-vibe.zip');
	assert.equal(firmwareFileName('https://example.com/'), 'firmware');
	assert.equal(firmwareFileName('https://example.com/a%20b.wasm'), 'firmware');
});

test('the id of a firmware from an address', () => {
	assert.equal(firmwareIdFromUrl(A), 'obervave');
	assert.equal(firmwareIdFromUrl(`${B}?v=2`), 'boom-native');
	assert.equal(firmwareIdFromUrl('https://example.com/ECHOFIELD-vibe.wasm#x'), 'echofield');
});

test('the snippet of a firmware', () => {
	// With $:, or only the song's last bare pattern would play (hand test, 2026-11-24).
	assert.deepEqual(firmwareCode('obervave'), { code: '$: note("c2 eb2 g2 bb2").s("vibefm1:obervave")', name: 'vibefm1:obervave' });
});

const insertAt = (text: string, edit: { offset: number; text: string } | undefined) => (edit ? text.slice(0, edit.offset) + edit.text + text.slice(edit.offset) : text);

test('the load line goes after the comments at the top', () => {
	const song = '// @title test\n// by me\n\nsetcps(0.5)\n$: s("bd")';
	assert.equal(insertAt(song, firmwareLoadEdit(song, A)), `// @title test\n// by me\nfirmware('${A}')\n\nsetcps(0.5)\n$: s("bd")`);
});

test('the load line goes at the start of a song without comments', () => {
	assert.equal(insertAt('$: s("bd")', firmwareLoadEdit('$: s("bd")', A)), `firmware('${A}')\n$: s("bd")`);
	assert.equal(insertAt('', firmwareLoadEdit('', A)), `firmware('${A}')\n`);
});

test('the load line goes after the last firmware call, also one over several lines', () => {
	const song = `// x\nfirmware({\n  boom: '${B}',\n})\n$: s("bd")`;
	assert.equal(insertAt(song, firmwareLoadEdit(song, A)), `// x\nfirmware({\n  boom: '${B}',\n})\nfirmware('${A}')\n$: s("bd")`);
	const guarded = `typeof firmware !== 'undefined' && firmware('${B}')\n$: s("bd")`;
	assert.equal(insertAt(guarded, firmwareLoadEdit(guarded, A)), `typeof firmware !== 'undefined' && firmware('${B}')\nfirmware('${A}')\n$: s("bd")`);
});

test('no load line when the song loads the firmware already, but a commented one does not count', () => {
	assert.equal(firmwareLoadEdit(`firmware('${A}')\n$: s("bd")`, A), undefined);
	const commented = `// firmware('${A}')\n$: s("bd")`;
	assert.equal(insertAt(commented, firmwareLoadEdit(commented, A)), `// firmware('${A}')\nfirmware('${A}')\n$: s("bd")`);
});

test('a quote in an address is escaped', () => {
	assert.equal(firmwareLoadEdit('', "https://example.com/it's.wasm")?.text, "firmware('https://example.com/it\\'s.wasm')\n");
});

// Two entries as index.json had them on 2026-11-22, and the kinds of broken ones a lenient reader skips.
const INDEX = [
	{ id: 'echofield-vibe', file: 'firmware/echofield-vibe.wasm?v=20261114133610', name: 'ECHOFIELD', version: '1.0.0', author: 'PhilipsKnobs', description: 'A granular instrument', license: 'MIT', order: 50, stage: { w: 960, h: 540 } },
	{ id: 'obervave', file: 'firmware/obervave.wasm?v=20261113121501', name: 'OBERVAVE', version: '3.9', author: 'zvenson', license: 'GPL-3.0', order: 0, cheat: 'firmware/obervave.cheat.html' },
	{ id: 'valve', file: 'firmware/valve.wasm', name: 'VALVE', order: 2 },
	{ id: 'no-file', name: 'X' },
	{ id: 'bad id!', file: 'firmware/x.wasm' },
	{ id: 'fwsc', file: 'firmware/x.fwsc' },
	null,
];

test('the hub list: addresses made absolute, missing fields left out, broken entries skipped', () => {
	const list = parseHubIndex(INDEX);
	assert.deepEqual(list.map((f) => f.id), ['echofield-vibe', 'obervave', 'valve']);
	assert.equal(list[0].url, 'https://play.thefirmwarehub.com/firmware/echofield-vibe.wasm?v=20261114133610');
	assert.equal(list[1].cheat, 'https://play.thefirmwarehub.com/firmware/obervave.cheat.html');
	assert.equal(list[2].license, undefined);
	assert.deepEqual(parseHubIndex({ not: 'a list' }), []);
});

test('Available leaves out what is installed, by the hub id or by the id its address gives', () => {
	const hub = parseHubIndex(INDEX);
	const installed = [
		{ id: 'obervave', name: 'OBERVAVE', from: 'cache' as const, path: 'x' },
		{ id: 'echofield-vibe', name: 'ECHOFIELD', from: 'folder' as const, path: 'firmware/echofield-vibe/echofield-vibe.wasm' },
	];
	assert.deepEqual(availableFirmware(hub, installed).map((f) => f.id), ['valve']);
	assert.deepEqual(availableFirmware(hub, [{ id: 'echofield', name: 'E', from: 'cache', path: 'x' }]).map((f) => f.id), ['obervave', 'valve']);
});

test('firmwareCode switches instrument prefix by runtime', () => {
	assert.deepEqual(firmwareCode('felucca', 'fwsc'), { code: '$: note("c2 eb2 g2 bb2").s("fm1:felucca")', name: 'fm1:felucca' });
});

test('parseHubCatalog reads real FM-1 .fwsc packages and skips invalid entries', () => {
	const list = parseHubCatalog({
		firmwares: [
			{
				id: 'felucca',
				name: 'Felucca',
				version: '1.8.2',
				author: 'foo',
				lic: 'GPL-3.0',
				what: 'Wavetable synth',
				pkg: 'https://github.com/foo/felucca/releases/download/v1.8.2/felucca.fwsc',
				sha256: 'abc123',
				editor: 'https://example.com/editor',
			},
			{ id: 'obervave', name: 'OberVave', pkg: 'fw/obervave.fwsc' },
			{ id: 'not-fwsc', pkg: 'fw/other.zip' },
			{ id: 'bad id!', pkg: 'fw/bad.fwsc' },
		],
	});
	assert.deepEqual(list.map((f) => f.id), ['felucca', 'obervave']);
	assert.equal(list[0].runtime, 'fwsc');
	assert.equal(list[0].license, 'GPL-3.0');
	assert.equal(list[0].description, 'Wavetable synth');
	assert.equal(list[0].sha256, 'abc123');
	assert.equal(list[0].editor, 'https://example.com/editor');
	assert.equal(list[1].url, 'https://thefirmwarehub.com/fw/obervave.fwsc');
});

test('mergeHubFirmwares prefers VIBE .wasm over .fwsc when both exist for the same synth', () => {
	const vibe = parseHubIndex(INDEX);
	const fwsc = parseHubCatalog({
		firmwares: [
			{ id: 'obervave', name: 'OberVave FWSC', pkg: 'fw/obervave.fwsc' },
			{ id: 'echofield', name: 'Echofield FWSC', pkg: 'fw/echofield.fwsc' },
			{ id: 'felucca', name: 'Felucca', pkg: 'fw/felucca.fwsc' },
		],
	});
	const merged = mergeHubFirmwares(vibe, fwsc);
	assert.deepEqual(
		merged.map((f) => `${f.id}:${f.runtime}`),
		['echofield-vibe:vibe', 'obervave:vibe', 'valve:vibe', 'felucca:fwsc'],
	);
});

test('hardwareFirmwareCode and midimapLoadEdit generate and deduplicate MIDI profile lines', () => {
	const shrub = HARDWARE_FM1_PROFILES.find((p) => p.id === 'shrub-midi')!;
	assert.deepEqual(hardwareFirmwareCode(shrub, 'M-VAVE FM-1 0'), {
		code: `$shrub_midi: note("c2 eb2 g2 bb2").midi('M-VAVE FM-1 0').midimap('shrub-midi')`,
		name: 'M-VAVE FM-1 0',
	});
	const song = '// @title jam\n$: s("bd")';
	const edit = midimapLoadEdit(song, shrub);
	assert.ok(edit);
	const withMap = insertAt(song, edit);
	assert.equal(withMap, `// @title jam\nmidimaps({ 'shrub-midi': { cutoff: 74, macro1: 16, macro2: 17, macro3: 18, macro4: 19 } })\n$: s("bd")`);
	assert.equal(midimapLoadEdit(withMap, shrub), undefined);
});

test('built-in repositories include The Firmware Hub and direct-download SHRUB (WASM & FWSC) from shrub.audio', () => {
	const shrubRepo = DEFAULT_FIRMWARE_REPOS.find((r) => r.id === 'shrub-audio');
	assert.ok(shrubRepo);
	const entries = parseRepoPayload(shrubRepo);
	assert.equal(entries.length, 2);
	assert.equal(entries[0].id, 'shrub-wasm');
	assert.equal(entries[0].runtime, 'vibe');
	assert.equal(entries[0].url, SHRUB_WASM_URL);
	assert.equal(entries[0].externalUrl, undefined);
	assert.equal(entries[1].id, 'shrub');
	assert.equal(entries[1].runtime, 'fwsc');
	assert.equal(entries[1].url, SHRUB_FWSC_URL);
	assert.equal(entries[1].externalUrl, undefined);
	assert.equal(entries[1].editor, 'https://shrub.audio/editor/');
	assert.equal(entries[1].repo, 'shrub.audio');
});

test('firmwareThumbnailUrl resolves lightweight Hub and SHRUB screen thumbnails', () => {
	assert.equal(firmwareThumbnailUrl('shrub-wasm', 'vibe'), SHRUB_THUMB_URL);
	assert.equal(firmwareThumbnailUrl('shrub', 'fwsc'), SHRUB_THUMB_URL);
	assert.equal(firmwareThumbnailUrl('shrub-midi', 'hardware'), SHRUB_THUMB_URL);
	assert.equal(firmwareThumbnailUrl('fm1-stock', 'hardware'), undefined);
	assert.equal(firmwareThumbnailUrl('felucca', 'fwsc'), 'https://thefirmwarehub.com/img/w160/felucca.webp');
	assert.equal(firmwareThumbnailUrl('echofield-vibe', 'vibe'), 'https://thefirmwarehub.com/img/w160/echofield.webp');
});

test('parseCustomRepos and parseRepoPayload handle JSON catalogs, direct firmware URLs, and external pages', () => {
	const repos = parseCustomRepos([
		'https://example.com/my-catalog.json',
		{ name: 'Cool Synth', url: 'https://coolsynth.audio/' },
		'https://cdn.example.com/custom-vibe.wasm',
		'not-a-url',
	]);
	assert.equal(repos.length, 3);
	assert.equal(repos[0].kind, 'auto');
	assert.equal(repos[1].kind, 'external');
	assert.equal(repos[1].name, 'Cool Synth');
	const extEntries = parseRepoPayload(repos[1]);
	assert.equal(extEntries[0].externalUrl, 'https://coolsynth.audio/');
	assert.equal(extEntries[0].repo, 'Cool Synth');
	const wasmEntries = parseRepoPayload(repos[2]);
	assert.equal(wasmEntries[0].runtime, 'vibe');
	assert.equal(wasmEntries[0].id, 'custom');
});

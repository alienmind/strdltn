// Cases for finding `firmware(...)` addresses in a song. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableFirmware, findFirmwareUrls, firmwareCode, firmwareFileName, firmwareIdFromUrl, firmwareLoadEdit, parseHubIndex } from './firmware.ts';

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

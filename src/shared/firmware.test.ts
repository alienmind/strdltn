// Cases for finding `firmware(...)` addresses in a song. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFirmwareUrls, firmwareCode, firmwareFileName, firmwareIdFromUrl, firmwareLoadEdit } from './firmware.ts';

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
	assert.deepEqual(firmwareCode('obervave'), { code: 'note("c2 eb2 g2 bb2").s("vibefm1:obervave")', name: 'vibefm1:obervave' });
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

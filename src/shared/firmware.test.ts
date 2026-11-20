// Cases for finding `firmware(...)` addresses in a song. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFirmwareUrls, firmwareFileName } from './firmware.ts';

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { findZipBinaryEntry, FM1_NATIVE_VERSION, isShrubFileName, nativeFm1Args, nativeTargetFor } from './nativeFm1.ts';

test('resolves official fm1-emu native release targets for Windows, macOS arm64, and Linux', () => {
	const win = nativeTargetFor('win32', 'x64');
	assert.ok(win);
	assert.equal(win.binary, 'fm1-live.exe');
	assert.equal(win.archive, 'zip');
	assert.equal(win.usbMidi, false);
	assert.ok(win.url.includes(`v${FM1_NATIVE_VERSION}/fm1-emu-${FM1_NATIVE_VERSION}-windows-x86_64.zip`));

	const mac = nativeTargetFor('darwin', 'arm64');
	assert.ok(mac);
	assert.equal(mac.binary, 'fm1-live');
	assert.equal(mac.archive, 'tar.gz');
	assert.equal(mac.usbMidi, true);

	assert.equal(nativeTargetFor('linux', 'x64')?.binary, 'fm1-live');
	assert.equal(nativeTargetFor('linux', 'arm64')?.binary, 'fm1-live');
	assert.equal(nativeTargetFor('darwin', 'x64'), undefined);
});

test('builds fm1-live CLI arguments with flash persistence and optional USB MIDI', () => {
	assert.deepEqual(nativeFm1Args('/fw/SHRUB.fwsc'), ['--fwsc', '/fw/SHRUB.fwsc']);
	assert.deepEqual(nativeFm1Args('/fw/SHRUB.fwsc', { flashPath: '/flash/shrub.bin', usb: true, midi: 'loopMIDI' }), [
		'--fwsc',
		'/fw/SHRUB.fwsc',
		'--flash',
		'/flash/shrub.bin',
		'--usb',
		'--midi',
		'loopMIDI',
	]);
});

test('recognizes user SHRUB .fwsc file names', () => {
	assert.equal(isShrubFileName('SHRUB-V1.11.fwsc'), true);
	assert.equal(isShrubFileName('shrub.fwsc'), true);
	assert.equal(isShrubFileName('felucca.fwsc'), false);
	assert.equal(isShrubFileName('shrub.wasm'), false);
});

test('findZipBinaryEntry matches Windows backslash paths, POSIX paths, and bare names', () => {
	const win = {
		'fm1-emu-0.5.1-windows-x86_64\\fm1-emu.exe': 'emu',
		'fm1-emu-0.5.1-windows-x86_64\\fm1-live.exe': 'live',
	};
	assert.deepEqual(findZipBinaryEntry(win, 'fm1-live.exe'), ['fm1-emu-0.5.1-windows-x86_64\\fm1-live.exe', 'live']);
	assert.deepEqual(findZipBinaryEntry({ 'dir/FM1-LIVE.EXE': 'live' }, 'fm1-live.exe'), ['dir/FM1-LIVE.EXE', 'live']);
	assert.deepEqual(findZipBinaryEntry({ 'fm1-live.exe': 'live' }, 'fm1-live.exe'), ['fm1-live.exe', 'live']);
	assert.equal(findZipBinaryEntry({ 'dir/other.exe': 'x' }, 'fm1-live.exe'), undefined);
});

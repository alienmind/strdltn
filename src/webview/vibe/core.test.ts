// Cases for the firmware host in core.ts. Run with `pnpm test:unit`.
// A real firmware is GPL-3.0 and 800 KB, so these tests build a tiny one byte by byte. It has the five exports a host
// needs. Its vibe_wasm_event keeps the last packed MIDI message at address 0; its vibe_wasm_audio counts its calls at
// address 8 and writes that MIDI value, as a float, into every frame of OUT L.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VibeCore } from './core.ts';

const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]) => [...uleb(items.length), ...items.flat()];
const name = (s: string) => [...uleb(s.length), ...[...s].map((c) => c.charCodeAt(0))];
function uleb(n: number): number[] {
	const out: number[] = [];
	do {
		let b = n & 127;
		n >>>= 7;
		if (n) b |= 128;
		out.push(b);
	} while (n);
	return out;
}
const fn = (locals: number[], code: number[]) => {
	const body = [...locals, ...code, 0x0b];
	return [...uleb(body.length), ...body];
};
const I32 = 0x7f;
const F32 = 0x7d;

function tinyFirmware(): WebAssembly.Module {
	const types = vec([
		[0x60, 0, 1, I32], // () -> i32
		[0x60, 1, F32, 0], // (f32) -> ()
		[0x60, 5, I32, I32, I32, F32, I32, 0], // vibe_wasm_event
		[0x60, 2, I32, I32, 0], // vibe_wasm_audio
	]);
	const funcs = vec([[0], [1], [0], [2], [3]]);
	const memory = vec([[0x00, 1]]);
	const exports = vec([
		[...name('memory'), 0x02, 0],
		[...name('vibe_sdk_version'), 0x00, 0],
		[...name('vibe_wasm_init'), 0x00, 1],
		[...name('vibe_wasm_io'), 0x00, 2],
		[...name('vibe_wasm_event'), 0x00, 3],
		[...name('vibe_wasm_audio'), 0x00, 4],
	]);
	const code = vec([
		fn([0], [0x41, 7]), // version 7
		fn([0], []),
		fn([0], [0x41, 0x80, 0x08]), // io at 1024: OUT L is at 1024 + 256 * 4 = 2048
		fn([0], [0x41, 0, 0x20, 4, 0x36, 2, 0]), // mem[0] = midi
		fn(
			[1, 1, I32],
			[
				0x41, 8, 0x41, 8, 0x28, 2, 0, 0x41, 1, 0x6a, 0x36, 2, 0, // mem[8] += 1
				0x02, 0x40, 0x03, 0x40, // block, loop
				0x20, 2, 0x20, 0, 0x4f, 0x0d, 1, // i >= frames -> out
				0x20, 2, 0x41, 2, 0x74, 0x41, 0x80, 0x10, 0x6a, // 2048 + i * 4
				0x41, 0, 0x28, 2, 0, 0xb3, 0x38, 2, 0, // = f32(mem[0])
				0x20, 2, 0x41, 1, 0x6a, 0x21, 2, 0x0c, 0, // i++, again
				0x0b, 0x0b,
			],
		),
	]);
	const bytes = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, types), ...section(3, funcs), ...section(5, memory), ...section(7, exports), ...section(10, code)];
	return new WebAssembly.Module(new Uint8Array(bytes));
}

const noteOn = 0x90 | (60 << 8) | (100 << 16);
const calls = (core: VibeCore) => new Int32Array((core as any).x.memory.buffer, 8, 1)[0];

test('a note starts on its own frame, inside a block', () => {
	const core = new VibeCore(tinyFirmware(), 48000);
	const l = new Float32Array(128);
	const r = new Float32Array(128);
	core.render(l, r);
	core.schedule({ frame: 128 + 100, kind: 'midi', status: 0x90, d1: 60, d2: 100 });
	core.render(l, r);
	assert.equal(l[99], 0);
	assert.equal(l[100], noteOn);
	assert.equal(l[127], noteOn);
	assert.equal(core.frame, 256);
	assert.equal(calls(core), 3, 'one call for the first block, two for the split one');
});

test('a late event plays at the start of the next block', () => {
	const core = new VibeCore(tinyFirmware(), 48000);
	const l = new Float32Array(128);
	core.render(l, new Float32Array(128));
	core.schedule({ frame: 5, kind: 'midi', status: 0x90, d1: 60, d2: 100 });
	core.render(l, new Float32Array(128));
	assert.equal(l[0], noteOn);
	assert.equal(calls(core), 2);
});

test('events keep their order, also when queued out of order', () => {
	const core = new VibeCore(tinyFirmware(), 48000);
	const l = new Float32Array(128);
	core.schedule({ frame: 64, kind: 'midi', status: 0x80, d1: 60, d2: 0 });
	core.schedule({ frame: 32, kind: 'midi', status: 0x90, d1: 60, d2: 100 });
	core.render(l, new Float32Array(128));
	assert.equal(l[31], 0);
	assert.equal(l[32], noteOn);
	assert.equal(l[64], 0x80 | (60 << 8));
	assert.equal(calls(core), 3);
});

test('a block longer than 256 frames is cut into calls the SDK allows', () => {
	const core = new VibeCore(tinyFirmware(), 48000);
	core.render(new Float32Array(600), new Float32Array(600));
	assert.equal(calls(core), 3);
	assert.equal(core.frame, 600);
});

test('stop drops what was queued and ends the notes that sound', () => {
	const core = new VibeCore(tinyFirmware(), 48000);
	const l = new Float32Array(128);
	core.schedule({ frame: 10, kind: 'midi', status: 0x91, d1: 62, d2: 90 });
	core.schedule({ frame: 200, kind: 'midi', status: 0x90, d1: 60, d2: 100 });
	core.render(l, new Float32Array(128));
	core.stop();
	core.render(l, new Float32Array(128));
	assert.equal(l[0], 0x81 | (62 << 8), 'the note on channel 2 ends at the start of the block');
	assert.equal(l[72], 0x81 | (62 << 8), 'the queued note never starts');
});

test('a firmware for a host protocol we do not know is refused', () => {
	const mod = tinyFirmware();
	const real = WebAssembly.Instance;
	// Swap the version for 99 by wrapping the instance's exports.
	(globalThis as any).WebAssembly.Instance = function (m: WebAssembly.Module, imports: WebAssembly.Imports) {
		const inst = new real(m, imports);
		return { exports: { ...inst.exports, vibe_sdk_version: () => 99 } };
	};
	try {
		assert.throws(() => new VibeCore(mod, 48000), /protocol 99/);
	} finally {
		(globalThis as any).WebAssembly.Instance = real;
	}
});

test('auto-detects ss_* native WASM builds (e.g. SHRUB WASM) inside VibeCore', () => {
	// Build a minimal valid WASM module exporting ss_boot, ss_render, ss_midi, ss_flash, ss_master, ss_running, ss_lcd, memory.
	const types = vec([
		[0x60, 0, 1, I32], // () -> i32
		[0x60, 1, I32, 0], // (i32) -> ()
		[0x60, 1, I32, 1, I32], // (i32) -> i32
		[0x60, 3, I32, I32, I32, 0], // (i32, i32, i32) -> ()
	]);
	const funcs = vec([[0], [1], [1], [0], [2], [3], [0]]);
	const memory = vec([[0x00, 4]]);
	const exports = vec([
		[...name('memory'), 0x02, 0],
		[...name('ss_flash'), 0x00, 0],
		[...name('ss_master'), 0x00, 1],
		[...name('ss_boot'), 0x00, 2],
		[...name('ss_running'), 0x00, 3],
		[...name('ss_render'), 0x00, 4],
		[...name('ss_midi'), 0x00, 5],
		[...name('ss_lcd'), 0x00, 6],
	]);
	const code = vec([
		fn([0], [0x41, 0]), // ss_flash -> 0
		fn([0], []), // ss_master
		fn([0], []), // ss_boot
		fn([0], [0x41, 1]), // ss_running -> 1
		fn([0], [0x41, 0x80, 0x08]), // ss_render -> 1024 (interleaved f32 buffer)
		fn([0], [0x41, 0, 0x20, 1, 0x36, 2, 0]), // ss_midi -> mem[0] = d1 (note)
		fn([0], [0x41, 0x80, 0x20]), // ss_lcd -> 4096 (240*240*2 bytes)
	]);
	const mod = new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, types), ...section(3, funcs), ...section(5, memory), ...section(7, exports), ...section(10, code)]));
	const core = new VibeCore(mod, 48000);
	assert.equal(core.params.length, 6);
	assert.equal(core.paramValue(0), 900);
	core.schedule({ frame: 0, kind: 'midi', status: 0x90, d1: 60, d2: 100 });
	core.schedule({ frame: 0, kind: 'param', index: 1, value: 42 });
	const l = new Float32Array(128);
	const r = new Float32Array(128);
	core.render(l, r);
	assert.equal(core.paramValue(1), 42);
	const lcd = core.draw();
	assert.equal(lcd?.length, 480 * 320);
});

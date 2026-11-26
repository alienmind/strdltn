// A worker thread that runs one firmware for a moment, without sound, and gives back a PNG of its display: the picture
// on a row of the Library's FM-1 Synths. A thread of its own, because a firmware is somebody else's code: one that loops
// for ever or eats memory must not stop the extension host. FirmwarePreviews ends the thread when it takes too long.
import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync } from 'fflate';
import { VIBE_SCREEN, VibeCore } from '../webview/vibe/core';
import { rgb565ToPng } from './png';

const RATE = 48000;
const BLOCK = 128;
/** How long the firmware runs before the picture: past most splash screens. Measured with OBERVAVE: its first frame that is not blank comes at 64 ms. */
const SECONDS = 1.5;

function wasmOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const magic = String.fromCharCode(...bytes.subarray(0, 4));
	if (magic === '\0asm') return bytes as Uint8Array<ArrayBuffer>;
	if (magic.startsWith('PK')) {
		const files = unzipSync(bytes, { filter: (f) => f.name.endsWith('.wasm') && !f.name.endsWith('.aot.wasm') });
		const name = Object.keys(files).sort()[0];
		if (name) return files[name] as Uint8Array<ArrayBuffer>;
	}
	throw new Error('no .wasm in the file');
}

/** A frame of one colour only is a screen not drawn yet. */
const flat = (px: Uint16Array) => px.every((v) => v === px[0]);

async function picture(bytes: Uint8Array): Promise<Uint8Array> {
	const module = await WebAssembly.compile(wasmOf(bytes));
	const core = new VibeCore(module, RATE);
	const left = new Float32Array(BLOCK);
	const right = new Float32Array(BLOCK);
	let best: Uint16Array | undefined;
	const blocks = Math.round((SECONDS * RATE) / BLOCK);
	for (let i = 1; i <= blocks; i++) {
		core.render(left, right);
		if (i % 37 !== 0 && i !== blocks) continue;
		const px = core.draw();
		if (!px) throw new Error('this firmware draws no display');
		if (!flat(px)) best = px;
	}
	if (!best) throw new Error('the display stayed empty');
	return rgb565ToPng(best, VIBE_SCREEN.w, VIBE_SCREEN.h);
}

picture(workerData as Uint8Array).then(
	(png) => parentPort!.postMessage({ png }),
	(error: Error) => parentPort!.postMessage({ error: error.message }),
);

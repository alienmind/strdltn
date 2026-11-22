// The MIDI worker thread of the extension host: owns every MIDI port, keeps the events in a
// queue ordered by time and sends each one on time. Bundled as dist/midi-worker.cjs; the
// native module's binaries are copied to dist/prebuilds/ by the build, where the bundled
// loader of @julusian/midi looks for them.
//
// Measured in spike S5 ("MIDI" in doc/ARCHITECTURE.md): `Atomics.wait` sleeps in steps of
// Windows' 15.6 ms timer tick, so the worker sleeps to SPIN_MS before an event and spins
// from there. A WinMM port can be open once only, so this thread is the one owner.
import { Input, Output } from '@julusian/midi';
import { parentPort } from 'node:worker_threads';
import { epochNow, findPort, MidiQueue, type MidiEvent, type MidiOut, type MidiPorts } from '../shared/midi';

/** Host -> worker. */
export type ToMidiWorker =
	| { type: 'send'; source: string; events: MidiOut[] }
	| { type: 'listen'; port: string }
	| { type: 'panic'; source?: string }
	| { type: 'stats' };

/** Worker -> host. */
export type FromMidiWorker =
	| { type: 'ports'; ports: MidiPorts }
	| { type: 'input'; port: string; bytes: number[]; at: number }
	| { type: 'stats'; sent: number; late: { p50: number; max: number } }
	| { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

const SPIN_MS = 17;
/** The longest sleep, so that messages from the host are read in time. */
const SLICE_MS = 5;
/** rtmidi has no event for a plugged device: the port lists are read again this often. */
const POLL_MS = 2000;

const port = parentPort!;
const post = (message: FromMidiWorker) => port.postMessage(message);
const log = (level: 'info' | 'warn' | 'error', message: string) => post({ type: 'log', level, message });

const queue = new MidiQueue();
const outputs = new Map<string, Output>();
const inputs = new Map<string, Input>();
/** The inputs a song listens to; one that comes back after an unplug opens again. */
const wanted = new Set<string>();
const lateness: number[] = [];
let sent = 0;
let ports: MidiPorts = { outputs: [], inputs: [] };
const cell = new Int32Array(new SharedArrayBuffer(4));

function names(device: Input | Output): string[] {
	return Array.from({ length: device.getPortCount() }, (_, i) => device.getPortName(i));
}

function readPorts(): void {
	const probeOut = new Output();
	const probeIn = new Input();
	const next = { outputs: names(probeOut), inputs: names(probeIn) };
	probeOut.destroy();
	probeIn.destroy();
	if (JSON.stringify(next) === JSON.stringify(ports)) return;
	ports = next;
	// A port that went away is closed, so it opens again when the device comes back.
	for (const [name, out] of outputs) {
		if (ports.outputs.includes(name)) continue;
		out.closePort();
		outputs.delete(name);
	}
	for (const [name, input] of inputs) {
		if (ports.inputs.includes(name)) continue;
		input.closePort();
		inputs.delete(name);
	}
	missing.clear();
	for (const name of wanted) if (ports.inputs.includes(name)) listen(name);
	post({ type: 'ports', ports });
}

function output(name: string): Output | undefined {
	let out = outputs.get(name);
	if (out) return out;
	const index = ports.outputs.indexOf(name);
	if (index < 0) return undefined;
	out = new Output();
	try {
		out.openPort(index);
	} catch (error) {
		log('error', `MIDI output "${name}" does not open: ${(error as Error).message}. Another program may hold it.`);
		return undefined;
	}
	// The first message through a port took about 40 ms in S5; an active sensing byte
	// warms it up and devices ignore it.
	out.sendMessage([0xfe]);
	outputs.set(name, out);
	return out;
}

function listen(name: string): void {
	if (inputs.has(name)) return;
	const index = ports.inputs.indexOf(name);
	if (index < 0) return log('warn', `MIDI input "${name}" not found. Inputs: ${ports.inputs.join(', ') || 'none'}`);
	const input = new Input();
	input.ignoreTypes(true, true, true);
	input.on('message', (_delta, bytes) => post({ type: 'input', port: name, bytes, at: epochNow() }));
	try {
		input.openPort(index);
	} catch (error) {
		return log('error', `MIDI input "${name}" does not open: ${(error as Error).message}`);
	}
	inputs.set(name, input);
}

/** Ports a song named that are not there, each said once until the ports change. */
const missing = new Set<string>();

function resolve(events: MidiOut[]): MidiEvent[] {
	const out: MidiEvent[] = [];
	for (const e of events) {
		const name = findPort(ports.outputs, e.port);
		// The port opens here, when the events come in early, not on the first send.
		if (name && output(name)) out.push({ port: name, bytes: e.bytes, at: e.at });
		else if (!missing.has(String(e.port))) {
			missing.add(String(e.port));
			log('warn', `MIDI output "${e.port ?? ''}" not found. Outputs: ${ports.outputs.join(', ') || 'none'}`);
		}
	}
	return out;
}

function send(event: MidiEvent): void {
	try {
		output(event.port)?.sendMessage(event.bytes);
	} catch (error) {
		log('error', `MIDI to "${event.port}": ${(error as Error).message}`);
	}
}

port.on('message', (message: ToMidiWorker) => {
	switch (message.type) {
		case 'send':
			queue.add(message.source, resolve(message.events));
			break;
		case 'listen':
			wanted.add(message.port);
			listen(message.port);
			break;
		case 'panic': {
			const used = new Set(outputs.keys());
			for (const off of queue.panic(message.source)) send(off);
			// All notes off (CC 123) on every channel, for notes a device holds that we did not see.
			if (message.source === undefined) for (const name of used) for (let c = 0; c < 16; c++) send({ port: name, bytes: [0xb0 | c, 123, 0], at: 0 });
			break;
		}
		case 'stats': {
			const sorted = [...lateness].sort((a, b) => a - b);
			post({ type: 'stats', sent, late: { p50: sorted[Math.floor(sorted.length / 2)] ?? 0, max: sorted[sorted.length - 1] ?? 0 } });
			break;
		}
	}
});

function tick(): void {
	let wait = queue.next(epochNow());
	while (wait !== undefined && wait <= SPIN_MS) {
		const due = queue.take(epochNow() + SPIN_MS);
		for (const event of due) {
			while (epochNow() < event.at);
			const late = epochNow() - event.at;
			send(event);
			sent++;
			lateness.push(late);
			if (lateness.length > 2000) lateness.shift();
		}
		wait = queue.next(epochNow());
	}
	const sleep = wait === undefined ? SLICE_MS : Math.min(SLICE_MS, wait - SPIN_MS);
	if (sleep > 0) Atomics.wait(cell, 0, 0, sleep);
	// The event loop gets a turn, so messages from the host arrive.
	setImmediate(tick);
}

readPorts();
setInterval(readPorts, POLL_MS);
tick();

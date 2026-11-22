// The MIDI bridge of the extension host. A webview may not use MIDI, so every engine that
// plays MIDI talks to this, and this to the worker thread that owns the ports
// (midi-worker.ts). The worker starts with the first MIDI message of a song, so a song
// without MIDI never loads the native module.
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { describeMidi, epochNow, type MidiPorts } from '../shared/midi';
import type { FromWebview, ToWebview } from '../shared/protocol';
import type { FromMidiWorker, ToMidiWorker } from './midi-worker';

type MidiMessage = Extract<FromWebview, { type: 'midiPing' | 'midiOut' | 'midiListen' | 'midiPanic' }>;

export function isMidiMessage(message: FromWebview): message is MidiMessage {
	return message.type === 'midiPing' || message.type === 'midiOut' || message.type === 'midiListen' || message.type === 'midiPanic';
}

interface Client {
	post(message: ToWebview): void;
	listens: Set<string>;
}

export class MidiBridge implements vscode.Disposable {
	private worker: Worker | undefined;
	private readonly clients = new Map<string, Client>();
	private ports: MidiPorts | undefined;
	private readonly portsChanged = new vscode.EventEmitter<MidiPorts>();
	/** For the Browser: the ports, whenever they change. */
	readonly onPorts = this.portsChanged.event;
	private statsWaiting: ((stats: Extract<FromMidiWorker, { type: 'stats' }>) => void)[] = [];

	/** The setting strdltn.midi.debug: every message in and out goes to the Output as text. */
	private debug = false;
	/** The priority the extension host had before strdltn.midi.highPriority raised it. */
	private priorityBefore: number | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly dist: string,
		private readonly output: vscode.OutputChannel,
	) {
		this.readDebug();
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('strdltn.midi.debug')) this.readDebug();
				if (e.affectsConfiguration('strdltn.midi.highPriority')) this.applyPriority();
			}),
		);
	}

	/**
	 * The setting strdltn.midi.highPriority, off by default, and only while the worker runs.
	 * High priority removed MIDI's late notes of 20 to 80 ms in spike S5, but it is the
	 * priority of the whole extension host, so every other extension in it is raised too
	 * (decision 17 of doc/TODO.md: the maintainer wants it behind a setting).
	 */
	private applyPriority(): void {
		const want = !!this.worker && vscode.workspace.getConfiguration('strdltn.midi').get<boolean>('highPriority', false);
		try {
			if (want && this.priorityBefore === undefined) {
				this.priorityBefore = os.getPriority();
				os.setPriority(os.constants.priority.PRIORITY_HIGH);
				this.output.appendLine('[midi] the extension host runs at high priority');
			} else if (!want && this.priorityBefore !== undefined) {
				os.setPriority(this.priorityBefore);
				this.priorityBefore = undefined;
				this.output.appendLine('[midi] the extension host is back to its own priority');
			}
		} catch (error) {
			this.output.appendLine(`[midi] priority not changed: ${(error as Error).message}`);
		}
	}

	private readDebug(): void {
		this.debug = vscode.workspace.getConfiguration('strdltn.midi').get<boolean>('debug', false);
		if (!this.debug) return;
		this.output.appendLine('[midi] debug on: every MIDI message in and out is written here. Every input is opened, so a controller shows even when no song listens to it.');
		this.listenAll();
	}

	/** While debugging, every input is opened: a controller then shows here before a song calls midin(). */
	private listenAll(): void {
		if (!this.debug || !this.ports || !this.start()) return;
		for (const port of this.ports.inputs) this.send({ type: 'listen', port });
	}

	/** A message from an engine. `id` names the engine; `post` answers it. */
	receive(id: string, post: (message: ToWebview) => void, message: MidiMessage): void {
		let client = this.clients.get(id);
		if (!client) {
			client = { post, listens: new Set() };
			this.clients.set(id, client);
		}
		switch (message.type) {
			case 'midiPing':
				// Answered before anything else, so the host's time is read as early as it can be.
				post({ type: 'midiPong', id: message.id, sent: message.sent, now: epochNow() });
				if (this.start() && this.ports) post({ type: 'midiPorts', ports: this.ports });
				break;
			case 'midiOut':
				if (this.debug) for (const e of message.events) this.output.appendLine(`[midi] out -> ${e.port ?? '(first output)'}: ${describeMidi(e.bytes)}`);
				this.send({ type: 'send', source: id, events: message.events });
				break;
			case 'midiListen':
				client.listens.add(message.port);
				this.send({ type: 'listen', port: message.port });
				break;
			case 'midiPanic':
				this.send({ type: 'panic', source: id });
				break;
		}
	}

	/** An engine went away: its notes stop. */
	forget(id: string): void {
		if (!this.clients.delete(id)) return;
		this.send({ type: 'panic', source: id });
	}

	/** MIDI learn waits here for the next CC of any input. */
	private capture?: (cc: number) => void;

	/**
	 * The next CC of any input, for MIDI learn: every input is opened for it. Undefined when
	 * nothing moved within `timeoutMs`, 'noMidi' when MIDI does not load here. A second call
	 * replaces the first, which then ends as if nothing moved.
	 */
	async captureCC(timeoutMs: number): Promise<number | 'noMidi' | undefined> {
		const ports = await this.listPorts();
		if (!ports) return 'noMidi';
		for (const port of ports.inputs) this.send({ type: 'listen', port });
		this.capture?.(-1);
		return new Promise((resolve) => {
			const timer = setTimeout(() => finish(-1), timeoutMs);
			const finish = (cc: number) => {
				clearTimeout(timer);
				if (this.capture === finish) this.capture = undefined;
				resolve(cc < 0 ? undefined : cc);
			};
			this.capture = finish;
		});
	}

	/** Every port of the machine, starting the worker if it is not running. Undefined when MIDI does not load here. */
	async listPorts(): Promise<MidiPorts | undefined> {
		if (!this.start()) return undefined;
		if (this.ports) return this.ports;
		return new Promise((resolve) => {
			const done = this.onPorts((ports) => {
				done.dispose();
				resolve(ports);
			});
			setTimeout(() => resolve(this.ports), 3000);
		});
	}

	/** For the integration test: how many events went out and how late. */
	stats(): Promise<Extract<FromMidiWorker, { type: 'stats' }> | undefined> {
		if (!this.worker) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			this.statsWaiting.push(resolve);
			this.send({ type: 'stats' });
		});
	}

	dispose(): void {
		this.send({ type: 'panic' });
		const worker = this.worker;
		this.worker = undefined;
		// The panic needs a moment to go out before the thread ends.
		setTimeout(() => void worker?.terminate(), 50);
		this.applyPriority();
		this.portsChanged.dispose();
		this.disposables.forEach((d) => d.dispose());
	}

	private start(): boolean {
		if (this.worker) return true;
		try {
			const worker = new Worker(path.join(this.dist, 'midi-worker.cjs'));
			worker.on('message', (message: FromMidiWorker) => this.fromWorker(message));
			worker.on('error', (error) => this.output.appendLine(`[midi] error: ${error.message}`));
			worker.on('exit', (code) => {
				if (this.worker === worker) this.worker = undefined;
				this.applyPriority();
				this.output.appendLine(`[midi] the worker ended (${code})`);
			});
			this.worker = worker;
			this.output.appendLine('[midi] bridge started');
			this.applyPriority();
			return true;
		} catch (error) {
			this.output.appendLine(`[midi] does not start: ${(error as Error).message}`);
			return false;
		}
	}

	private send(message: ToMidiWorker): void {
		this.worker?.postMessage(message);
	}

	private fromWorker(message: FromMidiWorker): void {
		switch (message.type) {
			case 'ports':
				this.ports = message.ports;
				this.output.appendLine(`[midi] outputs: ${message.ports.outputs.join(', ') || 'none'}; inputs: ${message.ports.inputs.join(', ') || 'none'}`);
				for (const client of this.clients.values()) client.post({ type: 'midiPorts', ports: message.ports });
				this.portsChanged.fire(message.ports);
				this.listenAll();
				break;
			case 'input':
				if (this.capture && (message.bytes[0] & 0xf0) === 0xb0) this.capture(message.bytes[1]);
				if (this.debug) {
					const heard = [...this.clients.values()].some((client) => client.listens.has(message.port));
					this.output.appendLine(`[midi] in <- ${message.port}: ${describeMidi(message.bytes)}${heard ? '' : '   (no song listens to this device)'}`);
				}
				for (const client of this.clients.values()) if (client.listens.has(message.port)) client.post({ type: 'midiIn', port: message.port, bytes: message.bytes });
				break;
			case 'stats':
				for (const resolve of this.statsWaiting.splice(0)) resolve(message);
				break;
			case 'log':
				this.output.appendLine(`[midi] ${message.level}: ${message.message}`);
				break;
		}
	}
}

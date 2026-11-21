import * as vscode from 'vscode';
import type { DeviceInfo, FromDevices, ToDevices, ViewDevice } from '../shared/devices';
import type { Session } from './session';
import { setPage } from './surface';

/**
 * The Devices view in the bottom panel: one panel per firmware copy that plays, with its display, its knobs and its
 * buttons. The copies run in the engines (one per open song); this class keeps the list per engine and routes
 * frames to the view and requests back to the engine that runs the copy. See "Devices" in doc/ARCHITECTURE.md.
 */
export class DevicesView implements vscode.WebviewViewProvider {
	private webview?: vscode.Webview;
	private readonly lists = new Map<Session, DeviceInfo[]>();
	private readonly ids = new Map<Session, string>();
	private next = 1;
	/** Frames passed on, and what the page last reported. For the integration test. */
	private frames = 0;
	private lastState?: Extract<FromDevices, { type: 'state' }>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.webview = view.webview;
		setPage(this.context, view.webview, 'devices');
		view.webview.onDidReceiveMessage((message: FromDevices) => this.handle(message));
		view.onDidDispose(() => {
			if (this.webview === view.webview) this.webview = undefined;
		});
	}

	/** An engine reported its copies. */
	setDevices(session: Session, devices: DeviceInfo[]): void {
		if (devices.length) this.lists.set(session, devices);
		else this.lists.delete(session);
		this.send();
	}

	/** An engine closed: its copies are gone. */
	forget(session: Session): void {
		this.ids.delete(session);
		if (this.lists.delete(session)) this.send();
	}

	/** A display frame, passed on as it came. The engine sends the next only after the view painted this one. */
	frame(session: Session, key: string, px: Uint8Array, values: number[]): void {
		if (!this.webview) return;
		this.frames++;
		void this.webview.postMessage({ type: 'frame', engine: this.engineId(session), key, px, values } satisfies ToDevices);
	}

	/** What the view shows, for the integration test. */
	current(): { devices: ViewDevice[]; frames: number; state?: Extract<FromDevices, { type: 'state' }> } {
		return { devices: this.all(), frames: this.frames, state: this.lastState };
	}

	private handle(message: FromDevices): void {
		switch (message.type) {
			case 'ready':
				return this.send();
			case 'request': {
				const { type: _type, engine, ...request } = message;
				const session = [...this.ids].find(([, id]) => id === engine)?.[0];
				session?.device(request);
				return;
			}
			case 'state':
				this.lastState = message;
				return;
			case 'log':
				this.output.appendLine(`devices: ${message.message}`);
				return;
		}
	}

	private engineId(session: Session): string {
		let id = this.ids.get(session);
		if (!id) this.ids.set(session, (id = `e${this.next++}`));
		return id;
	}

	private all(): ViewDevice[] {
		return [...this.lists].flatMap(([session, list]) => {
			const engine = this.engineId(session);
			const song = session.document.uri.path.split('/').pop() ?? '';
			return list.map((device) => ({ ...device, engine, song }));
		});
	}

	private send(): void {
		void this.webview?.postMessage({ type: 'devices', devices: this.all() } satisfies ToDevices);
	}
}

import * as vscode from 'vscode';
import { readChains } from '../shared/chains';
import type { DeviceInfo, FromDevices, ToDevices, ViewDevice } from '../shared/devices';
import { lf } from '../shared/sync';
import type { Session } from './session';
import { setPage } from './surface';

/** A page of the Devices bundle: the view in the bottom panel, or a tab with one device taken out (`only`). */
interface Page {
	webview: vscode.Webview;
	only?: string;
	panel?: vscode.WebviewPanel;
}

/**
 * The Devices view in the bottom panel: one panel per firmware copy that plays, with its display, its knobs and its
 * buttons. The copies run in the engines (one per open song); this class keeps the list per engine and routes
 * frames to the page that shows a copy and requests back to the engine that runs it. See "Devices" in
 * doc/ARCHITECTURE.md.
 *
 * A copy draws for one page at a time: the one that asked last (`owner`). Frames go only there, so one frame stays in
 * flight per copy (spike F1), whether the panel is in the view or taken out into a tab.
 */
export class DevicesView implements vscode.WebviewViewProvider {
	private readonly pages = new Set<Page>();
	private readonly lists = new Map<Session, DeviceInfo[]>();
	private readonly ids = new Map<Session, string>();
	/** `<engine>/<key>` -> the page that draws it. */
	private readonly owner = new Map<string, Page>();
	private next = 1;
	/** Frames passed on, and what the view's page last reported. For the integration test. */
	private frames = 0;
	private lastState?: Extract<FromDevices, { type: 'state' }>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		const page = this.open(view.webview);
		view.onDidDispose(() => this.close(page));
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

	/** A display frame, passed to the page that draws the copy. The engine sends the next only after that page painted. */
	frame(session: Session, key: string, px: Uint8Array, values: number[]): void {
		const engine = this.engineId(session);
		const page = this.owner.get(`${engine}/${key}`);
		if (!page) return;
		this.frames++;
		void page.webview.postMessage({ type: 'frame', engine, key, px, values } satisfies ToDevices);
	}

	/** What the view shows, for the integration test. */
	current(): { devices: ViewDevice[]; frames: number; tabs: number; state?: Extract<FromDevices, { type: 'state' }> } {
		return { devices: this.all(), frames: this.frames, tabs: [...this.pages].filter((p) => p.only).length, state: this.lastState };
	}

	private open(webview: vscode.Webview, only?: string, panel?: vscode.WebviewPanel): Page {
		const page: Page = { webview, only, panel };
		this.pages.add(page);
		setPage(this.context, webview, 'devices');
		webview.onDidReceiveMessage((message: FromDevices) => this.handle(page, message));
		return page;
	}

	private close(page: Page): void {
		this.pages.delete(page);
		for (const [id, owner] of this.owner) {
			if (owner !== page) continue;
			this.owner.delete(id);
			// Nobody shows it any more: the copy stops drawing.
			const [engine, key] = split(id);
			this.session(engine)?.device({ action: 'draw', key, on: false });
		}
		this.sendPages();
	}

	/** A tab with one device. Its own page, so the device keeps running in the engine; only the picture moves. */
	private takeOut(engine: string, key: string): void {
		const id = `${engine}/${key}`;
		const existing = [...this.pages].find((p) => p.only === id);
		if (existing?.panel) return existing.panel.reveal();
		const device = this.all().find((d) => d.engine === engine && d.key === key);
		const panel = vscode.window.createWebviewPanel('strdltn.deviceTab', `${device?.id.toUpperCase() ?? key} @${device?.orbit ?? ''}`, vscode.ViewColumn.Beside, {
			enableScripts: true,
		});
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'strdltn.svg');
		const page = this.open(panel.webview, id, panel);
		panel.onDidDispose(() => this.close(page));
		this.sendPages();
	}

	private handle(page: Page, message: FromDevices): void {
		switch (message.type) {
			case 'ready':
				this.sendPage(page);
				void page.webview.postMessage({ type: 'devices', devices: this.all() } satisfies ToDevices);
				return;
			case 'request': {
				const { type: _type, engine, ...request } = message;
				const id = `${engine}/${request.key}`;
				if (request.action === 'draw') {
					if (request.on) this.owner.set(id, page);
					// Another page draws it now: this one letting go must not stop it.
					else if (this.owner.get(id) !== page) return;
					else this.owner.delete(id);
				} else if (request.action === 'painted' && this.owner.get(id) !== page) return;
				this.session(engine)?.device(request);
				return;
			}
			case 'takeOut':
				return this.takeOut(message.engine, message.key);
			case 'state':
				if (!page.only) this.lastState = message;
				return;
			case 'log':
				this.output.appendLine(`devices: ${message.message}`);
				return;
		}
	}

	private session(engine: string): Session | undefined {
		return [...this.ids].find(([, id]) => id === engine)?.[0];
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
			const text = lf(session.document.getText());
			const parsed = readChains(text);
			const chains = 'error' in parsed ? [] : parsed.chains;
			return list.map((device) => {
				// Match owning chain by explicit firmware reference (`vibefm1:<id>` / `fm1:<id>`) + orbit, or orbit fallback.
				const needle = device.id.toLowerCase();
				const owner =
					chains.find((c) => (c.orbit ?? 1) === device.orbit && text.slice(c.from, c.to).toLowerCase().includes(needle)) ??
					chains.find((c) => text.slice(c.from, c.to).toLowerCase().includes(needle)) ??
					chains.find((c) => (c.orbit ?? 1) === device.orbit);
				return { ...device, engine, song, ...(owner?.color ? { color: owner.color, chainName: owner.name } : {}) };
			});
		});
	}

	private send(): void {
		const devices = this.all();
		for (const page of this.pages) void page.webview.postMessage({ type: 'devices', devices } satisfies ToDevices);
		// A tab whose device is gone closes itself.
		for (const page of this.pages) if (page.only && !devices.some((d) => `${d.engine}/${d.key}` === page.only)) page.panel?.dispose();
	}

	private sendPages(): void {
		for (const page of this.pages) this.sendPage(page);
	}

	private sendPage(page: Page): void {
		const out = [...this.pages].flatMap((p) => (p.only ? [p.only] : []));
		void page.webview.postMessage({ type: 'page', only: page.only, out } satisfies ToDevices);
	}
}

function split(id: string): [string, string] {
	const at = id.indexOf('/');
	return [id.slice(0, at), id.slice(at + 1)];
}

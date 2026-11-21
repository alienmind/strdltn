import * as vscode from 'vscode';
import type { DeviceInfo, FromDevices, ToDevices, ViewDevice } from '../shared/devices';
import type { Session } from './session';
import { SHRUB_SETTING } from './shrub';
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
	) {
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(`strdltn.${SHRUB_SETTING}`)) this.sendPages();
			}),
		);
	}

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
		setPage(this.context, webview, 'devices', { csp: ['frame-src https://shrub.audio'] });
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
			case 'takeOutShrub':
				return void vscode.commands.executeCommand('strdltn.openShrubEditor');
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
			return list.map((device) => ({ ...device, engine, song }));
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
		const shrub = vscode.workspace.getConfiguration('strdltn').get<boolean>(SHRUB_SETTING, false);
		void page.webview.postMessage({ type: 'page', only: page.only, out, shrub } satisfies ToDevices);
	}
}

function split(id: string): [string, string] {
	const at = id.indexOf('/');
	return [id.slice(0, at), id.slice(at + 1)];
}

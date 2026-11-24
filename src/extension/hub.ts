import * as vscode from 'vscode';
import { HUB_INDEX, type HubFirmware, parseHubIndex } from '../shared/firmware';

/** The list is read at most once a day, as the hub asks of apps for its catalog.json (kb/#catalog). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The firmwares of The Firmware Hub's Playground (`index.json`), for the Available group of FM-1 Synths. Kept in global
 * storage with the time it was read: read again at most once a day, and the last copy is used offline or when the hub
 * does not answer. The maintainer chose this list on 2026-11-24: the hub's own catalog.json has no VIBE FM builds.
 */
export class HubCatalog implements vscode.Disposable {
	private list: HubFirmware[] = [];
	private readonly changed = new vscode.EventEmitter<HubFirmware[]>();
	readonly onDidChange = this.changed.event;
	private readonly file: vscode.Uri;
	private loading?: Promise<void>;
	/** When the list was read from the hub, and whether the last try failed. For the integration test and the log. */
	readAt?: number;
	error?: string;

	constructor(
		context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
		private readonly userAgent: string,
	) {
		this.file = vscode.Uri.joinPath(context.globalStorageUri, 'firmware', 'hub-index.json');
	}

	all(): HubFirmware[] {
		return this.list;
	}

	/** Loads the kept copy, and reads the hub when the copy is a day old or missing. Once at a time. */
	load(): Promise<void> {
		return (this.loading ??= this.read().finally(() => (this.loading = undefined)));
	}

	private async read(): Promise<void> {
		let kept: { readAt: number; json: unknown } | undefined;
		try {
			kept = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(this.file)));
		} catch {
			// Never read yet.
		}
		if (kept) this.set(parseHubIndex(kept.json), kept.readAt);
		if (kept && Date.now() - kept.readAt < DAY_MS) return;
		try {
			const response = await fetch(HUB_INDEX, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } });
			if (!response.ok) throw new Error(`${response.status}`);
			const json = await response.json();
			const readAt = Date.now();
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.file, '..'));
			await vscode.workspace.fs.writeFile(this.file, new TextEncoder().encode(JSON.stringify({ readAt, json })));
			this.error = undefined;
			this.set(parseHubIndex(json), readAt);
			this.output.appendLine(`[firmware] the hub lists ${this.list.length} firmwares`);
		} catch (error) {
			this.error = (error as Error).message;
			this.output.appendLine(`[firmware] the hub's list could not be read (${this.error})${kept ? ', the copy of ' + new Date(kept.readAt).toISOString() + ' is used' : ''}`);
		}
	}

	private set(list: HubFirmware[], readAt: number): void {
		this.list = list;
		this.readAt = readAt;
		this.changed.fire(list);
	}

	dispose(): void {
		this.changed.dispose();
	}
}

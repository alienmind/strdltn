import * as vscode from 'vscode';
import type { FromScreen, ScreenFirmware, ToScreen } from '../shared/screen';
import { setPage } from './surface';

/**
 * The firmware screen popup: one tab beside the editor, reused for the next firmware, as a preview is. The page runs
 * the firmware itself, from the file on disk, so a firmware no song plays yet can be seen too. See "Firmware screen" in
 * doc/ARCHITECTURE.md.
 */
export class FirmwareScreen {
	private panel?: vscode.WebviewPanel;
	/** The firmware shown. The page does not live while the tab is hidden: a new page says `ready` and gets it again. */
	private shown?: ScreenFirmware;
	/** What the page reported last. For the integration test. */
	private lastState?: Extract<FromScreen, { type: 'state' }>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly source: (id: string) => Promise<{ firmware: Omit<ScreenFirmware, 'url'>; file: vscode.Uri } | undefined>,
		private readonly output: vscode.OutputChannel,
		private readonly insert: (id: string) => void,
		private readonly install: (id: string) => Promise<void>,
	) {}

	async show(id: string): Promise<void> {
		let found: Awaited<ReturnType<typeof this.source>>;
		try {
			found = await this.source(id);
		} catch (error) {
			return void vscode.window.showErrorMessage(`The firmware "${id}" could not be downloaded: ${(error as Error).message}`);
		}
		if (!found) return void vscode.window.showWarningMessage(`The firmware "${id}" is not there any more.`);
		const { firmware: fw, file } = found;
		if (!this.panel) {
			// Beside the song and without the focus, so typing goes on in the editor.
			const panel = vscode.window.createWebviewPanel('strdltn.firmwareScreen', fw.name, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
			panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'strdltn.svg');
			setPage(this.context, panel.webview, 'screen', {
				// The project, and global storage: an Available firmware runs from the copy downloaded for its picture.
				roots: [...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri), this.context.globalStorageUri],
				// The page compiles the firmware: WebAssembly needs 'wasm-unsafe-eval', and fetch needs connect-src.
				script: ["'wasm-unsafe-eval'"],
				csp: [`connect-src ${panel.webview.cspSource}`],
			});
			panel.webview.onDidReceiveMessage((message: FromScreen) => this.handle(message));
			panel.onDidDispose(() => {
				if (this.panel !== panel) return;
				this.panel = undefined;
				this.shown = undefined;
			});
			this.panel = panel;
		} else {
			this.panel.reveal(undefined, true);
		}
		this.panel.title = fw.name;
		const firmware: ScreenFirmware = {
			id: fw.id,
			name: fw.name,
			version: fw.version,
			author: fw.author,
			license: fw.license,
			description: fw.description,
			available: fw.available,
			url: this.panel.webview.asWebviewUri(file).toString(),
		};
		this.lastState = undefined;
		this.shown = firmware;
		this.post(firmware);
	}

	/** What the page reported last, and whether the tab is open. */
	current(): { open: boolean; state?: Extract<FromScreen, { type: 'state' }> } {
		return { open: !!this.panel, state: this.lastState };
	}

	close(): void {
		this.panel?.dispose();
	}

	private post(firmware: ScreenFirmware): void {
		void this.panel?.webview.postMessage({ type: 'firmware', firmware } satisfies ToScreen);
	}

	private handle(message: FromScreen): void {
		switch (message.type) {
			case 'ready':
				if (this.shown) this.post(this.shown);
				return;
			case 'state':
				this.lastState = message;
				if (message.error) this.output.appendLine(`[firmware] screen of ${message.id}: ${message.error}`);
				return;
			case 'insert':
				return this.insert(message.id);
			case 'install':
				// Installed, the popup shows it again as installed: its button inserts now.
				return void this.install(message.id).then(async () => {
					if (this.shown?.id === message.id) await this.show(message.id);
				});
			case 'log':
				this.output.appendLine(`[firmware] ${message.message}`);
				return;
		}
	}
}

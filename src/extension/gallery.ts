import * as vscode from 'vscode';
import type { CatalogItem, UserIndex } from '../shared/catalog';
import type { FromGallery, GalleryTab, ToGallery } from '../shared/gallery';
import { galleryItems } from '../shared/gallery';
import type { PreviewPlan } from '../shared/preview';
import { setPage } from './surface';

export interface GalleryHost {
	/** Returns catalog items with image URIs rewritten for the given webview. */
	itemsFor(webview: vscode.Webview): CatalogItem[];
	user(): UserIndex;
	nativeRunning(): string[];
	flashEnabled(): boolean;
	wantFirmware(): void;
	/** Plays a preview; if standalone preview is needed, returns a PreviewPlan for the Gallery webview. */
	playForWebview(id: string, webview: vscode.Webview): Promise<PreviewPlan | undefined>;
	insert(id: string): Promise<void>;
	copy(id: string): Promise<void>;
	install(id: string): Promise<void>;
	installAll(ids: string[]): Promise<void>;
	showScreen(id: string): void;
	openEditor(id: string): void;
	runNative(id: string): Promise<void>;
	manageRepos(): Promise<void>;
	flashHardware(id: string): Promise<void>;
}

/**
 * Optional, closable full-screen Synths Gallery tab in the main editor area (UX-10).
 * Reuses the Browser's catalog items, audio preview engine, and firmware actions without
 * interrupting playback or the sidebar Browser when closed.
 */
export class SynthsGallery implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private initialTab: GalleryTab = 'all';

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
		private readonly host: GalleryHost,
	) {}

	private get imageRoot(): vscode.Uri {
		return vscode.Uri.joinPath(this.context.globalStorageUri, 'firmware');
	}

	/** Opens or reveals the Synths Gallery editor tab, optionally focusing a tab slice. */
	open(tab: GalleryTab = 'all'): void {
		this.initialTab = tab;
		this.host.wantFirmware();
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active, false);
			this.post({ type: 'tab', tab });
			return;
		}
		const panel = vscode.window.createWebviewPanel('strdltn.synthsGallery', 'Synths Gallery', vscode.ViewColumn.Active, {
			retainContextWhenHidden: true,
		});
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'strdltn.svg');
		setPage(this.context, panel.webview, 'gallery', {
			roots: [...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri), this.imageRoot],
			script: [panel.webview.cspSource, 'data:', 'blob:', "'unsafe-eval'"],
			csp: [
				`worker-src ${panel.webview.cspSource} data: blob:`,
				`connect-src ${panel.webview.cspSource} https: data: blob:`,
				`media-src ${panel.webview.cspSource} https: data: blob:`,
			],
		});
		panel.webview.onDidReceiveMessage((message: FromGallery) => void this.handle(message));
		panel.onDidDispose(() => {
			if (this.panel === panel) this.panel = undefined;
		});
		this.panel = panel;
	}

	/** Pushes updated items whenever the Browser catalog changes (e.g. install, thumbnail ready, sounds loaded). */
	refreshItems(): void {
		if (!this.panel) return;
		this.post({ type: 'items', items: galleryItems(this.host.itemsFor(this.panel.webview)) });
	}

	setUser(user: UserIndex): void {
		this.post({ type: 'user', user });
	}

	setNativeRunning(ids: string[]): void {
		this.post({ type: 'nativeRunning', ids });
	}

	setFlashEnabled(on: boolean): void {
		this.post({ type: 'flashEnabled', on });
	}

	stopPreview(): void {
		this.post({ type: 'stopPreview' });
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	private post(message: ToGallery): void {
		void this.panel?.webview.postMessage(message);
	}

	private async handle(message: FromGallery): Promise<void> {
		switch (message.type) {
			case 'ready': {
				if (!this.panel) return;
				this.host.wantFirmware();
				this.post({
					type: 'init',
					items: galleryItems(this.host.itemsFor(this.panel.webview)),
					user: this.host.user(),
					tab: this.initialTab,
					nativeRunning: this.host.nativeRunning(),
					flashEnabled: this.host.flashEnabled(),
				});
				return;
			}
			case 'play': {
				if (!this.panel) return;
				const plan = await this.host.playForWebview(message.id, this.panel.webview);
				if (plan) this.post({ type: 'playPreview', plan });
				return;
			}
			case 'insert':
				return this.host.insert(message.id);
			case 'copy':
				return this.host.copy(message.id);
			case 'install':
				return this.host.install(message.id);
			case 'installAll':
				return this.host.installAll(message.ids);
			case 'screen':
				return this.host.showScreen(message.id);
			case 'openEditor':
				return this.host.openEditor(message.id);
			case 'runNative':
				return this.host.runNative(message.id);
			case 'manageRepos':
				return this.host.manageRepos();
			case 'flashHardware':
				return this.host.flashHardware(message.id);
			case 'log':
				this.output.appendLine(`gallery: ${message.message}`);
				return;
		}
	}
}

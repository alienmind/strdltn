import * as vscode from 'vscode';
import { type FromWelcome, shouldAutoShowWelcome, type ToWelcome, type WelcomeAction, WELCOME_CARDS } from '../shared/welcome';
import { setPage } from './surface';

const WELCOME_DISMISSED_KEY = 'strdltn.welcomeDismissed';

export interface WelcomeHost {
	hasDemo(): boolean;
	hasProfile(): boolean;
	runAction(action: WelcomeAction): Promise<void>;
}

/**
 * Colorful First-Install Welcome Screen tab (`Welcome to [str]dltn Live[code]`, UX-5).
 * Opens automatically once on first install (unless dismissed or inside an automated test host)
 * and can be reopened anytime via `strdltn: Open Welcome Screen`.
 */
export class WelcomeScreen implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly host: WelcomeHost,
	) {}

	get dismissed(): boolean {
		return this.context.globalState.get<boolean>(WELCOME_DISMISSED_KEY, false);
	}

	/** Opens on first install if not dismissed and not running inside an automated test host. */
	maybeShowOnStartup(): void {
		const isTestHost = Boolean(process.env.VSTRUDEL_TEST_OUT) || this.context.extensionMode === vscode.ExtensionMode.Test;
		if (shouldAutoShowWelcome(this.dismissed, isTestHost)) {
			this.open();
		}
	}

	/** Opens or reveals the Welcome Screen tab. */
	open(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active, false);
			this.sendInit();
			return;
		}
		const panel = vscode.window.createWebviewPanel('strdltn.welcome', 'Welcome to [str]dltn Live[code]', vscode.ViewColumn.Active, {
			retainContextWhenHidden: false,
		});
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'strdltn.svg');
		setPage(this.context, panel.webview, 'welcome', {
			roots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		});
		panel.webview.onDidReceiveMessage((message: FromWelcome) => void this.handle(message));
		panel.onDidDispose(() => {
			if (this.panel === panel) this.panel = undefined;
		});
		this.panel = panel;
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	private sendInit(): void {
		if (!this.panel) return;
		const webview = this.panel.webview;
		const distWelcome = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'welcome');
		const images: Record<string, string> = {};
		for (const card of WELCOME_CARDS) {
			images[card.id] = webview.asWebviewUri(vscode.Uri.joinPath(distWelcome, card.imageFile)).toString();
		}
		const logoUrl = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'strdltn.svg')).toString();
		const message: ToWelcome = {
			type: 'init',
			version: String(this.context.extension.packageJSON.version ?? ''),
			dismissed: this.dismissed,
			logoUrl,
			images,
			hasDemo: this.host.hasDemo(),
			hasProfile: this.host.hasProfile(),
		};
		void webview.postMessage(message);
	}

	private async handle(message: FromWelcome): Promise<void> {
		switch (message.type) {
			case 'ready':
				this.sendInit();
				return;
			case 'setDismissed':
				await this.context.globalState.update(WELCOME_DISMISSED_KEY, message.dismissed);
				return;
			case 'action':
				await this.host.runAction(message.action);
				return;
		}
	}
}

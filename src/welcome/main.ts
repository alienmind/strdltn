// First-Install Welcome Screen page (UX-5): colorful Eclipse/IDE-style onboarding tab
// with real screenshots, "Play the demo song" hero CTA, "Try it" actions, and persisted opt-out.
import './welcome.css';
import { type FromWelcome, type ToWelcome, WELCOME_CARDS } from '../shared/welcome.ts';

declare function acquireVsCodeApi(): { postMessage(message: FromWelcome): void };
const vscode = acquireVsCodeApi();
const post = (message: FromWelcome) => vscode.postMessage(message);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const app = document.getElementById('app')!;

function render(state: ToWelcome): void {
	app.replaceChildren();
	const shell = app.appendChild(el('div', 'welcome-shell'));

	// ---- Hero Header ----
	const hero = shell.appendChild(el('section', 'hero'));
	const heroLeft = hero.appendChild(el('div', 'hero-copy'));

	const brand = heroLeft.appendChild(el('div', 'brand-row'));
	const logo = brand.appendChild(el('img', 'brand-logo'));
	logo.src = state.logoUrl;
	logo.alt = '[str]dltn mark';
	const brandText = brand.appendChild(el('div', 'brand-title-wrap'));
	const title = brandText.appendChild(el('h1', 'hero-title'));
	title.innerHTML = '<span class="bracket">[</span>str<span class="bracket">]</span>dltn Live<span class="bracket">[</span>code<span class="bracket">]</span>';
	if (state.version) {
		brandText.appendChild(el('span', 'version-pill', `v${state.version}`));
	}

	heroLeft.appendChild(
		el(
			'p',
			'hero-pitch',
			'Your IDE is your DAW. Live-code Strudel patterns with a two-column sample browser, track-colored mixer, sidechain cables, FM-1 hardware synths, and studio audio rendering - while keeping plain .strudel code as the song.',
		),
	);

	const ctaRow = heroLeft.appendChild(el('div', 'hero-actions'));
	const playBtn = ctaRow.appendChild(el('button', 'btn-hero-primary'));
	playBtn.innerHTML =
		'<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M4.5 2.8v10.4L13 8z"/></svg><span>Play the demo song</span>';
	playBtn.title = state.hasDemo ? 'Open demo.strudel and start playing' : 'Open a starter .strudel beat and start playing';
	playBtn.addEventListener('click', () => post({ type: 'action', action: 'playDemo' }));

	const galleryBtn = ctaRow.appendChild(el('button', 'btn-hero-secondary', 'Browse Synths Gallery'));
	galleryBtn.addEventListener('click', () => post({ type: 'action', action: 'tryDevices' }));

	const manualBtn = ctaRow.appendChild(el('button', 'btn-hero-ghost', 'User Manual (PDF)'));
	manualBtn.addEventListener('click', () => post({ type: 'action', action: 'openManual' }));

	// ---- Colorful Onboarding Cards Grid ----
	const gridSection = shell.appendChild(el('section', 'cards-section'));
	const grid = gridSection.appendChild(el('div', 'cards-grid'));

	for (const card of WELCOME_CARDS) {
		const article = grid.appendChild(el('article', 'feature-card'));
		article.style.setProperty('--card-accent', card.accent);

		const media = article.appendChild(el('div', 'card-media'));
		const img = media.appendChild(el('img'));
		img.src = state.images[card.id] ?? '';
		img.alt = card.title;
		img.loading = 'lazy';
		img.draggable = false;
		media.appendChild(el('span', 'card-badge', card.badge));
		media.addEventListener('click', () => post({ type: 'action', action: card.action }));

		const body = article.appendChild(el('div', 'card-body'));
		body.appendChild(el('h2', 'card-title', card.title));
		body.appendChild(el('p', 'card-desc', card.description));

		const footer = article.appendChild(el('div', 'card-footer'));
		const tryBtn = footer.appendChild(el('button', 'btn-try', card.actionLabel));
		tryBtn.addEventListener('click', () => post({ type: 'action', action: card.action }));
	}

	// ---- Clean DAW Profile tip banner ----
	const tip = shell.appendChild(el('section', 'profile-banner'));
	const tipCopy = tip.appendChild(el('div', 'profile-copy'));
	tipCopy.appendChild(el('strong', '', 'Want a distraction-free DAW workspace?'));
	tipCopy.appendChild(
		el(
			'span',
			'',
			'Import the clean "Strudel" VS Code profile to unpin Ports, Comments, and Debug Console and put Mixer and Devices front and center.',
		),
	);
	const profileBtn = tip.appendChild(el('button', 'btn-hero-secondary', 'Import clean DAW Profile'));
	profileBtn.addEventListener('click', () => post({ type: 'action', action: 'importProfile' }));

	// ---- Footer with persisted opt-out ----
	const foot = shell.appendChild(el('footer', 'welcome-footer'));
	const label = foot.appendChild(el('label', 'dismiss-toggle'));
	const checkbox = label.appendChild(el('input'));
	checkbox.type = 'checkbox';
	checkbox.checked = state.dismissed;
	checkbox.addEventListener('change', () => post({ type: 'setDismissed', dismissed: checkbox.checked }));
	label.appendChild(el('span', '', 'Do not show me this again'));

	foot.appendChild(el('span', 'reopen-hint', 'Re-open anytime via Command Palette: strdltn: Open Welcome Screen'));
}

window.addEventListener('message', (event: MessageEvent<ToWelcome>) => {
	if (event.data.type === 'init') render(event.data);
});

post({ type: 'ready' });

// Full-Screen Synths Gallery tab (UX-10): spacious responsive grid for FM-1 firmwares,
// built-in Strudel synths, wavetables, and soundfonts, reusing Browser preview audio.
import './gallery.css';
import { type CatalogItem, emptyUserIndex, type UserIndex } from '../shared/catalog.ts';
import { filterGalleryItems, type FromGallery, type GalleryTab, galleryTabCounts, type ToGallery } from '../shared/gallery.ts';
import { chipGroups } from '../shared/search.ts';
import { TAG_GROUPS } from '../shared/tags.ts';
import { icon } from '../browser/icons.ts';
import { playPreview, stopPreview } from '../browser/preview.ts';

declare function acquireVsCodeApi(): { postMessage(message: FromGallery): void };
const vscode = acquireVsCodeApi();
const post = (message: FromGallery) => vscode.postMessage(message);

const TABS: { id: GalleryTab; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'fm1', label: 'FM-1 Synths' },
	{ id: 'installed', label: 'Installed' },
	{ id: 'available', label: 'Available' },
	{ id: 'synths', label: 'Built-in Synths' },
	{ id: 'soundfonts', label: 'Soundfonts' },
];

let allItems: CatalogItem[] = [];
let user: UserIndex = emptyUserIndex();
let activeTab: GalleryTab = 'all';
let query = '';
let selectedChips: string[] = [];
let nativeRunning = new Set<string>();
let flashEnabled = false;
let previewingId: string | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

// ---- layout shell -----------------------------------------------------------------------

const app = document.getElementById('app')!;
const header = app.appendChild(el('header', 'gallery-header'));
const titleRow = header.appendChild(el('div', 'header-top'));
const titleGroup = titleRow.appendChild(el('div', 'title-group'));
const titleIcon = titleGroup.appendChild(el('span', 'title-icon'));
titleIcon.innerHTML = icon('firmware');
titleGroup.appendChild(el('h1', '', 'Synths & FM-1 Gallery'));
const countBadge = titleGroup.appendChild(el('span', 'count-badge', '0'));

const headerActions = titleRow.appendChild(el('div', 'header-actions'));
const searchWrap = headerActions.appendChild(el('div', 'search-wrap'));
searchWrap.innerHTML = icon('search');
const searchInput = searchWrap.appendChild(el('input'));
searchInput.placeholder = 'Search synths, FM-1 firmwares, tags...';
searchInput.spellcheck = false;
const clearBtn = searchWrap.appendChild(el('button', 'clear-btn'));
clearBtn.innerHTML = icon('close');
clearBtn.title = 'Clear search (Esc)';
clearBtn.hidden = true;
clearBtn.addEventListener('click', () => {
	query = '';
	searchInput.value = '';
	clearBtn.hidden = true;
	render();
	searchInput.focus();
});
searchInput.addEventListener('input', () => {
	query = searchInput.value;
	clearBtn.hidden = !query;
	render();
});
searchInput.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && query) {
		event.preventDefault();
		query = '';
		searchInput.value = '';
		clearBtn.hidden = true;
		render();
	}
});

const stopBtn = headerActions.appendChild(el('button', 'toolbar-btn stop-btn', 'Stop preview'));
stopBtn.hidden = true;
stopBtn.addEventListener('click', () => {
	stopPreview();
	setPreviewing(undefined);
});

const downloadAllBtn = headerActions.appendChild(el('button', 'toolbar-btn primary-btn'));
downloadAllBtn.hidden = true;
downloadAllBtn.addEventListener('click', () => {
	const installable = currentFiltered().filter((item) => item.kind === 'firmware' && item.available && !item.externalUrl);
	if (installable.length) post({ type: 'installAll', ids: installable.map((item) => item.id) });
});

const reposBtn = headerActions.appendChild(el('button', 'toolbar-btn', 'Repositories...'));
reposBtn.title = 'Manage FM-1 firmware repositories (The Firmware Hub, shrub.audio, custom URLs)';
reposBtn.addEventListener('click', () => post({ type: 'manageRepos' }));

const tabsBar = header.appendChild(el('div', 'tabs-bar'));
const chipsBar = header.appendChild(el('div', 'chips-bar'));
const main = app.appendChild(el('main', 'gallery-main'));
const grid = main.appendChild(el('div', 'gallery-grid'));

function currentFiltered(): CatalogItem[] {
	return filterGalleryItems(allItems, activeTab, query, selectedChips, user);
}

function setPreviewing(id: string | undefined, ms = 2400): void {
	clearTimeout(previewTimer);
	previewingId = id;
	stopBtn.hidden = !id;
	for (const card of grid.querySelectorAll<HTMLElement>('.card')) {
		card.classList.toggle('playing', card.dataset.id === id);
	}
	if (id) {
		previewTimer = setTimeout(() => {
			if (previewingId === id) setPreviewing(undefined);
		}, ms);
	}
}

function audition(item: CatalogItem): void {
	if (!item.sound || item.externalUrl) return;
	setPreviewing(item.id);
	post({ type: 'play', id: item.id });
}

function synthArtSvg(item: CatalogItem): string {
	const name = item.label.toLowerCase();
	if (name.includes('sine')) {
		return `<svg viewBox="0 0 180 96" class="synth-art"><path d="M12 48 C 36 10, 60 10, 90 48 C 120 86, 144 86, 168 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
	}
	if (name.includes('saw')) {
		return `<svg viewBox="0 0 180 96" class="synth-art"><path d="M14 68 L 56 24 L 56 68 L 106 24 L 106 68 L 156 24 L 156 68" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
	}
	if (name.includes('square') || name.includes('pulse')) {
		return `<svg viewBox="0 0 180 96" class="synth-art"><path d="M14 68 L 14 26 L 54 26 L 54 68 L 94 68 L 94 26 L 134 26 L 134 68 L 166 68" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
	}
	if (name.includes('tri')) {
		return `<svg viewBox="0 0 180 96" class="synth-art"><path d="M12 52 L 38 22 L 86 74 L 134 22 L 168 56" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
	}
	if (name.includes('noise') || name.includes('crackle')) {
		return `<svg viewBox="0 0 180 96" class="synth-art"><path d="M12 48 L 22 30 L 30 66 L 38 24 L 48 70 L 58 38 L 66 58 L 76 18 L 88 74 L 98 34 L 110 64 L 120 28 L 132 72 L 144 40 L 156 60 L 168 46" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
	}
	if (item.group === 'Soundfonts') {
		return `<svg viewBox="0 0 180 96" class="synth-art"><rect x="28" y="18" width="124" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M52 18 v60 M76 18 v60 M104 18 v60 M128 18 v60" stroke="currentColor" stroke-width="1.6" opacity="0.5"/><rect x="44" y="18" width="14" height="36" rx="2" fill="currentColor" opacity="0.75"/><rect x="68" y="18" width="14" height="36" rx="2" fill="currentColor" opacity="0.75"/><rect x="96" y="18" width="14" height="36" rx="2" fill="currentColor" opacity="0.75"/><rect x="120" y="18" width="14" height="36" rx="2" fill="currentColor" opacity="0.75"/></svg>`;
	}
	return `<svg viewBox="0 0 180 96" class="synth-art"><path d="M14 48 Q 34 18, 54 48 T 94 48 T 134 48 T 166 48" fill="none" stroke="currentColor" stroke-width="2.6" opacity="0.45"/><path d="M14 48 C 28 24, 42 72, 60 36 C 78 6, 98 86, 118 32 C 134 16, 152 68, 166 48" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>`;
}

function renderTabs(): void {
	const counts = galleryTabCounts(allItems);
	tabsBar.replaceChildren();
	for (const tab of TABS) {
		const btn = tabsBar.appendChild(el('button', `tab-pill${activeTab === tab.id ? ' active' : ''}`));
		btn.appendChild(el('span', '', tab.label));
		btn.appendChild(el('span', 'tab-count', String(counts[tab.id])));
		btn.addEventListener('click', () => {
			activeTab = tab.id;
			selectedChips = [];
			render();
		});
	}
}

function renderChips(): void {
	chipsBar.replaceChildren();
	const pool = filterGalleryItems(allItems, activeTab, query, [], user);
	const groups = chipGroups(pool, user, TAG_GROUPS).filter((g) => g.group === 'Runtime' || g.group === 'Repo' || g.group === 'Type' || g.group === 'Character');
	chipsBar.hidden = groups.length === 0;
	for (const { group, chips } of groups) {
		const wrap = chipsBar.appendChild(el('div', 'chip-group'));
		wrap.appendChild(el('span', 'chip-group-label', group));
		for (const { tag, count } of chips.slice(0, 10)) {
			const on = selectedChips.includes(tag);
			const chip = wrap.appendChild(el('button', `chip${on ? ' on' : ''}`, `${tag.slice(group.length + 1)} (${count})`));
			chip.addEventListener('click', () => {
				const prefix = `${group}/`;
				if (on) selectedChips = selectedChips.filter((c) => c !== tag);
				else selectedChips = [...selectedChips.filter((c) => !c.startsWith(prefix)), tag];
				render();
			});
		}
	}
}

function renderCard(item: CatalogItem): HTMLElement {
	const card = el('article', `card${previewingId === item.id ? ' playing' : ''}${item.kind === 'firmware' ? ' is-firmware' : ' is-synth'}`);
	card.dataset.id = item.id;

	// Visual preview stage (3:2 centered screen or synth waveform art)
	const stage = card.appendChild(el('div', 'card-stage'));
	stage.title = item.sound && !item.externalUrl ? `Click to audition ${item.label}` : item.label;
	if (item.image) {
		const img = stage.appendChild(el('img', 'screen-img'));
		img.src = item.image;
		img.alt = `${item.label} screen preview`;
		img.loading = 'lazy';
		img.draggable = false;
	} else if (item.kind === 'firmware') {
		const placeholder = stage.appendChild(el('div', 'stage-placeholder'));
		placeholder.innerHTML = icon('firmware');
		placeholder.appendChild(
			el('span', '', item.externalUrl ? (item.repo ?? 'External firmware') : item.runtime === 'hardware' ? 'FM-1 Hardware MIDI' : item.runtime === 'fwsc' ? 'FM-1 .fwsc Firmware' : 'VIBE FM-1 Synth'),
		);
	} else {
		const art = stage.appendChild(el('div', `stage-art group-${item.group.toLowerCase()}`));
		art.innerHTML = synthArtSvg(item);
	}

	// Badges overlay
	const badges = stage.appendChild(el('div', 'card-badges'));
	if (item.kind === 'firmware') {
		const runtimeLabel = item.externalUrl ? 'EXT' : item.runtime === 'hardware' ? 'MIDI' : item.runtime === 'fwsc' ? 'FWSC' : 'WASM';
		badges.appendChild(el('span', `badge runtime-${item.runtime ?? 'vibe'}`, runtimeLabel));
		badges.appendChild(el('span', `badge status-${item.available ? 'avail' : 'inst'}`, item.available ? 'Available' : 'Installed'));
	} else {
		const kindTag = item.tags.find((t) => t.startsWith('Type/'))?.slice(5) ?? item.group;
		badges.appendChild(el('span', 'badge synth-badge', kindTag));
	}

	// Play overlay + animated mini-EQ when auditioning
	if (item.sound && !item.externalUrl) {
		const playBadge = stage.appendChild(el('div', 'stage-play'));
		playBadge.innerHTML = `${icon('play')}<span class="mini-eq"><i></i><i></i><i></i></span>`;
		stage.classList.add('playable');
		stage.addEventListener('click', () => audition(item));
	}

	// Body: title, meta, description
	const body = card.appendChild(el('div', 'card-body'));
	const heading = body.appendChild(el('div', 'card-heading'));
	heading.appendChild(el('h3', 'card-title', item.label));
	if (item.repo) heading.appendChild(el('span', 'card-repo', item.repo));
	const desc = item.description || item.detail || (item.group === 'Soundfonts' ? 'General MIDI Soundfont instrument' : 'Built-in Strudel synthesizer');
	body.appendChild(el('p', 'card-desc', desc));

	// Footer actions
	const actions = card.appendChild(el('div', 'card-actions'));
	if (item.available) {
		const installBtn = actions.appendChild(el('button', 'card-btn primary'));
		installBtn.innerHTML = `${icon(item.externalUrl ? 'open' : 'install')}<span>${item.externalUrl ? 'Get...' : 'Install'}</span>`;
		installBtn.title = item.externalUrl ? `Open ${item.externalUrl}` : 'Download and install into firmware/';
		installBtn.addEventListener('click', () => post({ type: 'install', id: item.id }));
	} else {
		const insertBtn = actions.appendChild(el('button', 'card-btn primary'));
		insertBtn.innerHTML = `${icon('insert')}<span>Insert</span>`;
		insertBtn.title = 'Insert into active .strudel song';
		insertBtn.addEventListener('click', () => post({ type: 'insert', id: item.id }));
	}

	const secondary = actions.appendChild(el('div', 'card-secondary'));
	if (item.sound && !item.externalUrl) {
		const playBtn = secondary.appendChild(el('button', 'icon-btn'));
		playBtn.innerHTML = icon('play');
		playBtn.title = 'Audition sound';
		playBtn.addEventListener('click', () => audition(item));
	}
	if (item.kind === 'firmware' && item.runtime !== 'hardware' && item.runtime !== 'fwsc') {
		const screenBtn = secondary.appendChild(el('button', 'icon-btn'));
		screenBtn.innerHTML = icon('screen');
		screenBtn.title = 'Open interactive firmware screen';
		screenBtn.addEventListener('click', () => post({ type: 'screen', id: item.id }));
	}
	if (item.kind === 'firmware' && (item.id === 'firmware:shrub' || item.id === 'firmware:shrub-midi' || (item.runtime === 'fwsc' && !item.externalUrl))) {
		const fwId = item.id.slice('firmware:'.length);
		const running = nativeRunning.has(fwId);
		const nativeBtn = secondary.appendChild(el('button', `card-btn compact${running ? ' on' : ''}`, running ? 'Stop' : 'Native'));
		nativeBtn.title = running ? 'Stop native fm1-live emulator' : 'Run natively in fm1-live (240 MHz JIT)';
		nativeBtn.addEventListener('click', () => post({ type: 'runNative', id: item.id }));
	}
	if (item.kind === 'firmware' && item.editorUrl) {
		const editorBtn = secondary.appendChild(el('button', 'icon-btn'));
		editorBtn.innerHTML = icon('open');
		editorBtn.title = `Open companion editor (${item.editorUrl})`;
		editorBtn.addEventListener('click', () => post({ type: 'openEditor', id: item.id }));
	}
	if (flashEnabled && item.kind === 'firmware' && (item.runtime === 'fwsc' || item.runtime === 'hardware')) {
		const flashBtn = secondary.appendChild(el('button', 'card-btn compact', 'Flash'));
		flashBtn.title = 'Experimental: flash .fwsc to connected M-VAVE FM-1 over USB-MIDI';
		flashBtn.addEventListener('click', () => post({ type: 'flashHardware', id: item.id }));
	}
	const copyBtn = secondary.appendChild(el('button', 'icon-btn'));
	copyBtn.innerHTML = icon('copy');
	copyBtn.title = 'Copy sound name';
	copyBtn.addEventListener('click', () => post({ type: 'copy', id: item.id }));

	return card;
}

function render(): void {
	const visible = currentFiltered();
	countBadge.textContent = String(visible.length);
	renderTabs();
	renderChips();

	const installable = visible.filter((item) => item.kind === 'firmware' && item.available && !item.externalUrl);
	downloadAllBtn.hidden = installable.length === 0;
	if (installable.length > 0) {
		downloadAllBtn.innerHTML = `${icon('install')}<span>Download all (${installable.length})</span>`;
	}

	grid.replaceChildren();
	if (!visible.length) {
		const empty = grid.appendChild(el('div', 'gallery-empty'));
		empty.textContent = allItems.length
			? 'No synths or firmwares match the current filter.'
			: 'Loading synths and FM-1 repositories...';
		return;
	}
	const fragment = document.createDocumentFragment();
	for (const item of visible) fragment.appendChild(renderCard(item));
	grid.appendChild(fragment);
}

window.addEventListener('keydown', (event) => {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
		event.preventDefault();
		searchInput.focus();
		searchInput.select();
	} else if (event.key === '/' && document.activeElement !== searchInput) {
		event.preventDefault();
		searchInput.focus();
	}
});

window.addEventListener('message', (event: MessageEvent<ToGallery>) => {
	const message = event.data;
	switch (message.type) {
		case 'init':
			allItems = message.items;
			user = message.user;
			activeTab = message.tab;
			nativeRunning = new Set(message.nativeRunning);
			flashEnabled = message.flashEnabled;
			render();
			return;
		case 'items':
			allItems = message.items;
			render();
			return;
		case 'user':
			user = message.user;
			render();
			return;
		case 'tab':
			activeTab = message.tab;
			selectedChips = [];
			render();
			return;
		case 'playPreview':
			void playPreview(message.plan, (text) => post({ type: 'log', message: text }));
			return;
		case 'stopPreview':
			stopPreview();
			setPreviewing(undefined);
			return;
		case 'nativeRunning':
			nativeRunning = new Set(message.ids);
			render();
			return;
		case 'flashEnabled':
			flashEnabled = message.on;
			render();
			return;
	}
});

post({ type: 'ready' });

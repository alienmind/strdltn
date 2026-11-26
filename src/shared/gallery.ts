// Messages and filtering helpers for the full-screen Synths Gallery editor tab (UX-10).
import type { CatalogItem, UserIndex } from './catalog.ts';
import type { PreviewPlan } from './preview.ts';
import { filterItems } from './search.ts';

export type GalleryTab = 'all' | 'fm1' | 'installed' | 'available' | 'synths' | 'soundfonts';

export type ToGallery =
	| {
			type: 'init';
			items: CatalogItem[];
			user: UserIndex;
			tab: GalleryTab;
			nativeRunning: string[];
			flashEnabled: boolean;
	  }
	| { type: 'items'; items: CatalogItem[] }
	| { type: 'user'; user: UserIndex }
	| { type: 'tab'; tab: GalleryTab }
	| { type: 'playPreview'; plan: PreviewPlan }
	| { type: 'stopPreview' }
	| { type: 'nativeRunning'; ids: string[] }
	| { type: 'flashEnabled'; on: boolean };

export type FromGallery =
	| { type: 'ready' }
	| { type: 'play'; id: string }
	| { type: 'insert'; id: string }
	| { type: 'copy'; id: string }
	| { type: 'install'; id: string }
	| { type: 'installAll'; ids: string[] }
	| { type: 'screen'; id: string }
	| { type: 'openEditor'; id: string }
	| { type: 'runNative'; id: string }
	| { type: 'manageRepos' }
	| { type: 'flashHardware'; id: string }
	| { type: 'log'; message: string };

/** Selects the catalog items that belong in the Synths Gallery: FM-1 firmwares and Sounds (synths, wavetables, soundfonts). */
export function galleryItems(all: CatalogItem[]): CatalogItem[] {
	return all
		.filter((item) => item.kind === 'firmware' || item.category === 'sounds')
		.sort((a, b) => {
			const rank = (item: CatalogItem) => {
				if (item.kind === 'firmware' && !item.available) return 0;
				if (item.kind === 'firmware' && item.available) return 1;
				if (item.group === 'Synths') return 2;
				return 3;
			};
			return rank(a) - rank(b) || a.label.localeCompare(b.label);
		});
}

/** Filters gallery items by active section tab, search query, and tag chips. */
export function filterGalleryItems(items: CatalogItem[], tab: GalleryTab, query: string, chips: string[], user: UserIndex): CatalogItem[] {
	const byTab = items.filter((item) => {
		switch (tab) {
			case 'fm1':
				return item.kind === 'firmware';
			case 'installed':
				return item.kind === 'firmware' && !item.available;
			case 'available':
				return item.kind === 'firmware' && !!item.available;
			case 'synths':
				return item.category === 'sounds' && item.group !== 'Soundfonts';
			case 'soundfonts':
				return item.category === 'sounds' && item.group === 'Soundfonts';
			default:
				return true;
		}
	});
	return filterItems(byTab, { category: 'all', query, chips }, user);
}

/** Counts items per tab for the Gallery filter bar badges. */
export function galleryTabCounts(items: CatalogItem[]): Record<GalleryTab, number> {
	let fm1 = 0;
	let installed = 0;
	let available = 0;
	let synths = 0;
	let soundfonts = 0;
	for (const item of items) {
		if (item.kind === 'firmware') {
			fm1++;
			if (item.available) available++;
			else installed++;
		} else if (item.category === 'sounds') {
			if (item.group === 'Soundfonts') soundfonts++;
			else synths++;
		}
	}
	return { all: items.length, fm1, installed, available, synths, soundfonts };
}

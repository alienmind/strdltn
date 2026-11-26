import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyUserIndex, type CatalogItem } from './catalog.ts';
import { filterGalleryItems, galleryItems, galleryTabCounts } from './gallery.ts';

function item(partial: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'kind' | 'label' | 'category' | 'group'>): CatalogItem {
	return {
		place: 'builtin',
		tags: [],
		text: partial.label.toLowerCase(),
		...partial,
	};
}

describe('Synths Gallery filtering', () => {
	const catalog: CatalogItem[] = [
		item({ id: 'sound:bd', kind: 'sound', label: 'bd', category: 'drums', group: 'RolandTR909' }),
		item({ id: 'sound:sawtooth', kind: 'sound', label: 'sawtooth', category: 'sounds', group: 'Synths', tags: ['Type/Oscillator'] }),
		item({ id: 'sound:gm_piano', kind: 'sound', label: 'gm_piano', category: 'sounds', group: 'Soundfonts', tags: ['Type/Keys'] }),
		item({ id: 'firmware:obervave', kind: 'firmware', label: 'OBERVAVE', category: 'fm1', group: 'Installed', runtime: 'vibe', tags: ['Runtime/VIBE WASM'] }),
		item({ id: 'firmware:sloop', kind: 'firmware', label: 'SLOOP', category: 'fm1', group: 'Available', available: true, runtime: 'vibe', tags: ['Runtime/VIBE WASM'] }),
		item({ id: 'song:demo', kind: 'song', label: 'demo', category: 'songs', group: '.' }),
	];

	it('includes FM-1 firmwares and Sounds in priority order, excluding drums and songs', () => {
		const list = galleryItems(catalog);
		assert.deepEqual(
			list.map((x) => x.id),
			['firmware:obervave', 'firmware:sloop', 'sound:sawtooth', 'sound:gm_piano'],
		);
	});

	it('computes per-tab counts accurately', () => {
		const list = galleryItems(catalog);
		assert.deepEqual(galleryTabCounts(list), {
			all: 4,
			fm1: 2,
			installed: 1,
			available: 1,
			synths: 1,
			soundfonts: 1,
		});
	});

	it('filters by tab, query, and tag chips', () => {
		const list = galleryItems(catalog);
		const user = emptyUserIndex();
		assert.deepEqual(
			filterGalleryItems(list, 'installed', '', [], user).map((x) => x.id),
			['firmware:obervave'],
		);
		assert.deepEqual(
			filterGalleryItems(list, 'available', '', [], user).map((x) => x.id),
			['firmware:sloop'],
		);
		assert.deepEqual(
			filterGalleryItems(list, 'synths', 'saw', [], user).map((x) => x.id),
			['sound:sawtooth'],
		);
		assert.deepEqual(
			filterGalleryItems(list, 'all', '', ['Runtime/VIBE WASM'], user).map((x) => x.id),
			['firmware:obervave', 'firmware:sloop'],
		);
	});
});

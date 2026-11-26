// Cases for the search and the chips of the Browser, in search.ts. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUserIndex, firmwareItems, readUserIndex, snippetItem, songItem, soundCode, soundItems, writeUserIndex } from './catalog.ts';
import { chipGroups, filterItems, groupItems, parseQuery } from './search.ts';
import { knownCategory } from './catalog.ts';

const items = [
	...soundItems([
		{ name: 'rolandtr909_bd', type: 'sample', tag: 'drum-machines', count: 4 },
		{ name: 'rolandtr909_sd', type: 'sample', tag: 'drum-machines', count: 2 },
		{ name: 'linndrum_bd', type: 'sample', tag: 'drum-machines', count: 1 },
		{ name: 'sawtooth', type: 'synth', count: 1 },
		{ name: 'gm_acoustic_bass', type: 'soundfont', count: 3 },
		{ name: 'kick', type: 'sample', tag: 'local', count: 1 },
		{ name: 'vibefm1', type: 'firmware', count: 2, variations: ['obervave', 'sloop'] },
	]),
	...firmwareItems(
		[
			{ id: 'obervave', name: 'OBERVAVE', author: 'zvenson', from: 'cache', path: '.strdltn/cache/firmware/a/obervave.wasm', url: 'https://example.com/obervave.wasm' },
			{ id: 'sloop', name: 'SLOOP', from: 'folder', path: 'firmware/sloop.wasm' },
		],
		[
			{ id: 'echofield-vibe', name: 'ECHOFIELD', author: 'PhilipsKnobs', runtime: 'vibe', url: 'https://play.thefirmwarehub.com/firmware/echofield-vibe.wasm?v=1', order: 50 },
			{ id: 'felucca', name: 'Felucca', author: 'hub', runtime: 'fwsc', url: 'https://thefirmwarehub.com/fw/felucca.fwsc', order: 100 },
		],
		['obervave', 'sloop'],
		{ 'firmware:obervave': 'https://pictures/obervave.png' },
	),
	snippetItem({ name: 'bass/acid-303', folder: 'bass', title: 'Acid bass line', category: 'bass', fields: [{ name: 'tags', value: 'acid, 303' }], code: 'note("c2")' }, 'lib/bass/acid-303.strudel'),
	songItem('examples/01-chords.strudel'),
];
const user = emptyUserIndex();
const find = (query: string, extra: Partial<Parameters<typeof filterItems>[1]> = {}) =>
	filterItems(items, { query, category: 'all', chips: [], ...extra }, user).map((item) => item.id);

test('a query: words and #tags', () => {
	assert.deepEqual(parseQuery('  909 #Kick  '), { words: ['909'], tags: ['kick'] });
});

test('every word must match, in the name, the text or a tag', () => {
	assert.deepEqual(find('909 kick'), ['sound:rolandtr909_bd']);
	assert.deepEqual(find('bass'), ['sound:gm_acoustic_bass', 'snippet:bass/acid-303']);
	assert.deepEqual(find('#kick'), ['sound:rolandtr909_bd', 'sound:linndrum_bd', 'sound:kick']);
	assert.deepEqual(find('chords'), ['song:examples/01-chords.strudel']);
	assert.deepEqual(find('obervave'), ['firmware:obervave']);
	assert.deepEqual(find('zvenson'), ['firmware:obervave']);
});

test('categories and places', () => {
	assert.deepEqual(find('', { category: 'drums' }), ['sound:rolandtr909_bd', 'sound:rolandtr909_sd', 'sound:linndrum_bd']);
	assert.deepEqual(find('', { category: 'fm1' }), ['firmware:obervave', 'firmware:sloop', 'firmware:echofield-vibe']);
	assert.deepEqual(find('', { category: 'fm1live' }), ['firmware:shrub', 'firmware:fm1-stock', 'firmware:felucca']);
	// Plugins, the parent, shows both parallel children (FM-1 Synths + FM-1 Live).
	assert.deepEqual(find('', { category: 'plugins' }), [
		'firmware:obervave',
		'firmware:sloop',
		'firmware:shrub',
		'firmware:fm1-stock',
		'firmware:echofield-vibe',
		'firmware:felucca',
	]);
	assert.deepEqual(find('', { place: 'project', category: 'samples' }), ['sound:kick']);
});

test('chips: any of a group, every group', () => {
	assert.deepEqual(find('', { chips: ['Drums/Kick', 'Drums/Snare'] }).length, 4);
	assert.deepEqual(find('', { chips: ['Drums/Kick', 'Maker/Roland'] }), ['sound:rolandtr909_bd']);
});

test('colors and user tags come from the project file', () => {
	const mine = readUserIndex({ items: { 'sound:sawtooth': { colors: [1], tags: ['Tag/lead'] } } });
	assert.deepEqual(filterItems(items, { query: '', category: 'all', chips: [], color: 1 }, mine).map((i) => i.id), ['sound:sawtooth']);
	assert.deepEqual(filterItems(items, { query: '#lead', category: 'all', chips: [] }, mine).map((i) => i.id), ['sound:sawtooth']);
});

test('the project file: lenient on read, small on write', () => {
	const read = readUserIndex({ colorNames: ['Mine'], items: { a: { colors: [] }, b: { colors: [3, 1] } } });
	assert.equal(read.colorNames[0], 'Mine');
	assert.equal(read.colorNames[1], 'Orange');
	const written = JSON.parse(writeUserIndex(read));
	assert.deepEqual(written.items, { b: { colors: [1, 3] } });
	assert.deepEqual(readUserIndex('nonsense').items, {});
});

test('chips of the items in view, without a group that says nothing', () => {
	const drums = filterItems(items, { query: '', category: 'drums', chips: [] }, user);
	const groups = chipGroups(drums, user, ['Drums', 'Maker', 'Source']);
	assert.deepEqual(groups.map((g) => g.group), ['Drums', 'Maker']);
	assert.deepEqual(groups[0].chips, [{ tag: 'Drums/Kick', count: 2 }, { tag: 'Drums/Snare', count: 1 }]);
});

test('results under their headings: the bank, with its .bank() button', () => {
	const drums = filterItems(items, { query: '', category: 'drums', chips: [] }, user);
	const groups = groupItems(drums, false);
	assert.deepEqual(groups.map((g) => [g.label, g.insert, g.items.map((i) => i.label)]), [
		['linndrum', '.bank("linndrum")', ['bd']],
		['rolandtr909', '.bank("rolandtr909")', ['bd', 'sd']],
	]);
});

test('insert as code: s() with .bank(), a note for pitched sounds', () => {
	const code = (id: string, index?: number) => soundCode(items.find((item) => item.id === id)!, index);
	assert.deepEqual(code('sound:rolandtr909_bd'), { code: 's("bd").bank("rolandtr909")', name: 'rolandtr909_bd' });
	assert.deepEqual(code('sound:rolandtr909_bd', 2), { code: 's("bd:2").bank("rolandtr909")', name: 'rolandtr909_bd:2' });
	assert.deepEqual(code('sound:kick'), { code: 's("kick")', name: 'kick' });
	assert.deepEqual(code('sound:sawtooth'), { code: 'note("c3").s("sawtooth")', name: 'sawtooth' });
	assert.deepEqual(code('sound:gm_acoustic_bass', 1), { code: 'note("c3").s("gm_acoustic_bass:1")', name: 'gm_acoustic_bass:1' });
});

test('a firmware row: its own line, a test note by its position in the engine, Installed', () => {
	const ob = items.find((item) => item.id === 'firmware:obervave')!;
	assert.equal(ob.insert, '$: note("c2 eb2 g2 bb2").s("vibefm1:obervave")');
	assert.equal(ob.group, 'Installed');
	assert.equal(ob.image, 'https://pictures/obervave.png');
	assert.equal(ob.url, 'https://example.com/obervave.wasm');
	assert.deepEqual([ob.sound, ob.index], ['vibefm1', 0]);
	assert.equal(items.find((item) => item.id === 'firmware:sloop')!.index, 1);
	const echo = items.find((item) => item.id === 'firmware:echofield-vibe')!;
	assert.deepEqual([echo.group, echo.available, echo.insert, echo.sound], ['Available', true, undefined, 'vibefm1']);
	// The firmware host itself is no row of its own any more.
	assert.equal(items.some((item) => item.id.startsWith('sound:vibefm1')), false);
});

test('a group picked in the tree: only its rows', () => {
	assert.deepEqual(find('', { category: 'fm1', group: 'Available' }), ['firmware:echofield-vibe']);
	assert.deepEqual(find('', { category: 'fm1', group: 'Installed' }), ['firmware:obervave', 'firmware:sloop']);
	assert.deepEqual(find('', { category: 'drums', group: 'linndrum' }), ['sound:linndrum_bd']);
});

test('Installed before Hardware (MIDI) before Available, whatever the names', () => {
	const groups = groupItems(items.filter((item) => item.kind === 'firmware'), false);
	assert.deepEqual(groups.map((g) => g.label), ['Installed', 'Hardware (MIDI)', 'Available']);
});

test('categories of earlier versions', () => {
	assert.equal(knownCategory('instruments'), 'fm1');
	assert.equal(knownCategory('firmware'), 'fm1');
	assert.equal(knownCategory('drums'), 'drums');
	assert.equal(knownCategory('nonsense'), 'all');
});

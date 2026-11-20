// Cases for the pack rules in packs.ts. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheSegments, findPackSources, hasOwnBases, packAddress, packFiles, unsafeFile } from './packs.ts';

test('a song names its packs', () => {
	const song = [
		`samples('github:eddyflux/crate')`,
		`// samples('github:not/used')`,
		`await samples("https://example.org/kit/strudel.json")`,
		`samples('https://shabda.ndre.gr/bass.json?strudel=1')`,
		`samples('github:eddyflux/crate')`,
	].join('\n');
	assert.deepEqual(findPackSources(song), ['github:eddyflux/crate', 'https://example.org/kit/strudel.json']);
});

test('where the map of a pack is', () => {
	assert.deepEqual(packAddress('github:eddyflux/crate'), {
		map: 'https://raw.githubusercontent.com/eddyflux/crate/main/strudel.json',
		folder: 'https://raw.githubusercontent.com/eddyflux/crate/main/',
		name: 'strudel.json',
	});
	assert.deepEqual(packAddress('https://example.org/kit/piano.json'), {
		map: 'https://example.org/kit/piano.json',
		folder: 'https://example.org/kit/',
		name: 'piano.json',
	});
	assert.equal(packAddress('https://example.org/kit.json?x=1'), undefined);
	assert.equal(packAddress('http://example.org/kit.json'), undefined);
});

test('the place of a folder in the cache', () => {
	// The place a github: pack had before https addresses were cached. It must not move.
	assert.deepEqual(cacheSegments('https://raw.githubusercontent.com/eddyflux/crate/main/'), ['github', 'eddyflux', 'crate', 'main']);
	assert.deepEqual(cacheSegments('https://example.org:8443/a/b/'), ['https', 'example.org_8443', 'a', 'b']);
	assert.equal(cacheSegments('https://example.org/a/b'), undefined);
	assert.equal(cacheSegments('https://example.org/a/?x=1'), undefined);
	assert.equal(cacheSegments('http://example.org/a/'), undefined);
	assert.equal(cacheSegments('github:eddyflux/crate'), undefined);
});

test('a path that would leave the cache folder', () => {
	for (const file of ['../x.wav', 'a/../../x.wav', '/x.wav', '\\x.wav', 'a\\..\\x.wav', 'https://example.org/x.wav', 'c:/x.wav', ''])
		assert.equal(unsafeFile(file), true, file);
	for (const file of ['x.wav', 'bd/10 kick #1.wav', 'a/b/c..d.wav']) assert.equal(unsafeFile(file), false, file);
});

test('the files of a map', () => {
	const map = { _base: 'https://example.org/', bd: 'bd/a.wav', sd: ['sd/a.wav', 'sd/b.wav'], piano: { c3: 'p/c3.mp3', e3: ['p/e3.mp3'] } };
	assert.deepEqual(packFiles(map), ['bd/a.wav', 'sd/a.wav', 'sd/b.wav', 'p/c3.mp3', 'p/e3.mp3']);
	assert.equal(hasOwnBases(map), false);
	assert.equal(hasOwnBases({ piano: { _base: 'https://example.org/p/', c3: 'c3.mp3' } }), true);
});

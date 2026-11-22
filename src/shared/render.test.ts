// Cases for the names of a song's audio files and the length of a render. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioStem, renderCycles, songOfAudio } from './render.ts';

test('a render is named after the song, a recording after the song and its time', () => {
	assert.equal(audioStem('examples/demo.strudel', 'render'), 'examples/demo');
	assert.equal(audioStem('demo.strudel', 'record', new Date(2026, 10, 22, 1, 30, 5)), 'demo.rec-20261122-013005');
});

test('audio files are found as a song\'s only next to it and by its name', () => {
	const songs = new Set(['demo.strudel', 'examples/07-vibefm1-obervave.strudel']);
	assert.equal(songOfAudio('demo.wav', songs), 'demo.strudel');
	assert.equal(songOfAudio('demo.mp3', songs), 'demo.strudel');
	assert.equal(songOfAudio('demo.rec-20261122-013005.wav', songs), 'demo.strudel');
	assert.equal(songOfAudio('examples/07-vibefm1-obervave.MP3', songs), 'examples/07-vibefm1-obervave.strudel');
	assert.equal(songOfAudio('samples/sos-vocals/0.wav', songs), undefined);
	assert.equal(songOfAudio('examples/demo.wav', songs), undefined);
	assert.equal(songOfAudio('demo.rec-tuesday.wav', songs), undefined);
	assert.equal(songOfAudio('demo.ogg', songs), undefined);
});

test('a render takes the song\'s @length, else the default', () => {
	assert.equal(renderCycles('// @title Song\n// @length 100\nsetcpm(120/4)'), 100);
	assert.equal(renderCycles('s("bd*4")', 16), 16);
	assert.equal(renderCycles('// @length 0\n', 8), 8);
	assert.equal(renderCycles('const x = 1 // @length 5', 8), 8);
});

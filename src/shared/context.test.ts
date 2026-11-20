// Cases for the naming rules in context.ts. Run with `pnpm test:unit`.
// When a label in the stage is wrong, add the code that produced it here first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sliderLabel, visualLabel } from './context.ts';

// `<>` marks the position in the examples. It is not valid in the places we put it, so it cannot be confused with code.
/** The label of the visual whose call ends at the mark. */
const visual = (code: string) => visualLabel(code.replace('<>', ''), code.indexOf('<>'));
/** The label of the slider whose first argument starts at the mark. */
const slider = (code: string) => sliderLabel(code.replace('<>', ''), code.indexOf('<>'));

test('visual: the name of the pattern', () => {
	assert.deepEqual(visual('$kick: s("bd*4")._scope()<>'), { text: 'kick', rule: 'pattern label' });
	assert.deepEqual(visual('snare: s("[~ sd]*2")\n  .bank("RolandTR909")\n  ._scope()<>'), { text: 'snare', rule: 'pattern label' });
});

test('visual: the name of the pattern, from the last line of a long chain', () => {
	const code = '$bass: n("0 3")\n  .scale("f:phrygian")._pianoroll()<>\n  .gain(.5)';
	assert.equal(visual(code).text, 'bass');
});

test('visual: a comment in the middle of a chain does not end it', () => {
	const code = '$kick: s("[bd]*4").bank("tr909")\n  .gain(1)._scope()\n// Sidechain kick to orbit 2,3,4\n.duck("2:3:4").duckattack(.2)<>';
	assert.deepEqual(visual(code), { text: 'kick', rule: 'pattern label' });
});

test('visual: a comment above a new pattern still ends the one before', () => {
	const code = '$kick: s("bd*4")\n// Rolling hihat\n$: s("hh*16")._scope()<>';
	assert.deepEqual(visual(code), { text: 'Rolling hihat', rule: 'comment' });
});

test('visual: a variable', () => {
	assert.deepEqual(visual('const hiHats = s("hh*8")._scope()<>'), { text: 'hi hats', rule: 'variable' });
});

test('visual: an anonymous pattern takes the comment above it', () => {
	assert.deepEqual(visual('// Rolling hihat\n$: s("hh*16")._scope()<>'), { text: 'Rolling hihat', rule: 'comment' });
});

test('visual: a banner drawn with characters is not a comment', () => {
	const code = '// | |  | | ___   ___ __ _ | | ___\n//  \\____/ \\___/ \\___\\__,_||_||___/\n$: s("hh*16")._scope()<>';
	assert.deepEqual(visual(code), { text: 's("hh*16")._scope()', rule: 'code' });
});

test('visual: a metadata line is not a comment', () => {
	assert.equal(visual('// @by alienmind\n$: s("bd")._scope()<>').rule, 'code');
});

test('visual: with nothing else, the code', () => {
	assert.deepEqual(visual('\n$: s("bd*2, ~ sd, hh*8").gain(.8)._scope()<>'), { text: 's("bd*2, ~ sd, hh*8").gain(.8)._scope()', rule: 'code' });
});

test('visual: long code is cut', () => {
	const label = visual('$: note("c2 [eb2 g2] bb1 [c2 c3] c2 [eb2 g2] bb1").s("sawtooth")._pianoroll()<>');
	assert.equal(label.text.length, 40);
	assert.ok(label.text.endsWith('...'));
});

test('slider: a variable, as in a mixer', () => {
	assert.deepEqual(slider('const KICK_VOL=slider(<>0.49,0,1)'), { text: 'kick vol', rule: 'variable' });
	assert.deepEqual(slider('const bassEnergy = slider(<>1, 1, 4)'), { text: 'bass energy', rule: 'variable' });
});

test('slider: the call it is an argument of', () => {
	assert.deepEqual(slider('$: note("c2").s("sawtooth").lpf(slider(<>800, 200, 4000))'), { text: 'lpf', rule: 'call' });
});

test('slider: the call, with the name of the pattern in front', () => {
	const code = '$arp: n("0")\n  .sound("supersaw")\n  .lpf(slider(<>262,0,1000))';
	assert.deepEqual(slider(code), { text: 'arp lpf', rule: 'call' });
});

test('slider: the call that holds it directly', () => {
	assert.equal(slider('$: s("saw").lpf(sine.range(200, slider(<>800, 200, 4000)))').text, 'range');
});

test('slider: a property', () => {
	assert.deepEqual(slider('const mix = { cutoff: slider(<>800, 200, 4000) }'), { text: 'cutoff', rule: 'property' });
});

test('slider: a comment at the end of the line', () => {
	assert.deepEqual(slider('x = [slider(<>.5)] // master volume'), { text: 'master volume', rule: 'comment' });
});

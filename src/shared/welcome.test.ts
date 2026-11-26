import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoShowWelcome, WELCOME_CARDS } from './welcome.ts';

describe('Welcome Screen helpers', () => {
	it('auto-shows only on first install outside test hosts', () => {
		assert.equal(shouldAutoShowWelcome(false, false), true);
		assert.equal(shouldAutoShowWelcome(true, false), false);
		assert.equal(shouldAutoShowWelcome(false, true), false);
		assert.equal(shouldAutoShowWelcome(true, true), false);
	});

	it('defines all six onboarding feature cards in order', () => {
		assert.deepEqual(
			WELCOME_CARDS.map((card) => card.id),
			['play', 'find', 'mix', 'devices', 'midi', 'render'],
		);
		for (const card of WELCOME_CARDS) {
			assert.ok(card.imageFile.endsWith('.png'));
			assert.ok(card.title.length > 0);
			assert.ok(card.description.length > 0);
		}
	});
});

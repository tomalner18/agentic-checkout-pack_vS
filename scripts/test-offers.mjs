import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligible, observedOffers, rankOffers } from '../starter/offers.ts';

const request = { checkin: '2026-11-13', checkout: '2026-11-15', adults: 2, hardRequirements: ['Refundable cancellation'], preferences: ['River view'], exclusions: ['Breakfast'] };
const select = (id, context) => ({ id, tag: 'a', type: null, name: 'Select', context, checked: null, disabled: false });
const seen = (...elements) => ({ id: 'seen', url: 'http://hotel.test/rooms', title: 'Choose a room', text: '2026-11-13 to 2026-11-15 · 2 guests', elements, excludedFrames: 0, blocked: false });

test('initial choices exclude known hard conflicts, keep unknowns explicit, and rank preference fit', () => {
  const offers = observedOffers(seen(
    select('a', 'Classic double. Flexible. Free cancellation until 48 hours. €300. 2 nights, room only.'),
    select('b', 'River view double. Flexible. Free cancellation until 48 hours. €420. 2 nights, room only.'),
    select('c', 'River view double. Saver non-refundable. €250. 2 nights, room only.'),
    select('d', 'Mystery double. Flexible. Free cancellation until 48 hours. €200. 2 nights.'),
  ), request);
  assert.equal(offers.length, 4);
  assert.equal(eligible(offers[2]), false);
  assert.deepEqual(offers[2].hardConflicts, ['Refundable cancellation']);
  assert.equal(eligible(offers[3]), false);
  assert.deepEqual(offers[3].unverified, ['No Breakfast']);
  assert.equal(rankOffers(offers.filter(eligible), 'initial')[0].key, offers[1].key);
});

test('recovery uses absolute distance only for comparable prices and leaves unknown basis last', () => {
  const offers = observedOffers(seen(
    select('a', 'A. Flexible. Free cancellation. €300. 2 nights, room only.'),
    select('b', 'B. Flexible. Free cancellation. €360. 2 nights, room only.'),
    select('c', 'C. Flexible. Free cancellation. €500. 2 nights, room only.'),
    select('d', 'D. Flexible. Free cancellation. €340. room only.'),
  ), request);
  const original = { ...offers[0], amount: 350, price: '€350' };
  const ranked = rankOffers(offers, 'recovery', original);
  assert.deepEqual(ranked.map(offer => offer.context[0]), ['B', 'A', 'C', 'D']);
  assert.equal(offers[3].comparable, false);
});

test('optional breakfast is removable rather than a hard conflict', () => {
  const offer = observedOffers(seen(select('a', 'Double. Flexible. Free cancellation. €300. 2 nights, room only. Add breakfast optionally.')), request)[0];
  assert.equal(eligible(offer), true);
});

test('candidate budgets compare matching nightly and stay bases without treating missing taxes as a verified match', () => {
  const nightlyBudget = { ...request, hardRequirements: ['Maximum €210 per night'], exclusions: [] };
  const within = observedOffers(seen(select('a', 'Double. Room price €350. 2 nights. Tourist tax €16.')), nightlyBudget)[0];
  assert.equal(within.amount, 350);
  assert.equal(within.comparable, true);
  assert.deepEqual(within.hardConflicts, []);
  assert.deepEqual(within.unverified, ['Maximum €210 per night'], 'taxes may raise the final price');
  const over = observedOffers(seen(select('b', 'Double. Total €450. 2 nights.')), nightlyBudget)[0];
  assert.deepEqual(over.hardConflicts, ['Maximum €210 per night']);
  const complete = observedOffers(seen(select('c', 'Double. Total €350. 2 nights. Includes all taxes and mandatory fees.')), nightlyBudget)[0];
  assert.equal(eligible(complete), true);
  const strict = observedOffers(seen(select('d', 'Double. Total €350. 2 nights. Includes all taxes and mandatory fees.')),
    { ...request, hardRequirements: ['Under €350 total'], exclusions: [] })[0];
  assert.deepEqual(strict.hardConflicts, ['Under €350 total']);
});

test('ambiguous or ungrounded card amounts do not become comparable prices', () => {
  const ambiguous = observedOffers(seen(select('a', 'Double. €350 or €400. 2 nights.')),
    { ...request, hardRequirements: ['Maximum €500 total'], exclusions: [] })[0];
  assert.equal(ambiguous.price, null);
  assert.equal(ambiguous.comparable, false);
  assert.deepEqual(ambiguous.unverified, ['Maximum €500 total']);
  const unknownBasis = observedOffers(seen(select('b', 'Double. €350.')),
    { ...request, hardRequirements: ['Maximum €500 total'], exclusions: [] })[0];
  assert.equal(unknownBasis.comparable, false);
});

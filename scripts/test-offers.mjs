import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligible, observedOffers, rankOffers, roomOptionDetails } from '../starter/offers.ts';

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

test('a generic room suffix does not hide a matching room or admit a different room', () => {
  const roomRequest = { ...request, hardRequirements: ['Classic double room'], preferences: ['Late check-in around 23:00'], exclusions: [] };
  const offers = observedOffers(seen(
    select('classic', 'Classic double 18 m², courtyard side. Flexible. Total €444. 2 nights, room only.'),
    select('superior', 'Superior double 26 m², balcony. Flexible. Total €546. 2 nights, room only.'),
    select('upgraded', 'Classic double deluxe 26 m², balcony. Flexible. Total €600. 2 nights, room only.'),
  ), roomRequest);
  assert.equal(eligible(offers[0]), true);
  assert.deepEqual(offers[0].unverified, []);
  assert.deepEqual(offers[0].softMisses, ['Late check-in around 23:00']);
  assert.deepEqual(offers[1].unverified, ['Classic double room']);
  assert.deepEqual(offers[2].unverified, ['Classic double room']);
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

test('cheapest first outranks a soft view preference only when stay prices are comparable', () => {
  const rankedRequest = { ...request, rankingPriorities: [{ kind: 'price', value: '' }] };
  const offers = observedOffers(seen(
    select('river', 'River view double. Free cancellation. Total €430. 2 nights, room only.'),
    select('cheap', 'Classic double. Free cancellation. Total €300. 2 nights, room only.'),
    select('unknown', 'River view suite. Free cancellation. €200. room only.'),
  ), rankedRequest);
  assert.deepEqual(rankOffers(offers, 'initial', undefined, rankedRequest).map(offer => offer.actionName + offer.context.slice(0, 7)),
    ['SelectClassic', 'SelectRiver v', 'SelectRiver v']);
  assert.equal(rankOffers(offers, 'initial', undefined, rankedRequest)[2].comparable, false);
});

test('river view then visible quality preserves order and does not use price as a quality proxy', () => {
  const rankedRequest = { ...request, rankingPriorities: [{ kind: 'feature', value: 'River view' }, { kind: 'quality', value: '' }] };
  const offers = observedOffers(seen(
    select('a', 'Deluxe suite. Free cancellation. Total €800. 2 nights, room only.'),
    select('b', 'Classic river-facing double. Free cancellation. Total €350. 2 nights, room only.'),
    select('c', 'River view suite with balcony. Free cancellation. Total €500. 2 nights, room only.'),
    select('d', 'Mystery river view room. Free cancellation. Total €900. 2 nights, room only.'),
    select('e', 'River view suite. Non-refundable. Total €200. 2 nights, room only.'),
  ), rankedRequest);
  const order = rankOffers(offers, 'initial', undefined, rankedRequest);
  assert.deepEqual(order.map(offer => offer.context.split('.')[0]), [
    'River view suite with balcony', 'Classic river-facing double', 'Mystery river view room', 'Deluxe suite', 'River view suite',
  ]);
  assert.equal(order[2].qualityScore, null);
  assert.equal(order[4].hardConflicts.length, 1);
});

test('negated room features do not count as preference or quality evidence', () => {
  const rankedRequest = { ...request, rankingPriorities: [{ kind: 'feature', value: 'River view' }, { kind: 'quality', value: '' }] };
  const offers = observedOffers(seen(
    select('a', 'Classic double with no river view and no balcony. Free cancellation. Total €300. 2 nights, room only.'),
    select('b', 'Classic river-facing double. Free cancellation. Total €350. 2 nights, room only.'),
  ), rankedRequest);
  assert.deepEqual(offers[0].softMatches, []);
  assert.deepEqual(offers[0].qualityEvidence, ['Classic']);
  assert.equal(rankOffers(offers, 'initial', undefined, rankedRequest)[0].key, offers[1].key);
});

test('room summary exposes known listing facts and does not invent a final total or payment split', () => {
  const offer = observedOffers(seen(select('a', 'Superior double 26 m², balcony. Flexible. Free cancellation until 48 hours before arrival. Nothing is charged now and you pay at the hotel. €404.00 2 nights, room only.')), request)[0];
  const details = roomOptionDetails(offer, request);
  assert.equal(details.name, 'Superior double');
  assert.equal(details.price, '€404.00');
  assert.equal(details.priceLabel, 'Listed stay price');
  assert.match(details.priceNote, /final total/i);
  assert.match(details.cancellation, /Free cancellation until 48 hours/i);
  assert.equal(details.meals, 'Room only (no meals)');
  assert.equal(details.payment, 'Nothing charged now; pay at the hotel (amount verified at checkout).');
  assert.equal(details.guests, '2 adults');
  assert.equal(details.dates, '13–15 Nov 2026');
});

test('missing listing terms remain visible as unknown', () => {
  const offer = observedOffers(seen(select('a', 'Garden room. €180 per night.')), { ...request, hardRequirements: [], exclusions: [] })[0];
  const details = roomOptionDetails(offer, request);
  assert.equal(details.cancellation, 'Cancellation terms not stated');
  assert.equal(details.meals, 'Meals not stated');
  assert.equal(details.payment, 'Payment timing verified at checkout.');
  assert.match(details.priceNote, /checkout/i);
});

test('pay at hotel wording alone does not claim zero due now', () => {
  const offer = observedOffers(seen(select('a', 'Garden room. Total €300. 2 nights. Pay at the hotel.')), { ...request, hardRequirements: [], exclusions: [] })[0];
  assert.equal(roomOptionDetails(offer, request).payment, 'Pay at the hotel indicated; any charge now to verify at checkout.');
});

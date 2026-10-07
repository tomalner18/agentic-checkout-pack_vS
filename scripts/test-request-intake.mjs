import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRequestPatch, completeVerbalPriorities, emptyDraft, hotelMatches, normalizeArrivalPatch } from '../starter/request.ts';

const hotels = { 'Casa Halcy': 'http://localhost:4100', 'Harbour House': 'http://localhost:4190' };
const today = '2026-10-07';
const patch = changes => ({ hotelMention: '', checkin: '', checkout: '', estimatedArrival: '', adults: null,
  clearHotel: false, clearCheckin: false, clearCheckout: false, clearAdults: false, clearEstimatedArrival: false,
  hardAdd: [], hardRemove: [], preferenceAdd: [], preferenceRemove: [], exclusionAdd: [], exclusionRemove: [],
  specialAdd: [], specialRemove: [],
  replaceRanking: false, rankingPriorities: [], ...changes });

test('arrival estimate and guest notes stay outside room eligibility, even if model mislabels arrival', () => {
  const message = "Just me, the classic double at Casa Halcy from next Monday for 3 nights. I'll land late, around 23:00.";
  const extracted = normalizeArrivalPatch(message, patch({ hardAdd: ['Classic double room', 'Late check-in around 23:00'], preferenceAdd: ['Late check-in around 23:00'],
    specialAdd: ['Extra pillow, if possible'] }));
  const draft = applyRequestPatch(emptyDraft(), extracted, today, hotels);
  assert.deepEqual(draft.hardRequirements, ['Classic double room']);
  assert.deepEqual(draft.preferences, []);
  assert.equal(draft.estimatedArrival, '23:00');
  assert.deepEqual(draft.specialRequests, ['Extra pillow, if possible']);
  const changed = applyRequestPatch(draft, patch({ estimatedArrival: '21:30', specialRemove: ['Extra pillow, if possible'] }), today, hotels);
  assert.equal(changed.estimatedArrival, '21:30');
  assert.deepEqual(changed.specialRequests, []);
});

test('hotel, dates and guests accumulate in any order without clearing known fields', () => {
  const dates = applyRequestPatch(emptyDraft(), patch({ checkin: '2026-11-13', checkout: '2026-11-15' }), today, hotels);
  const guests = applyRequestPatch(dates, patch({ adults: 3 }), today, hotels);
  const complete = applyRequestPatch(guests, patch({ hotelMention: 'Casa Halcy' }), today, hotels);
  assert.deepEqual([complete.hotel, complete.checkin, complete.checkout, complete.adults], ['Casa Halcy', '2026-11-13', '2026-11-15', 3]);
  const hotelFirst = applyRequestPatch(emptyDraft(), patch({ hotelMention: 'Casa Halcy', adults: 3 }), today, hotels);
  assert.deepEqual(applyRequestPatch(hotelFirst, patch({ checkin: '2026-11-13', checkout: '2026-11-15' }), today, hotels), complete);
});

test('a misspelt hotel mention is retained for clarification and correction preserves other details', () => {
  const draft = applyRequestPatch(emptyDraft(), patch({ hotelMention: 'Cas Hacly', adults: 3 }), today, hotels);
  assert.equal(draft.hotel, null);
  assert.equal(draft.hotelMention, 'Cas Hacly');
  assert.deepEqual(hotelMatches(draft.hotelMention, hotels).suggestions, ['Casa Halcy']);
  const corrected = applyRequestPatch(draft, patch({ hotelMention: 'Casa Halcy' }), today, hotels);
  assert.equal(corrected.hotel, 'Casa Halcy');
  assert.equal(corrected.adults, 3);
});

test('edits change only named fields and explicit removals update preferences and priorities', () => {
  const first = applyRequestPatch(emptyDraft(), patch({ hotelMention: 'Casa Halcy', checkin: '2026-11-13', checkout: '2026-11-15', adults: 2,
    hardAdd: ['Refundable cancellation'], preferenceAdd: ['River view'], exclusionAdd: ['Breakfast'], replaceRanking: true,
    rankingPriorities: [{ kind: 'feature', value: 'River view' }, { kind: 'quality', value: '' }] }), today, hotels);
  const changed = applyRequestPatch(first, patch({ adults: 3, preferenceRemove: ['River view'] }), today, hotels);
  assert.equal(changed.adults, 3);
  assert.equal(changed.checkin, first.checkin);
  assert.deepEqual(changed.hardRequirements, ['Refundable cancellation']);
  assert.deepEqual(changed.exclusions, ['Breakfast']);
  assert.deepEqual(changed.preferences, []);
  assert.deepEqual(changed.rankingPriorities, [{ kind: 'quality', value: '' }]);
  const cheapest = applyRequestPatch(changed, patch({ replaceRanking: true, rankingPriorities: [{ kind: 'price', value: '' }] }), today, hotels);
  assert.deepEqual(cheapest.rankingPriorities, [{ kind: 'price', value: '' }]);
});

test('invalid or conflicting date changes cannot silently preserve an impossible stay', () => {
  const original = applyRequestPatch(emptyDraft(), patch({ checkin: '2026-11-13', checkout: '2026-11-15' }), today, hotels);
  const invalid = applyRequestPatch(original, patch({ checkin: '2026-11-31' }), today, hotels);
  assert.deepEqual([invalid.checkin, invalid.checkout], ['2026-11-13', '2026-11-15']);
  const changed = applyRequestPatch(original, patch({ checkin: '2026-11-16' }), today, hotels);
  assert.deepEqual([changed.checkin, changed.checkout], ['2026-11-16', null]);
});

test('explicitly withdrawn fields are cleared while other draft details remain', () => {
  const original = applyRequestPatch(emptyDraft(), patch({ hotelMention: 'Casa Halcy', checkin: '2026-11-13', checkout: '2026-11-15', adults: 2 }), today, hotels);
  const changed = applyRequestPatch(original, patch({ clearHotel: true, clearCheckout: true }), today, hotels);
  assert.deepEqual([changed.hotelMention, changed.hotel, changed.checkin, changed.checkout, changed.adults], [null, null, '2026-11-13', null, 2]);
});

test('explicit nicest fallback survives an incomplete model priority extraction', () => {
  const modelPatch = patch({ preferenceAdd: ['River view'], replaceRanking: true, rankingPriorities: [{ kind: 'feature', value: 'River view' }] });
  const completed = completeVerbalPriorities('River view if available, otherwise whatever is nicest', modelPatch, emptyDraft());
  assert.deepEqual(completed.rankingPriorities, [{ kind: 'feature', value: 'River view' }, { kind: 'quality', value: '' }]);
  const cheapest = completeVerbalPriorities('Cheapest first', patch({}), applyRequestPatch(emptyDraft(), completed, today, hotels));
  assert.deepEqual(cheapest.rankingPriorities[0], { kind: 'price', value: '' });
  const modelLabeled = applyRequestPatch(emptyDraft(), patch({ replaceRanking: true,
    rankingPriorities: [{ kind: 'feature', value: 'River view' }, { kind: 'quality', value: 'nicest' }] }), today, hotels);
  assert.deepEqual(modelLabeled.rankingPriorities, [{ kind: 'feature', value: 'River view' }, { kind: 'quality', value: '' }]);
});

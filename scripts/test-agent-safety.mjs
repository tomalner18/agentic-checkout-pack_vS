import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptedExceptionLabels, arrivalActionFor, checkoutPriceBreakdown, confirmationFromObservation, dateActionFor, detectsActionCycle, effectiveRequestForOffer, holdExpiryFromObservation, hotelSaysHoldExpired, meaningfulQuoteChange, quoteChanges, quoteComplete, quoteLines, quoteRequirementFindings, reviewBookingCard, withoutRedundantHotelRequirement } from '../starter/agent.ts';

test('a visible hold countdown yields an estimate and hotel release text is distinct from a timer reaching zero', () => {
  const seen = { id: 'hold', url: 'http://hotel.test/payment', title: 'Payment',
    text: "We're holding this room for you for 11:51", elements: [], excludedFrames: 1, blocked: false };
  assert.equal(holdExpiryFromObservation(seen, 1_000_000), 1_711_000);
  assert.equal(hotelSaysHoldExpired(seen), false);
  assert.equal(holdExpiryFromObservation({ ...seen, text: 'Payment expires at 11:51' }, 1_000_000), null);
  assert.equal(holdExpiryFromObservation({ ...seen, text: 'Hold expires in 11:99' }, 1_000_000), null);
  assert.equal(holdExpiryFromObservation({ ...seen, blocked: true }, 1_000_000), null);
  assert.equal(hotelSaysHoldExpired({ ...seen, text: 'Your hold has expired' }), true);
  assert.equal(hotelSaysHoldExpired({ ...seen, text: 'We held your room for 12 minutes and it has now been released. Please start again.' }), true);
  assert.equal(hotelSaysHoldExpired({ ...seen, text: 'Your bank approval is pending' }), false);
});

test('hotel identity stays in the selected site rather than becoming a room requirement', () => {
  assert.deepEqual(withoutRedundantHotelRequirement(['Hotel: Casa Halcy', 'Free cancellation', 'No breakfast'], 'Casa Halcy'), ['Free cancellation', 'No breakfast']);
  assert.deepEqual(withoutRedundantHotelRequirement(['Casa Halcy', 'Quiet room'], 'Casa Halcy'), ['Quiet room']);
});

const request = { checkin: '2026-11-13', checkout: '2026-11-15', adults: 2, hardRequirements: ['Refundable cancellation'], preferences: [], exclusions: [] };

test('estimated arrival selects only an unambiguous matching guest-details window', () => {
  const arrival = { id: 'current:arrival', tag: 'select', name: 'Estimated arrival', disabled: false,
    options: ["I don't know yet", 'Before 14:00', '14:00 to 18:00', '18:00 to 22:00', 'After 22:00'],
    selectedOption: "I don't know yet" };
  const seen = { id: 'current', blocked: false, elements: [arrival] };
  assert.deepEqual(arrivalActionFor(seen, '23:00'), { kind: 'select', id: arrival.id, value: 'After 22:00' });
  assert.equal(arrivalActionFor({ ...seen, elements: [{ ...arrival, selectedOption: 'After 22:00' }] }, '23:00'), null);
  assert.equal(arrivalActionFor({ ...seen, elements: [arrival, { ...arrival, id: 'other' }] }, '23:00'), null);
  assert.equal(arrivalActionFor(seen, null), null);
});
const element = (id, name, overrides = {}) => ({ id, tag: 'button', type: null, name, checked: null, disabled: false, ...overrides });
const obs = (elements, overrides = {}) => ({ id: 'current-observation', url: 'http://hotel.test/search', title: 'Choose dates', text: '', elements, excludedFrames: 0, blocked: false, ...overrides });

test('date helper fills only unambiguous editable fields and verifies through a fresh observation', () => {
  const fields = [
    element('current:1', 'Check-in', { tag: 'input', type: 'date', dateValue: '', readOnly: false }),
    element('current:2', 'Check-out', { tag: 'input', type: 'date', dateValue: '', readOnly: false }),
  ];
  assert.deepEqual(dateActionFor(obs(fields), request), {
    action: { kind: 'fill', id: 'current:1', value: request.checkin }, semantic: 'fill check-in date',
  });
  const afterCheckin = obs([
    { ...fields[0], dateValue: request.checkin },
    fields[1],
  ]);
  assert.deepEqual(dateActionFor(afterCheckin, request), {
    action: { kind: 'fill', id: 'current:2', value: request.checkout }, semantic: 'fill check-out date',
  });
});

test('date helper clicks only one currently observed matching date and refuses disabled or ambiguous options', () => {
  const inputs = [
    element('current:1', 'Check-in', { tag: 'input', type: 'text', dateValue: '', readOnly: true }),
    element('current:2', 'Check-out', { tag: 'input', type: 'text', dateValue: '', readOnly: true }),
  ];
  const option = element('current:3', request.checkin, { tag: 'button' });
  assert.deepEqual(dateActionFor(obs([...inputs, option]), request), {
    action: { kind: 'click', id: 'current:3' }, semantic: 'select check-in date',
  });
  assert.deepEqual(dateActionFor(obs([...inputs, { ...option, disabled: true }]), request), { unavailable: 'check-in date is disabled' });
  assert.equal(dateActionFor(obs([...inputs, option, { ...option, id: 'current:4' }]), request), null, 'duplicate visible choices are left to the model or traveller');
});

test('action memory stops repeated no-change actions and alternating cycles', () => {
  const entry = (key) => ({ key, semantic: key, result: 'no visible change', changed: false, failureCategory: null });
  assert.equal(detectsActionCycle([entry('click:check-in'), entry('click:check-in')], 'click:check-in'), true);
  assert.equal(detectsActionCycle([entry('click:check-in'), entry('click:next month'), entry('click:check-in')], 'click:next month'), true);
  assert.equal(detectsActionCycle([entry('click:check-in'), entry('click:next month')], 'click:check-in'), false);
  assert.equal(detectsActionCycle([{ ...entry('fill:first name'), changed: true }], 'fill:first name'), false);
  const visibleCycle = [
    { ...entry('click:month'), changed: true, beforeState: 'jan', afterState: 'feb' },
    { ...entry('click:date'), changed: true, beforeState: 'feb', afterState: 'jan' },
  ];
  assert.equal(detectsActionCycle(visibleCycle, 'click:month', 'jan'), true, 'visible A-B state changes that return to their starting state are detected');
});

function quoteFixture({ rate = 'Flexible rate', selectedText, cancellation = 'Free cancellation until 48 hours before arrival; first night charged for late cancellation or no-show.', cancellationEvidenceId = 'selected-observation' } = {}) {
  selectedText ||= `Superior double. ${rate}. ${cancellation}`;
  const currentText = [
    'Casa Halcy', 'Superior double', rate,
    'Check-in 2026-11-13 Check-out 2026-11-15', 'Occupancy 2 adults',
    'Room €392', 'Tourist tax €28', 'Total €420', 'Charged now €0', 'Paid at the hotel €420',
    'Payment recipient Casa Halcy', 'Card guarantee; nothing charged now.',
  ].join('\n');
  const selectedOffer = { observationId: 'selected-observation', actionName: 'Select rate', context: selectedText };
  const sources = [
    { observationId: selectedOffer.observationId, role: 'selected-offer', text: selectedText },
    { observationId: 'quote-observation', role: 'quote-page', text: currentText },
  ];
  const ref = (observationId, excerpt) => ({ observationId, excerpt });
  const quote = {
    room: 'Superior double', rate, checkin: request.checkin, checkout: request.checkout,
    occupancy: '2 adults', cancellation, total: '€420', payNow: '€0', payLater: '€420',
    recipient: 'Casa Halcy', guarantee: 'Card guarantee; nothing charged now.',
    evidence: {
      room: ref('selected-observation', 'Superior double'),
      rate: ref('selected-observation', rate),
      dates: ref('quote-observation', 'Check-in 2026-11-13 Check-out 2026-11-15'),
      occupancy: ref('quote-observation', 'Occupancy 2 adults'),
      cancellation: ref(cancellationEvidenceId, cancellationEvidenceId === 'selected-observation' ? cancellation : 'Free cancellation until 48 hours before arrival; first night charged for late cancellation or no-show.'),
      total: ref('quote-observation', 'Total €420'),
      payNow: ref('quote-observation', 'Charged now €0'),
      payLater: ref('quote-observation', 'Paid at the hotel €420'),
      recipient: ref('quote-observation', 'Payment recipient Casa Halcy'),
      guarantee: ref('quote-observation', 'Card guarantee; nothing charged now.'),
      tax: ref('quote-observation', 'Tourist tax €28'),
    },
  };
  const current = { id: 'quote-observation', url: 'http://hotel.test/payment', title: 'Payment', text: currentText, elements: [], excludedFrames: 0, blocked: false };
  return { quote, sources, selectedOffer, current };
}

test('quote evidence is tied field-by-field to the selected offer and current price page', () => {
  const fixture = quoteFixture();
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), true);
});

test('a non-refundable selected rate cannot inherit another rate’s free-cancellation evidence', () => {
  const fixture = quoteFixture({ rate: 'Non-refundable rate', selectedText: 'Superior double. Non-refundable rate. No cancellation or refund.' });
  const otherRate = { observationId: 'other-rate-observation', role: 'selected-offer', text: 'Superior double. Flexible rate. Free cancellation until 48 hours before arrival; first night charged for late cancellation or no-show.' };
  fixture.sources.push(otherRate);
  fixture.quote.cancellation = 'Free cancellation until 48 hours before arrival; first night charged for late cancellation or no-show.';
  fixture.quote.evidence.cancellation = { observationId: otherRate.observationId, excerpt: 'Free cancellation until 48 hours before arrival; first night charged for late cancellation or no-show.' };
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), false);
});

test('a cancellation excerpt cannot be shortened to omit its penalty terms', () => {
  const fixture = quoteFixture();
  fixture.quote.cancellation = 'Free cancellation until 48 hours before arrival.';
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), false);
});

test('shortening both quote and evidence cannot hide the selected rate deadline or penalty', () => {
  const fixture = quoteFixture();
  fixture.quote.cancellation = 'Free cancellation';
  fixture.quote.evidence.cancellation.excerpt = 'Free cancellation';
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), false);
});

test('guarantee claim must match current evidence', () => {
  const fixture = quoteFixture();
  fixture.quote.guarantee = 'No card guarantee required';
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), false);
});

test('the final checkout penalty must appear in the cancellation proposal', () => {
  const fixture = quoteFixture();
  const penalty = "If you cancel later than 48 hours before arrival, or don't arrive, the first night is charged.";
  fixture.current.text += '\n' + penalty;
  fixture.sources.find(source => source.observationId === fixture.current.id).text = fixture.current.text;
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), false);
  fixture.quote.cancellation += ' ' + penalty;
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), true);
});

test('a legitimate non-refundable Saver quote passes when flexibility is not requested', () => {
  const terms = 'Non-refundable. Full payment now; no cancellation or refund.';
  const fixture = quoteFixture({ rate: 'Saver rate', selectedText: `Superior double. Saver rate. ${terms}`, cancellation: terms });
  const unrestricted = { ...request, hardRequirements: [] };
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, unrestricted, 'Casa Halcy'), true);
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), false);
});

test('the Saver payment split passes when selected terms say not refundable', () => {
  const selectedText = "Classic double. Saver, non-refundable. The full amount is charged now and is not refundable if you cancel or don't show up.";
  const currentText = [
    'Casa Halcy', 'Classic double, saver, non-refundable rate',
    '2026-11-06 to 2026-11-08 · 2 nights · 2 guests',
    'Room €295.68', 'Tourist tax (€4.00 per person per night), paid at the hotel €16.00',
    'Total €311.68', 'Charged now €295.68', 'Paid at the hotel €16.00',
    'Your card will be charged €295.68 now. This rate is non-refundable.',
  ].join('\n');
  const selectedOffer = { observationId: 'selected', actionName: 'Select', context: selectedText };
  const sources = [{ observationId: 'selected', role: 'selected-offer', text: selectedText }, { observationId: 'checkout', role: 'quote-page', text: currentText }];
  const ref = (observationId, excerpt) => ({ observationId, excerpt });
  const quote = {
    room: 'Classic double', rate: 'Saver, non-refundable', checkin: '2026-11-06', checkout: '2026-11-08',
    occupancy: '2 guests', cancellation: "The full amount is charged now and is not refundable if you cancel or don't show up.",
    total: '€311.68', payNow: '€295.68', payLater: '€16.00', recipient: 'Casa Halcy',
    guarantee: 'Your card will be charged €295.68 now.',
    evidence: {
      room: ref('selected', 'Classic double'), rate: ref('selected', 'Saver, non-refundable'),
      dates: ref('checkout', '2026-11-06 to 2026-11-08 · 2 nights · 2 guests'),
      occupancy: ref('checkout', '2 guests'), cancellation: ref('selected', "The full amount is charged now and is not refundable if you cancel or don't show up."),
      total: ref('checkout', 'Total €311.68'), payNow: ref('checkout', 'Charged now €295.68'), payLater: ref('checkout', 'Paid at the hotel €16.00'),
      recipient: ref('checkout', 'Casa Halcy'), guarantee: ref('checkout', 'Your card will be charged €295.68 now.'),
      tax: ref('checkout', 'Tourist tax (€4.00 per person per night), paid at the hotel €16.00'),
    },
  };
  const current = { id: 'checkout', url: 'http://hotel.test/payment', title: 'Payment', text: currentText, elements: [], excludedFrames: 0, blocked: false };
  const unrestricted = { ...request, checkin: '2026-11-06', checkout: '2026-11-08', hardRequirements: [] };
  const failures = [];
  assert.equal(quoteComplete(quote, sources, selectedOffer, current, unrestricted, 'Casa Halcy', failures), true, failures.join(', '));
  assert.deepEqual(failures, []);
  const breakdown = checkoutPriceBreakdown(current);
  assert.deepEqual(breakdown, ['Room: €295.68', 'Tourist tax (€4.00 per person per night), paid at the hotel €16.00']);
  assert.deepEqual(quoteLines(quote, unrestricted, breakdown).slice(3, 9), [
    'Room: €295.68', 'Tourist tax (€4.00 per person per night), paid at the hotel €16.00',
    'Total: €311.68', 'Charged now: €295.68', 'Paid at hotel: €16.00',
    'Card/payment terms: Your card will be charged €295.68 now.',
  ]);
  assert.deepEqual(quoteChanges({ ...quote, payNow: '€0.00', payLater: '€311.68' }, quote), [
    'Charged now: €0.00 → €295.68', 'Paid at hotel: €311.68 → €16.00',
  ]);
  const revised = reviewBookingCard(quote, unrestricted, breakdown, { amount: '€295.68', label: 'Listed stay price', comparable: true });
  assert.deepEqual(revised.priceChange, { beforeLabel: 'Room card showed', before: '€295.68', current: '€311.68', difference: '+€16.00' });
  assert.equal(revised.buttons[0].label, 'I accept the updated €311.68 total');
  assert.equal(revised.buttons[1].label, 'Decline and revise search');
  assert.equal(revised.lines.includes('Room €295.68 + tourist tax €16.00'), true);
  assert.equal(revised.lines.includes('Payment to Casa Halcy: €295.68 charged now; €16.00 at the hotel.'), true);
  assert.equal(revised.lines.includes("Cancellation: Non-refundable if you cancel or don't show up."), true);
  assert.equal(revised.lines.some(line => line.startsWith('Card terms:')), false, 'charge-now repetition is omitted');
  assert.equal(revised.lines.some(line => line.startsWith('Total:')), false, 'current total is already prominent in the price comparison');
  const unchanged = reviewBookingCard(quote, unrestricted, breakdown, { amount: '€311.68', label: 'Listed total incl. tax', comparable: true });
  assert.equal(unchanged.priceChange, undefined);
  assert.equal(unchanged.lines.includes('Total: €311.68'), true);
  assert.equal(unchanged.buttons[0].label, 'I agree to these terms');
  const uncertainBasis = reviewBookingCard(quote, unrestricted, breakdown, { amount: '€295.68', label: 'Listed price', comparable: false });
  assert.deepEqual(uncertainBasis.priceChange, { beforeLabel: 'Room card showed', before: '€295.68', current: '€311.68' });
  const changedTiming = reviewBookingCard(quote, unrestricted, breakdown,
    { amount: '€311.68', label: 'Listed total incl. tax', comparable: true, paymentExpectation: 'nothing-now' });
  assert.match(changedTiming.notice, /room card indicated nothing charged now.*checkout charges €295\.68 now/i);
  assert.equal(changedTiming.buttons[0].label, 'I accept the revised terms');
  const expectedTiming = reviewBookingCard(quote, unrestricted, breakdown,
    { amount: '€295.68', label: 'Listed stay price', comparable: true, paymentExpectation: 'full-now' });
  assert.equal(expectedTiming.notice, undefined);
  assert.equal(meaningfulQuoteChange(quote, { ...quote }, breakdown, [...breakdown]), false);
  assert.equal(meaningfulQuoteChange(quote, { ...quote }, breakdown, ['Room: €294.68', 'Tourist tax €17.00']), true);
  assert.equal(meaningfulQuoteChange(quote, { ...quote, payNow: '€0.00' }, breakdown, breakdown), true);
  const reapproved = reviewBookingCard({ ...quote, total: '€321.68' }, unrestricted, breakdown, undefined, quote);
  assert.deepEqual(reapproved.priceChange, { beforeLabel: 'Previously agreed', before: '€311.68', current: '€321.68', difference: '+€10.00' });
  quote.cancellation = 'Fully refundable';
  assert.equal(quoteComplete(quote, sources, selectedOffer, current, unrestricted, 'Casa Halcy'), false);
});

test('explicit tax-in-total disclosure can prove taxes when no separate amount is shown', () => {
  const fixture = quoteFixture();
  const oldLine = 'Tourist tax €28';
  const newLine = 'Taxes and mandatory fees included in total';
  fixture.current.text = fixture.current.text.replace(oldLine, newLine);
  fixture.sources.find(source => source.observationId === fixture.current.id).text = fixture.current.text;
  fixture.quote.evidence.tax = { observationId: fixture.current.id, excerpt: newLine };
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), true);
});

test('tax line with a per-person amount and final stay amount uses the final amount', () => {
  const fixture = quoteFixture();
  const taxLine = 'Tourist tax (€4 per person per night), paid at the hotel\t€28';
  fixture.current.text = fixture.current.text.replace('Tourist tax €28', taxLine);
  fixture.sources.find(source => source.observationId === fixture.current.id).text = fixture.current.text;
  fixture.quote.evidence.tax.excerpt = taxLine;
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), true);
});

test('a requested breakfast exclusion needs positive room-only evidence', () => {
  const breakfastRequest = { ...request, exclusions: ['Breakfast'] };
  const unclear = quoteFixture();
  assert.equal(quoteComplete(unclear.quote, unclear.sources, unclear.selectedOffer, unclear.current, breakfastRequest, 'Casa Halcy'), false);
  const roomOnly = quoteFixture({ selectedText: 'Superior double. Flexible rate. Free cancellation until 48 hours before arrival; first night charged for late cancellation or no-show. Room only.' });
  assert.equal(quoteComplete(roomOnly.quote, roomOnly.sources, roomOnly.selectedOffer, roomOnly.current, breakfastRequest, 'Casa Halcy'), true);
});

test('the complete checkout total must meet an explicit hard budget', () => {
  const fixture = quoteFixture();
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current,
    { ...request, hardRequirements: ['Maximum total €400'] }, 'Casa Halcy'), false);
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current,
    { ...request, hardRequirements: ['Maximum total €420'] }, 'Casa Halcy'), true);
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current,
    { ...request, hardRequirements: ['Under €420 total'] }, 'Casa Halcy'), false);
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current,
    { ...request, hardRequirements: ['Maximum €210 per night'] }, 'Casa Halcy'), true);
});

test('a hotel receipt with a labelled reference and matching stay confirms without exposing guest details to a model', () => {
  const quote = { room: 'Classic double', rate: 'Flexible', occupancy: '2 guests', cancellation: 'Free cancellation until 48 hours before arrival.',
    checkin: '2026-11-13', checkout: '2026-11-15', total: '€352.00', payNow: '€0.00', payLater: '€352.00' };
  const receipt = obs([], { title: 'Booking confirmed · Example Hotel', text: [
    "You're booked", 'Booking reference', 'CH-632799',
    'Classic double, flexible rate', '2026-11-13 to 2026-11-15 · 2 nights · 2 guests',
    'Room\t€336.00', 'Tourist tax\t€16.00', 'Total\t€352.00',
    'A confirmation has been sent to guest@example.test.',
  ].join('\n') });
  assert.deepEqual(confirmationFromObservation(receipt, quote), {
    reference: 'CH-632799', room: quote.room, checkin: quote.checkin,
    checkout: quote.checkout, total: '€352.00', confirmed: true,
    receiptLines: ['Room: Classic double, flexible rate', 'Stay: 2026-11-13 to 2026-11-15', 'Guests: 2', 'Total: €352.00'],
    notShown: ['cancellation terms', 'full payment timing'],
  });
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text.replace('Booking reference\nCH-632799', 'Reservation #: AB12345') }, quote)?.reference, 'AB12345');
  assert.equal(confirmationFromObservation({ ...receipt, title: 'Payment approved', text: receipt.text.replace("You're booked", 'Payment approved') }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text.replace('Total\t€352.00', 'Total\t€452.00') }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text.replace('2026-11-13 to 2026-11-15', '2026-11-14 to 2026-11-16') }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text.replace('CH-632799', 'reference pending') }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, blocked: true }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text.replace('flexible rate', 'Saver non-refundable rate') }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text + '\nRate: Saver' }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text.replace('2 guests', '1 adult') }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text + '\nCharged now\t€50.00' }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text + '\nPaid at the hotel\t€300.00' }, quote), null);
  assert.equal(confirmationFromObservation({ ...receipt, text: receipt.text + '\nFree cancellation until 24 hours before arrival.' }, quote), null);
});

test('unknown offer constraints stay active until the prepared quote proves or contradicts them', () => {
  const fixture = quoteFixture();
  const selected = { ...fixture.quote, cancellation: 'Free cancellation until 48 hours before arrival.' };
  assert.deepEqual(quoteRequirementFindings(selected, fixture.current, request), { conflicts: [], unverified: [] });
  const saver = { ...fixture.quote, cancellation: 'Non-refundable. No cancellation or refund.' };
  assert.deepEqual(quoteRequirementFindings(saver, fixture.current, request), { conflicts: ['Refundable cancellation'], unverified: [] });
  const accepted = [{ offerKey: 'offer-a', requestRevision: 3, conflict: 'Refundable cancellation' }];
  assert.deepEqual(effectiveRequestForOffer(request, [], 'offer-a', 3).hardRequirements, ['Refundable cancellation'], 'dismissal grants nothing');
  assert.deepEqual(effectiveRequestForOffer(request, accepted, 'offer-a', 3).hardRequirements, []);
  assert.deepEqual(effectiveRequestForOffer(request, accepted, 'offer-b', 3).hardRequirements, ['Refundable cancellation']);
  assert.deepEqual(effectiveRequestForOffer(request, accepted, 'offer-a', 4).hardRequirements, ['Refundable cancellation']);
  assert.deepEqual(acceptedExceptionLabels(accepted, 'offer-b', 3), []);
  const overlapping = { ...request, hardRequirements: ['Refundable cancellation', 'Refundable cancellation with breakfast'] };
  assert.deepEqual(effectiveRequestForOffer(overlapping, accepted, 'offer-a', 3).hardRequirements, ['Refundable cancellation with breakfast'], 'exceptions use exact identities');
});

test('prepared quote verifies the named room despite a generic room suffix', () => {
  const fixture = quoteFixture();
  const roomRequest = { ...request, hardRequirements: ['Classic double room'] };
  assert.deepEqual(quoteRequirementFindings({ ...fixture.quote, room: 'Classic double' }, fixture.current, roomRequest),
    { conflicts: [], unverified: [] });
  assert.deepEqual(quoteRequirementFindings({ ...fixture.quote, room: 'Superior double' }, fixture.current, roomRequest,
    'Classic double appears elsewhere on the page'), { conflicts: [], unverified: ['Classic double room'] });
});

test('cancellation can be verified at checkout when the selected rate card omitted its policy', () => {
  const fixture = quoteFixture({ selectedText: 'Superior double. Flexible rate. Room only.' });
  const terms = 'Free cancellation until 48 hours before arrival; first night charged for late cancellation or no-show.';
  fixture.current.text += '\n' + terms;
  fixture.sources.find(source => source.observationId === fixture.current.id).text = fixture.current.text;
  fixture.quote.evidence.cancellation = { observationId: fixture.current.id, excerpt: terms };
  assert.equal(quoteComplete(fixture.quote, fixture.sources, fixture.selectedOffer, fixture.current, request, 'Casa Halcy'), true);
  const disclosed = quoteFixture();
  disclosed.current.text += '\n' + terms;
  disclosed.sources.find(source => source.observationId === disclosed.current.id).text = disclosed.current.text;
  disclosed.quote.evidence.cancellation = { observationId: disclosed.current.id, excerpt: terms };
  assert.equal(quoteComplete(disclosed.quote, disclosed.sources, disclosed.selectedOffer, disclosed.current, request, 'Casa Halcy'), false,
    'checkout wording cannot replace selected-rate evidence when the card already disclosed a policy');
});

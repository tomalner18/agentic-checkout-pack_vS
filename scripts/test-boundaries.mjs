import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionPermitted, needsTravellerForCommitment, openBrowser, protectPage, observe, act, setControl } from '../starter/browser.ts';

const element = (name, overrides = {}) => ({ id: 'seen:1', tag: 'button', type: null, name, checked: null, disabled: false, ...overrides });
const observation = (name, overrides = {}) => ({ id: 'seen', url: 'http://localhost:4100/details', title: 'Your details', text: 'Your details\nFirst name\nLast name\nEmail', elements: [element(name)], excludedFrames: 0, blocked: false, ...overrides });

test('final submissions and embedded checkout controls stay outside the action boundary', () => {
  assert.equal(actionPermitted({ kind: 'click', id: 'seen:1' }, observation('Book now')), false);
  assert.equal(actionPermitted({ kind: 'check', id: 'seen:1', checked: true }, observation('Accept booking conditions', { elements: [element('Accept booking conditions', { tag: 'input', type: 'checkbox' })] })), false);
  assert.equal(actionPermitted({ kind: 'fill', id: 'seen:1', value: 'x' }, observation('First name', { excludedFrames: 1, elements: [element('First name', { tag: 'input', type: 'text' })] })), false);
  assert.equal(actionPermitted({ kind: 'fill', id: 'seen:1', value: 'x' }, observation('Check-in', { elements: [element('Check-in', { tag: 'input', type: 'text', readOnly: true })] })), false);
});

test('only a visibly staged guest-details continuation is allowed', () => {
  const fields = ['First name', 'Last name', 'Email'].map((name, i) => element(name, { id: 'seen:' + (i + 2), tag: 'input', type: 'text' }));
  const button = element('Continue to payment', { context: 'Your details. No reservation is made until you submit the final booking.' });
  const staged = observation('Continue to payment', { text: 'Your details\nFirst name\nLast name\nEmail\nNo reservation is made until you submit the final booking.', elements: [button, ...fields] });
  const click = { kind: 'click', id: 'seen:1' };
  assert.equal(actionPermitted(click, staged, 'No reservation is made until you submit the final booking.'), true);
  assert.equal(actionPermitted(click, staged), true, 'ordinary guest details may proceed under the approved contextual policy');
  const sameActionBoundary = { ...staged, text: 'Your details\nFirst name\nLast name\nEmail\nNo reservation is made until you continue to payment.', elements: [element('Continue to payment', { context: 'Your details. No reservation is made until you continue to payment.' }), ...fields] };
  assert.equal(actionPermitted(click, sameActionBoundary, 'No reservation is made until you continue to payment.'), false, 'the named action crosses the booking boundary');
  assert.equal(needsTravellerForCommitment(click, sameActionBoundary), true);
  const noChargeOnly = { ...staged, text: 'Your details\nFirst name\nLast name\nEmail\nNo payment is taken now.', elements: [element('Continue to payment', { context: 'Your details. No payment is taken now.' }), ...fields] };
  assert.equal(actionPermitted(click, noChargeOnly, 'No payment is taken now.'), true, 'ordinary staged details with no commitment cue may proceed');
  const inventoryHold = { ...staged, text: 'Your details\nFirst name\nLast name\nEmail\nWe will hold this room for 10 minutes, with no financial obligation.', elements: [element('Continue to payment', { context: 'Your details. We will hold this room for 10 minutes, with no financial obligation.' }), ...fields] };
  assert.equal(actionPermitted(click, inventoryHold), true);
  const cardHold = { ...staged, text: 'Your details\nFirst name\nLast name\nEmail\nContinue to payment authorises a card hold.', elements: [element('Continue to payment', { context: 'Your details. Continue to payment authorises a card hold.' }), ...fields] };
  assert.equal(actionPermitted(click, cardHold), false);
  const contradicted = { ...staged, text: 'Your details\nFirst name\nLast name\nEmail\nContinuing creates your reservation; cancellation fees apply.', elements: [element('Continue to payment', { context: 'Your details. Continuing creates your reservation; cancellation fees apply.' }), ...fields] };
  assert.equal(actionPermitted(click, contradicted, 'No reservation is made until you submit the final booking.'), false, 'commitment language overrides a conflicting claim');
  for (const commitment of ['Continuing will book your room.', 'Clicking Continue reserves your stay.', 'Continue to payment will charge your card.']) {
    const conflicting = { ...staged, text: `${staged.text}\n${commitment}`, elements: [element('Continue to payment', { context: `Your details. ${commitment} No reservation is made until you submit the final booking.` }), ...fields] };
    assert.equal(actionPermitted(click, conflicting, 'No reservation is made until you submit the final booking.'), false, `${commitment} blocks the action`);
  }
  const submitDetails = { ...staged, elements: [element('Submit details', { context: 'Your details. First name, last name, email.' }), ...fields] };
  assert.equal(actionPermitted(click, submitDetails, 'No reservation is made until you submit the final booking.'), false, 'generic form submission is never inferred to be preparation');
  const distantEvidence = { ...staged, elements: [element('Continue to payment', { context: 'Your details. First name, last name, email.' }), ...fields] };
  assert.equal(actionPermitted(click, distantEvidence, 'No reservation is made until you submit the final booking.'), false, 'supplied evidence must be local to the action');
});

test('ownership and navigation consume observation IDs; sensitive controls block extraction', async () => {
  const { browser, page } = await openBrowser({ headless: true });
  try {
    protectPage(page, 'http://localhost:4100');
    await page.goto('http://localhost:4100');
    let seen = await observe(page);
    const id = seen.elements.find(e => e.name === 'Manage choices')?.id;
    assert.ok(id);
    setControl(page, 'traveller');
    await assert.rejects(() => observe(page), /HUMAN_CONTROL/);
    await assert.rejects(() => act(page, { kind: 'click', id }), /ACTIONS_DISABLED/);
    setControl(page, 'agent');
    await assert.rejects(() => act(page, { kind: 'click', id }), /ACTION_NOT_PERMITTED/);
    seen = await observe(page);
    const oldId = seen.elements.find(e => e.name === 'Manage choices')?.id;
    assert.ok(oldId);
    await page.goto('http://localhost:4100/conditions');
    await assert.rejects(() => act(page, { kind: 'click', id: oldId }), /ACTION_NOT_PERMITTED/);
  await page.setContent('<main>Private checkout<input name="card-number" value="secret"></main>');
  const blocked = await observe(page);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.text, '');
  assert.deepEqual(blocked.elements, []);
  await page.setContent('<section><h2>Superior double</h2><div><p>Flexible rate. Free cancellation until 48 hours before arrival.</p><a href="/book">Select</a></div><div><p>Saver rate. Non-refundable.</p><a href="/book">Select</a></div></section><button aria-disabled="true">2026-11-13</button>');
  const offers = await observe(page);
  const selectedRate = offers.elements.find(e => e.name === 'Select');
  assert.match(selectedRate.context, /Superior double.*Flexible rate.*Free cancellation/);
  assert.doesNotMatch(selectedRate.context, /Saver rate/);
  const disabledDate = offers.elements.find(e => e.name === '2026-11-13');
  assert.equal(disabledDate.disabled, true, 'aria-disabled calendar options cannot be used');
  assert.equal(actionPermitted({ kind: 'click', id: disabledDate.id }, offers), false);
} finally {
    await browser.close();
  }
});

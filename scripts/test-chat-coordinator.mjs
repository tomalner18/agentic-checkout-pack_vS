import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatServer, isEdit, isStop } from '../starter/chat/server.ts';

async function harness(fakeAgent) {
  const server = createChatServer(fakeAgent, 0);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); assert.equal(response.status, 204); };
  const events = async () => {
    const controller = new AbortController();
    const response = await fetch(base + '/events', { signal: controller.signal });
    const reader = response.body.getReader();
    let data = '';
    while (!data.includes('"type":"busy"')) data += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    return data.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  };
  const until = async predicate => {
    for (let i = 0; i < 40; i++) { const snapshot = await events(); if (predicate(snapshot)) return snapshot; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('Coordinator test timed out');
  };
  return { post, events, until, close: () => new Promise(resolve => server.close(resolve)) };
}

const latestCard = (events, title) => events.filter(event => event.type === 'card' && event.card.title === title).at(-1);
const messages = events => events.filter(event => event.type === 'message' && event.from === 'agent').map(event => event.text);

test('room choices arrive as one carousel and resolve only once', async () => {
  const selections = [];
  const app = await harness(async (_message, chat) => {
    const selected = await chat.choices([
      { title: 'Option 1', lines: ['Flexible rate'], buttons: [{ id: 'select', label: 'Select this option' }] },
      { title: 'Option 2', lines: ['Saver rate'], buttons: [{ id: 'select', label: 'Select this option' }] },
    ]);
    selections.push(selected);
  });
  try {
    await app.post('/send', { text: 'Find a room' });
    const snapshot = await app.until(events => events.some(event => event.type === 'carousel'));
    const group = snapshot.find(event => event.type === 'carousel');
    assert.equal(group.cards.length, 2);
    assert.equal(snapshot.filter(event => event.type === 'card').length, 0);
    await app.post('/press', { card: group.cards[1].id, button: 'select' });
    await app.until(() => selections.length === 1);
    await app.post('/press', { card: group.cards[0].id, button: 'select' });
    await app.post('/press', { card: group.cards[1].id, button: 'select' });
    assert.deepEqual(selections, [{ index: 1, button: 'select' }]);
  } finally { await app.close(); }
});

test('still working acknowledges the same handoff card without resolving checkout', async () => {
  const decisions = [];
  const app = await harness(async (_message, chat) => {
    decisions.push(await chat.choose({ title: 'You control the hotel browser', lines: [], buttons: [
      { id: 'check', label: 'Check booking' }, { id: 'later', label: 'Still working' }, { id: 'stop', label: 'Stop checking' },
    ] }));
  });
  try {
    await app.post('/send', { text: 'Find a room' });
    let snapshot = await app.until(events => !!latestCard(events, 'You control the hotel browser'));
    const waiting = latestCard(snapshot, 'You control the hotel browser');
    await app.post('/press', { card: waiting.id, button: 'later' });
    await app.post('/press', { card: waiting.id, button: 'later' });
    snapshot = await app.events();
    assert.equal(decisions.length, 0);
    assert.equal(snapshot.filter(event => event.type === 'card' && event.card.title === 'You control the hotel browser').length, 1);
    assert.equal(snapshot.filter(event => event.type === 'handoff' && event.state === 'waiting').length, 1);
    await app.post('/press', { card: waiting.id, button: 'check' });
    await app.until(() => decisions.length === 1);
    assert.deepEqual(decisions, ['check']);
  } finally { await app.close(); }
});

test('ordinary stop and edit language does not treat information questions as mutations', () => {
  assert.equal(isStop('Please stop the search'), true);
  assert.equal(isStop('stop helping'), true);
  assert.equal(isStop('Please stop helping'), true);
  assert.equal(isStop('Stop assistance'), true);
  assert.equal(isStop('Can I stop the search?'), false);
  assert.equal(isEdit('Actually, make it Saturday to Monday'), true);
  assert.equal(isEdit('Move check-in to Saturday'), true);
  assert.equal(isEdit('Please change to three guests'), true);
  assert.equal(isEdit('Can I change the dates?'), false);
  assert.equal(isEdit('What is the cancellation policy?'), false);
});

test('private edit suspends checking; keep restores a fresh control and stale presses cannot verify', async () => {
  let checks = 0;
  const app = await harness(async (_message, chat, ctx) => {
    chat.privateQuote(['Classic double', '€352']);
    while (!ctx.signal.aborted) {
      const choice = await chat.choose({ title: 'You control the hotel browser', lines: [], buttons: [{ id: 'check', label: 'Check booking' }] });
      if (ctx.signal.aborted || choice === 'stop' || choice === '__cancelled__') return;
      if (choice === 'check') { checks++; chat.outcomeUnknown(); chat.say('No matching confirmation yet.'); }
    }
  });
  try {
    await app.post('/send', { text: 'Book Casa Halcy' });
    let snapshot = await app.until(events => !!latestCard(events, 'You control the hotel browser'));
    const old = latestCard(snapshot, 'You control the hotel browser');
    await app.post('/send', { text: 'What is the cancellation policy?' });
    snapshot = await app.until(events => messages(events).some(message => message.includes('The reviewed quote was:')));
    assert.equal(checks, 0, 'a private question does not inspect the hotel');
    await app.post('/send', { text: 'Can I change the dates?' });
    snapshot = await app.events();
    assert.equal(latestCard(snapshot, 'Change this checkout?'), undefined, 'an information question does not open the edit dialog');
    await app.post('/send', { text: 'Actually, make it Saturday to Monday' });
    snapshot = await app.until(events => !!latestCard(events, 'Change this checkout?'));
    const dialog = latestCard(snapshot, 'Change this checkout?');
    await app.post('/press', { card: old.id, button: 'check' });
    assert.equal(checks, 0, 'old card cannot grant inspection while dialog is open');
    await app.post('/press', { card: dialog.id, button: 'keep' });
    snapshot = await app.until(events => events.filter(event => event.type === 'card' && event.card.title === 'You control the hotel browser').length === 2);
    const fresh = latestCard(snapshot, 'You control the hotel browser');
    assert.notEqual(fresh.id, old.id);
    await app.post('/press', { card: old.id, button: 'check' });
    assert.equal(checks, 0);
    await app.post('/press', { card: fresh.id, button: 'check' });
    await app.until(events => messages(events).includes('No matching confirmation yet.'));
    assert.equal(checks, 1);
    await app.post('/press', { card: fresh.id, button: 'check' });
    assert.equal(checks, 1, 'repeat press cannot verify twice');
  } finally { await app.post('/stop', {}); await app.close(); }
});

test('submitted or uncertain status explicitly grants one live restricted check', async () => {
  let checks = 0;
  const app = await harness(async (_message, chat, ctx) => {
    chat.privateQuote(['Classic double']);
    while (!ctx.signal.aborted) {
      const choice = await chat.choose({ title: 'You control the hotel browser', lines: [], buttons: [{ id: 'check', label: 'Check booking' }] });
      if (ctx.signal.aborted || choice !== 'check') return;
      checks++;
      chat.outcomeUnknown();
      chat.say('Restricted check finished.');
    }
  });
  try {
    await app.post('/send', { text: 'Book Casa Halcy' });
    let snapshot = await app.until(events => !!latestCard(events, 'You control the hotel browser'));
    const old = latestCard(snapshot, 'You control the hotel browser');
    await app.post('/send', { text: 'Change the dates' });
    snapshot = await app.until(events => !!latestCard(events, 'Change this checkout?'));
    assert.equal(checks, 0);
    const dialog = latestCard(snapshot, 'Change this checkout?');
    await app.post('/press', { card: old.id, button: 'check' });
    assert.equal(checks, 0);
    await app.post('/press', { card: dialog.id, button: 'submitted' });
    await app.until(events => messages(events).includes('Restricted check finished.'));
    assert.equal(checks, 1);
    await app.post('/press', { card: dialog.id, button: 'submitted' });
    assert.equal(checks, 1);
  } finally { await app.post('/stop', {}); await app.close(); }
});

test('unknown outcome refuses a replacement but restores checking; stopped checkout gives an honest manual route', async () => {
  let checks = 0;
  let starts = 0;
  const app = await harness(async (_message, chat, ctx) => {
    starts++;
    chat.privateQuote(['Classic double']);
    while (!ctx.signal.aborted) {
      const choice = await chat.choose({ title: 'You control the hotel browser', lines: [], buttons: [{ id: 'check', label: 'Check booking' }] });
      if (ctx.signal.aborted || choice === 'stop' || choice === '__cancelled__') return;
      if (choice === 'check') { checks++; chat.outcomeUnknown(); chat.say('Outcome unresolved.'); }
    }
  });
  try {
    await app.post('/send', { text: 'Book Casa Halcy' });
    let snapshot = await app.until(events => !!latestCard(events, 'You control the hotel browser'));
    await app.post('/press', { card: latestCard(snapshot, 'You control the hotel browser').id, button: 'check' });
    snapshot = await app.until(events => events.filter(event => event.type === 'card' && event.card.title === 'You control the hotel browser').length === 2);
    await app.post('/send', { text: 'Change the dates to Saturday' });
    snapshot = await app.until(events => !!latestCard(events, 'Change this checkout?'));
    await app.post('/press', { card: latestCard(snapshot, 'Change this checkout?').id, button: 'not-submitted' });
    snapshot = await app.until(events => events.filter(event => event.type === 'card' && event.card.title === 'You control the hotel browser').length === 3);
    assert.equal(starts, 1, 'unresolved booking blocks a replacement');
    assert.equal(checks, 1, 'dialog did not silently inspect');
    await app.post('/stop', {});
    await app.until(events => messages(events).some(message => message.includes('I stopped helping')));
    await app.post('/send', { text: 'Actually, change the dates to Monday' });
    snapshot = await app.until(events => events.filter(event => event.type === 'card' && event.card.title === 'Change this checkout?').length === 2);
    await app.post('/press', { card: latestCard(snapshot, 'Change this checkout?').id, button: 'submitted' });
    snapshot = await app.until(events => messages(events).some(message => message.includes('cannot inspect that earlier hotel session')));
    assert.equal(checks, 1);
    assert.equal(starts, 1);
  } finally { await app.close(); }
});

test('search edits revoke old work and carry unchanged request context into the replacement', async () => {
  const starts = [];
  const app = await harness(async (message, chat, ctx) => {
    starts.push({ message, previous: ctx.priorRequest });
    chat.rememberRequest('Casa Halcy', { checkin: '2026-11-13', checkout: '2026-11-15', adults: 2,
      hardRequirements: ['Refundable cancellation'], preferences: ['River view'], exclusions: ['Breakfast'] });
    await new Promise(resolve => ctx.signal.addEventListener('abort', resolve, { once: true }));
  });
  try {
    await app.post('/send', { text: 'Book Casa Halcy' });
    await app.until(() => starts.length === 1);
    await app.post('/send', { text: 'Actually, make it Saturday to Monday' });
    await app.until(() => starts.length === 2);
    assert.equal(starts[1].message, 'Actually, make it Saturday to Monday');
    assert.deepEqual(starts[1].previous, { checkin: '2026-11-13', checkout: '2026-11-15', adults: 2,
      hardRequirements: ['Refundable cancellation'], preferences: ['River view'], exclusions: ['Breakfast'] });
    await app.post('/send', { text: 'Please stop the search' });
    await app.until(events => messages(events).some(message => message.includes('I stopped helping')));
    assert.equal(starts.length, 2);
  } finally { await app.close(); }
});

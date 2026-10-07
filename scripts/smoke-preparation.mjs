// Reviewer-only scripted navigation smoke test. Never used by the runtime agent.
// It checks navigation through ordinary guest details to the quote page.
// This is scripted navigation evidence, not a completed booking or live-model result.
process.env.HEADLESS = '1';
const { createAgent } = await import('../starter/agent.ts');

const text = 'Book Casa Halcy for 2 adults, 13 to 15 November 2026. River view if possible, refundable, no breakfast.';
const events = [];
let reachedQuote = false;
const model = {
  id: 'scripted-smoke',
  async complete(req) {
    const input = JSON.parse(req.messages.at(-1).content);
    const keys = Object.keys(req.jsonSchema.properties);
    let result;
    if (keys.includes('hardAdd')) {
      result = { hotelMention: 'Casa Halcy', checkin: '2026-11-13', checkout: '2026-11-15', adults: 2,
        clearHotel: false, clearCheckin: false, clearCheckout: false, clearAdults: false,
        hardAdd: ['Refundable cancellation'], hardRemove: [], preferenceAdd: ['River view'], preferenceRemove: [],
        exclusionAdd: ['Breakfast'], exclusionRemove: [], replaceRanking: false, rankingPriorities: [] };
    } else if (keys.includes('nonBindingEvidence')) {
      const o = input.observation;
      const find = (predicate) => o.elements.find(predicate);
      const name = (s) => find(e => e.name.toLowerCase() === s.toLowerCase());
      let e;
      let kind = 'click';
      let value = '';
      let checked = false;
      if ((e = find(x => /Advertising|Analytics/.test(x.name) && x.checked))) { kind = 'check'; }
      else if ((e = name('Save choices'))) {}
      else if ((e = name('Manage choices'))) {}
      else if (/Choose your room|Choose a room/i.test(o.text + ' ' + o.title)) {
        if (!find(x => /No thanks, keep/i.test(x.name))) {
          e = find(x => x.name === 'Select' && /River.*Flexible/i.test(x.context || ''));
          if (!e) e = find(x => x.name === 'Select' && /Flexible/i.test(x.context || ''));
        }
      } else if (/Your details/i.test(o.title)) {
        e = find(x => /Breakfast|offers and news/i.test(x.name) && x.checked);
        if (e) kind = 'check';
        if (!e) {
          const fields = [['First name', 'Test'], ['Last name', 'Traveller'], ['Email', 'test@example.invalid'], ['Mobile phone', '+44 7700 900123']];
          for (const [label, data] of fields) {
            e = find(x => x.name === label && !x.filled);
            if (e) { kind = 'fill'; value = data; break; }
          }
        }
        if (!e) e = name('Continue to payment');
      } else if (/Check availability/i.test(o.text)) {
        const ci = name('Check-in');
        const co = name('Check-out');
        if (!ci?.dateValue) {
          e = name('2026-11-13');
          if (!e) e = find(x => /Next month/i.test(x.name));
          if (!e) e = ci;
        } else if (!co?.dateValue) {
          e = name('2026-11-15') || co;
        } else e = name('Check availability');
      }
      result = { kind: e ? kind : 'help', id: e?.id || '', value, checked, reason: e ? 'Scripted smoke progression' : 'No scripted match', nonBindingEvidence: '' };
    } else if (keys.includes('guarantee')) {
      reachedQuote = true;
      throw new Error('Scripted smoke stops at quote extraction.');
    } else {
      result = { reference: '', room: '', checkin: '', checkout: '', total: '', confirmed: false };
    }
    return { text: JSON.stringify(result), inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  },
};
const chat = {
  say(message) { events.push({ type: 'say', message }); },
  card(card) { events.push({ type: 'card', card }); return 'card'; },
  async choices(cards) { events.push({ type: 'options', cards }); return { index: 0, button: 'select' }; },
  async choose(card) { events.push({ type: 'choice', card }); return 'stop'; },
  async reply() { throw new Error('Unexpected reply'); },
};
await createAgent(() => model)(text, chat, {
  today: '2026-10-05',
  traveller: { first: 'Test', last: 'Traveller', email: 'test@example.invalid', phone: '+44 7700 900123' },
  hotels: { 'Casa Halcy': 'http://localhost:4100' },
});
const options = events.find(e => e.type === 'options');
console.log(JSON.stringify({ initialChoices: options?.cards.length || 0, reachedQuote, lastMessage: events.filter(e => e.type === 'say').at(-1)?.message }));
if (!options || !reachedQuote) process.exitCode = 1;
setTimeout(() => process.exit(process.exitCode || 0), 100);

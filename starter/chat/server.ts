// The chat: a phone-width page at http://localhost:4200 where the traveller
// talks to your agent. Run with `npm run chat`. At the debrief we play the
// traveller here.
//
// One in-memory conversation. Work revisions revoke old browser and card actions.

import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { agent } from "../agent.ts";
import type { Agent, Card, Chat, Context } from "../types.ts";

const PORT = Number(process.env.CHAT_PORT ?? 4200);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const PAGE = read("./page.html");
const EXAMPLES = read("../examples.json");

type Event =
  | { type: "message"; from: "traveller" | "agent"; text: string }
  | { type: "card"; id: string; card: Omit<Card, "image"> & { image?: string } }
  | { type: "pressed"; card: string; button: string }
  | { type: "busy"; on: boolean }
  | { type: "progress"; label: string | null }
  | { type: "invalidate" }
  | { type: "reset" };

export function isStop(text: string): boolean {
  return /^(?:please\s+)?(?:stop|abort|cancel)(?:\s+(?:(?:the|this|my)\s+)?(?:search|task|booking|help|helping|assistance|process))?(?:\s+now)?[.!]?$/i.test(text.trim());
}
export function isEdit(text: string): boolean {
  const value = text.trim();
  if (/^(?:can|could|would|may|how|what|when|do|does|is|are)\b/i.test(value) && /\?$/.test(value)) return false;
  return /\b(?:change|edit|update|revise|different|instead|make it|switch|move|shift|set|extend|shorten)\b/i.test(value) &&
    /\b(?:dates?|days?|nights?|rooms?|rates?|guests?|adults?|people|persons?|budget|price|breakfast|view|hotel|refund|cancel|check-?in|check-?out|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{4}-\d{2}-\d{2}\b/i.test(value);
}

export function createChatServer(agentImpl: Agent = agent, port = PORT): http.Server {
let history: Event[] = [];
const listeners = new Set<http.ServerResponse>();
function emit(e: Event) {
  if (e.type !== "busy" && e.type !== "reset") history.push(e);
  for (const res of listeners) res.write(`data: ${JSON.stringify(e)}\n\n`);
}

let running = false;
let revision = 0;
let controller: AbortController | null = null;
let pendingStart: string | null = null;
let priorRequest: Context['priorRequest'];
let priorHotel: string | undefined;
let reviewedQuote: string[] | null = null;
let privateDialogOpen = false;
let outcomeUnknown = false;
let confirmedReference: string | null = null;
let suspendedCheckoutChoice: { allowed: Set<string>; resolve: (button: string) => void; title: string } | null = null;
const inbox: string[] = [];
let waitingReply: ((text: string) => void) | null = null;
const waitingPress = new Map<string, { allowed: Set<string>; resolve: (button: string) => void; title: string }>();

function invalidate() {
  for (const pending of waitingPress.values()) pending.resolve('__cancelled__');
  waitingPress.clear();
  emit({ type: 'invalidate' });
}

function chatFor(epoch: number): Chat {
  const current = () => epoch === revision && !controller?.signal.aborted;
  const chat: Chat = {
  say(text) {
    if (current()) emit({ type: "message", from: "agent", text });
  },
  card(card) {
    if (!current()) return '';
    const id = randomBytes(4).toString("hex");
    const image = card.image ? `data:image/png;base64,${card.image.toString("base64")}` : undefined;
    emit({ type: "card", id, card: { ...card, image } });
    return id;
  },
  choose(card) {
    if (!current()) return Promise.resolve('__cancelled__');
    const id = chat.card(card);
    return new Promise((resolve) => waitingPress.set(id, { allowed: new Set(card.buttons.map(b => b.id)), resolve, title: card.title }));
  },
  choices(cards) {
    if (!current()) return Promise.resolve({ index: -1, button: '__cancelled__' });
    return new Promise(resolve => {
      const ids: string[] = [];
      let finished = false;
      const finish = (index: number, button: string) => {
        if (finished) return;
        finished = true;
        for (const id of ids) waitingPress.delete(id);
        emit({ type: 'invalidate' });
        resolve({ index, button });
      };
      cards.forEach((card, index) => {
        const id = chat.card(card);
        ids.push(id);
        waitingPress.set(id, { allowed: new Set(card.buttons.map(b => b.id)), resolve: button => finish(index, button), title: card.title });
      });
    });
  },
  reply() {
    const queued = inbox.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => (waitingReply = resolve));
  },
  invalidate() { if (current()) invalidate(); },
  progress(label) { if (current()) emit({ type: 'progress', label }); },
  rememberRequest(hotel, request) { if (current()) { priorHotel = hotel; priorRequest = request; } },
  privateQuote(lines) { if (current()) reviewedQuote = lines; },
  outcomeUnknown() { if (current()) outcomeUnknown = true; },
  confirmed(reference) { if (current()) { confirmedReference = reference; reviewedQuote = null; } },
};
  return chat;
}

function context(): Context {
  return {
    traveller: JSON.parse(read("../traveller.json")),
    today: new Date().toISOString().slice(0, 10),
    hotels: JSON.parse(read("../hotels.json")),
    signal: controller?.signal,
    revision,
    priorRequest,
    priorHotel,
  };
}

async function run(text: string) {
  const epoch = ++revision;
  controller = new AbortController();
  const chat = chatFor(epoch);
  running = true;
  emit({ type: "busy", on: true });
  try {
    await agentImpl(text, chat, context());
  } catch (e) {
    if (!controller.signal.aborted) {
      console.error('Agent run stopped:', e instanceof Error ? e.message.split(':')[0] : 'unknown error');
      chat.say('I stopped because I could not safely finish that step. The hotel browser is still available if you need to check it.');
    }
  } finally {
    if (epoch === revision) {
      running = false;
      waitingReply = null;
      invalidate();
      inbox.length = 0;
      emit({ type: "busy", on: false });
      emit({ type: 'progress', label: null });
      controller = null;
      if (pendingStart) { const next = pendingStart; pendingStart = null; void run(next); }
    }
  }
}

function stopCurrent(message = 'I stopped helping. This does not cancel a hotel reservation; the hotel window remains available.') {
  if (controller) controller.abort();
  suspendedCheckoutChoice?.resolve('stop');
  suspendedCheckoutChoice = null;
  privateDialogOpen = false;
  waitingReply?.('');
  waitingReply = null;
  invalidate();
  emit({ type: 'progress', label: null });
  emit({ type: 'busy', on: false });
  emit({ type: 'message', from: 'agent', text: message });
}

function showPrivateEditDialog(edit: string) {
  if (privateDialogOpen) return;
  privateDialogOpen = true;
  const liveCheck = [...waitingPress.entries()].find(([, pending]) => pending.allowed.has('check'));
  if (liveCheck) {
    waitingPress.delete(liveCheck[0]);
    suspendedCheckoutChoice = liveCheck[1];
  }
  // Disable old controls without resolving the agent's wait. Only the explicit
  // Submitted / not sure choice may resolve that wait as a verification request.
  emit({ type: 'invalidate' });
  const id = randomBytes(4).toString('hex');
  emit({ type: 'card', id, card: { title: 'Change this checkout?', lines: ['Has the booking already been submitted in the hotel window?', 'I will not inspect the hotel window while this decision is open.'], buttons: [
    { id: 'not-submitted', label: 'Not submitted — start a new search' },
    { id: 'submitted', label: 'Submitted / not sure — check booking' },
    { id: 'keep', label: 'Keep current checkout' },
  ] } });
  waitingPress.set(id, { allowed: new Set(['not-submitted', 'submitted', 'keep']), title: 'Change this checkout?', resolve: button => {
    privateDialogOpen = false;
    const restore = () => {
      if (!suspendedCheckoutChoice || !running) {
        emit({ type: 'message', from: 'agent', text: 'Automated checking is no longer connected to that hotel session. Please use the hotel confirmation page or email, or contact the hotel with the booking reference before starting another booking.' });
        suspendedCheckoutChoice = null;
        return;
      }
      const freshId = randomBytes(4).toString('hex');
      emit({ type: 'card', id: freshId, card: { title: 'You control the hotel browser', lines: ['Continue in the same hotel window. I only inspect after Check booking.'], buttons: [{ id: 'check', label: 'Check booking' }, { id: 'later', label: 'Still working' }, { id: 'stop', label: 'Stop checking' }] } });
      waitingPress.set(freshId, suspendedCheckoutChoice);
      suspendedCheckoutChoice = null;
    };
    if (button === 'not-submitted') {
      if (outcomeUnknown) {
        emit({ type: 'message', from: 'agent', text: 'I still cannot establish whether the earlier checkout completed. I cannot begin another booking while that outcome is unresolved.' });
        restore();
        return;
      }
      reviewedQuote = null;
      if (running) { pendingStart = edit; stopCurrent('I’ve stopped that checkout on your report that it was not submitted. I’m starting the revised search.'); }
      else void run(edit);
    } else if (button === 'submitted') {
      if (suspendedCheckoutChoice && running) {
        emit({ type: 'message', from: 'agent', text: 'I’ll check for a hotel confirmation. I will not start another booking while this outcome is unresolved.' });
        const pending = suspendedCheckoutChoice;
        suspendedCheckoutChoice = null;
        pending.resolve('check');
      } else {
        emit({ type: 'message', from: 'agent', text: 'I cannot inspect that earlier hotel session because automated checking has stopped. Check its confirmation page or email, or contact the hotel before starting another booking.' });
        suspendedCheckoutChoice = null;
      }
    } else if (button === 'keep') {
      restore();
    }
  } });
}

function travellerSays(text: string) {
  emit({ type: "message", from: "traveller", text });
  if (confirmedReference) {
    emit({ type: 'message', from: 'agent', text: `The hotel booking ${confirmedReference} is confirmed. Changes to a confirmed reservation need to be handled with the hotel.` });
    return;
  }
  if (isStop(text)) { pendingStart = null; stopCurrent(); return; }
  if (reviewedQuote) {
    if (isEdit(text)) { showPrivateEditDialog(text); return; }
    emit({ type: 'message', from: 'agent', text: 'The reviewed quote was:\n' + reviewedQuote.join('\n') + '\nThis is the quote we checked before handoff, not a live view of checkout.' });
    return;
  }
  if (running && isEdit(text)) { pendingStart = text; stopCurrent('I stopped the old search and will apply your revised request.'); return; }
  if (!running) return void run(text);
  const optionNumber = text.match(/^(?:select\s+)?option\s+(\d+)$/i)?.[1];
  if (optionNumber) {
    const offered = [...waitingPress.entries()].find(([, pending]) => pending.title.startsWith(`Option ${optionNumber}`) && pending.allowed.has('select'));
    if (offered) {
      waitingPress.delete(offered[0]);
      offered[1].resolve('select');
      emit({ type: 'pressed', card: offered[0], button: 'select' });
      return;
    }
  }
  if (waitingReply) {
    const r = waitingReply;
    waitingReply = null;
    r(text);
  } else inbox.push(text);
}

async function body(req: http.IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

return http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (req.method === "GET" && path === "/examples") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(EXAMPLES);
    }
    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      for (const e of history) res.write(`data: ${JSON.stringify(e)}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "busy", on: running })}\n\n`);
      listeners.add(res);
      req.on("close", () => listeners.delete(res));
      return;
    }
    if (req.method === "POST" && path === "/send") {
      const { text } = await body(req);
      if (typeof text === "string" && text.trim()) travellerSays(text.trim());
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "POST" && path === "/press") {
      const { card, button } = await body(req);
      const pending = waitingPress.get(card);
      if (pending?.allowed.has(button) && (!privateDialogOpen || pending.title === 'Change this checkout?')) {
        waitingPress.delete(card);
        emit({ type: "pressed", card, button });
        pending.resolve(button);
      }
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && path === '/stop') {
      pendingStart = null;
      stopCurrent();
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "POST" && path === "/reset") {
      if (running) { res.writeHead(409); return res.end(); }
      history = [];
      priorRequest = undefined;
      priorHotel = undefined;
      reviewedQuote = null;
      outcomeUnknown = false;
      confirmedReference = null;
      emit({ type: "reset" });
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createChatServer().listen(PORT, "127.0.0.1", () => console.log(`Chat   http://localhost:${PORT}`));
}

// The chat: a phone-width page at http://localhost:4200 where the traveller
// talks to your agent. Run with `npm run chat`. At the debrief we play the
// traveller here.
//
// One conversation, kept in memory. A message sent while the agent is idle
// starts a new agent run; a message sent while it's running answers its
// pending `chat.reply()` (or waits in a queue until it asks).

import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { agent } from "../agent.ts";
import type { Card, Chat, Context } from "../types.ts";

const PORT = Number(process.env.CHAT_PORT ?? 4200);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const PAGE = read("./page.html");
const EXAMPLES = read("../examples.json");

type Event =
  | { type: "message"; from: "traveller" | "agent"; text: string }
  | { type: "card"; id: string; card: Omit<Card, "image"> & { image?: string } }
  | { type: "pressed"; card: string; button: string }
  | { type: "busy"; on: boolean }
  | { type: "reset" };

let history: Event[] = [];
const listeners = new Set<http.ServerResponse>();
function emit(e: Event) {
  if (e.type !== "busy" && e.type !== "reset") history.push(e);
  for (const res of listeners) res.write(`data: ${JSON.stringify(e)}\n\n`);
}

let running = false;
const inbox: string[] = [];
let waitingReply: ((text: string) => void) | null = null;
const waitingPress = new Map<string, (button: string) => void>();

const chat: Chat = {
  say(text) {
    emit({ type: "message", from: "agent", text });
  },
  card(card) {
    const id = randomBytes(4).toString("hex");
    const image = card.image ? `data:image/png;base64,${card.image.toString("base64")}` : undefined;
    emit({ type: "card", id, card: { ...card, image } });
    return id;
  },
  choose(card) {
    const id = chat.card(card);
    return new Promise((resolve) => waitingPress.set(id, resolve));
  },
  reply() {
    const queued = inbox.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => (waitingReply = resolve));
  },
};

function context(): Context {
  return {
    traveller: JSON.parse(read("../traveller.json")),
    today: new Date().toISOString().slice(0, 10),
    hotels: JSON.parse(read("../hotels.json")),
  };
}

async function run(text: string) {
  running = true;
  emit({ type: "busy", on: true });
  try {
    await agent(text, chat, context());
  } catch (e) {
    console.error(e);
    chat.say(`Something went wrong on my side: ${String(e).slice(0, 300)}`);
  } finally {
    running = false;
    waitingReply = null;
    inbox.length = 0;
    emit({ type: "busy", on: false });
  }
}

function travellerSays(text: string) {
  emit({ type: "message", from: "traveller", text });
  if (!running) return void run(text);
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

http
  .createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", `http://localhost:${PORT}`).pathname;
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
      const resolve = waitingPress.get(card);
      if (resolve) {
        waitingPress.delete(card);
        emit({ type: "pressed", card, button });
        resolve(button);
      }
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "POST" && path === "/reset") {
      history = [];
      emit({ type: "reset" });
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Chat   http://localhost:${PORT}`));

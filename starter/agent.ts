// Your agent goes here. Today it opens the hotel, takes one look, shows the
// traveller a card and stops. Everything after the first look is yours.

import { openBrowser, observe, screenshot } from "./browser.ts";
import { RunLog } from "./log.ts";
import { notConfigured } from "./model.ts";
import type { Agent } from "./types.ts";

export const agent: Agent = async (message, chat, ctx) => {
  const log = new RunLog("chat");
  log.event("message", { message, traveller: ctx.traveller, today: ctx.today });

  // Which hotel? A plain name match is enough for the starter.
  const lower = message.toLowerCase();
  const [name, url] = Object.entries(ctx.hotels).find(([n]) => lower.includes(n.toLowerCase())) ?? [];
  if (!url) {
    chat.say(`Which hotel? I know: ${Object.keys(ctx.hotels).join(", ")}.`);
    return;
  }

  chat.say(`On it. Taking a look at ${name}.`);
  const { browser, page } = await openBrowser({ headless: process.env.HEADLESS === "1" });
  try {
    await page.goto(url);
    const seen = await observe(page);
    log.event("observe", { observation: seen });
    const png = await screenshot(page);
    log.screenshot(png, "start");

    // TODO: your agent. A model is waiting for you in model.ts.
    void notConfigured;

    const choice = await chat.choose({
      title: seen.title,
      lines: [`${seen.elements.length} things on this page I could click or fill in.`],
      image: png,
      buttons: [
        { id: "ok", label: "Looks right" },
        { id: "stop", label: "Stop" },
      ],
    });
    log.event("choice", { choice });
    chat.say(choice === "ok" ? "That's as far as the starter goes. The rest is yours to build." : "Stopped.");
  } finally {
    await browser.close();
    log.event("done", { dir: log.dir });
  }
};

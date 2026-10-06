# Halcy agentic checkout pack

**Start with [BRIEF.md](./BRIEF.md)**, which has the exercise, the ask and how the debrief works. This file is the technical companion.

## How to run

Everything below happens **inside this folder**. A terminal opened anywhere else will tell you it can't find a `package.json`. You'll need Node 20 or newer (`node -v` to check).

For first-time configuration, create a gitignored `.env` using `.env.example` and set `ANTHROPIC_API_KEY` there. Preserve an existing `.env`. The default uses direct Claude and a visible browser; `CHAT_PORT` can select an unused chat port without restarting an existing checkout.

```bash
npm install
npm run setup     # downloads the Chromium build Playwright drives (once)
npm run hotel     # terminal 1: the mock hotel; leave it running
npm run chat      # terminal 2: the chat; open http://localhost:4200
npm run typecheck
```

Pick one of the example asks under the message box (or write your own) and send it. The agent searches the hotel, shows observed room/rate choices, and prepares the one you select. Review the complete quote in chat before agreeing. Then use the same visible hotel browser window for card entry, bank verification, and final submission. Return to chat and press **Check booking** to request confirmation verification. The chat’s **Stop** control ends assistance; it does not cancel a hotel reservation.

- `HEADLESS=1 npm run chat` runs the browser without a visible window. On Windows PowerShell: `$env:HEADLESS="1"; npm run chat`.
- Use `localhost` addresses, not `127.0.0.1`: the hotel and its payment provider check each other's addresses when they talk.

## The mock hotel

| Address                                    | What it is                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| http://localhost:4100                      | **Casa Halcy**, a fictional twelve-room guesthouse in Lisbon. Its booking site                                                     |
| http://localhost:4101                      | **MockPay**, the hotel's payment provider. It serves the card fields inside the hotel's page and runs the bank's verification step |
| http://localhost:4101/__phone              | **The guest's phone**. Bank verification codes arrive here                                                                        |
| http://localhost:4100/__admin/bookings     | Every confirmed booking, and any card that went through without a booking, as JSON. For checking your runs                       |
| `POST` http://localhost:4100/__admin/reset | Clears all bookings and sessions                                                                                                  |

The flow is search, rooms, your details, payment, confirmation. There are two rates: one where the card is only held as a guarantee and you pay at the hotel, and one where you're charged in full now. Everything lives in memory and resets when you restart `npm run hotel`.

**The same browser, start to finish.** Like most real hotel sites, once the guest's details are in, the booking can only be completed in the browser session that started it. Opening the payment page somewhere else shows an error. Your hand-off has to work with that, because real hotels will make you.

**What your agent must never read.** `__phone` is the traveller's own phone, and the bank codes the hotel prints in its terminal are the same codes. Both stand in for something only the traveller has. Your agent must never read either one. Use them yourself to play the traveller when you test a hand-off. `__admin/bookings` is for you (and us) to check what was booked. It's not part of the hotel's website, so your agent shouldn't rely on it either.

### Test cards

| Card number           | What happens                            |
| --------------------- | --------------------------------------- |
| `4242 4242 4242 4242` | Approved after the bank's verification  |
| `4000 0000 0000 0002` | Declined by the bank after verification |

Any future expiry (e.g. `12/30`) and any 3-digit CVC. These are the only cards the mock accepts. Never type a real card into anything in this pack.

## The starter

| File                     | What it gives you                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `starter/agent.ts`       | Booking preparation, selected-rate quote validation, private handoff and local hotel-confirmation verification |
| `starter/chat/`          | The chat server (`npm run chat`) and its phone-width page. `chat.say`, `chat.card`, `chat.choose` (a card with buttons; waits for a press), `chat.reply` (waits for the traveller's next message) |
| `starter/types.ts`       | The shapes the chat and the agent share: `Traveller`, `Card`, `Chat`, `Context`                                                                           |
| `starter/browser.ts`     | Restricted main-document observation, fresh control IDs, guarded actions and browser ownership; raw screenshots are disabled |
| `starter/model.ts`       | Provider adapter interface, direct Claude structured-output requests and schema validation |
| `starter/offers.ts`, `starter/budget.ts` | Observed candidates, constraint classification, ranking and nightly/stay budget comparisons |
| `starter/config.ts`      | Environment configuration and runtime model-spend limits |
| `starter/log.ts`         | Run-event storage under `runs/`; the runtime uses sanitized events and does not invoke raw screenshot capture |
| `starter/traveller.json` | Who is chatting: the traveller's Halcy profile                                                                                                            |
| `starter/hotels.json`    | Hotel name to booking-site address. It stands in for Halcy's places database, and at the debrief we'll add a hotel your agent hasn't seen                 |
| `starter/examples.json`  | The example asks shown under the message box                                                                                                              |

`observe` excludes subframes and blocks sensitive top-level forms. During traveller control, browser observation and agent actions are disabled. **Check booking** permits restricted inspection only. The current coverage is conservative and does not establish safety for every unfamiliar hotel layout.

## Validation and design

```bash
npm run typecheck
node --import tsx --test scripts/test-agent-safety.mjs scripts/test-boundaries.mjs scripts/test-offers.mjs scripts/test-chat-coordinator.mjs
node --import tsx scripts/smoke-preparation.mjs
```

The browser tests and preparation smoke require the mock hotel to be running. The smoke intentionally stops at quote extraction and does not prove a booking. Follow [the human-assisted validation procedure](docs/validation-stage-one.md) for the complete flow and reviewer-only booking verification. That document records the actual evidence and remaining validation gaps. Start with [the documentation index](docs/README.md) for design decisions, diagrams and the submission draft.

Keep API keys out of the code. Read them from environment variables (export them in your shell, or load a `.env` file however you like; `.env` is gitignored here).

The mock hotel loads its fonts from Google Fonts and falls back to system fonts when you're offline. Nothing else in the pack needs the internet, apart from the model provider you choose.

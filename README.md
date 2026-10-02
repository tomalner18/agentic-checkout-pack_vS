# Halcy agentic checkout pack

**Start with [BRIEF.md](./BRIEF.md)**, which has the exercise, the ask and how the debrief works. This file is the technical companion.

## How to run

Everything below happens **inside this folder**. A terminal opened anywhere else will tell you it can't find a `package.json`. You'll need Node 20 or newer (`node -v` to check).

```bash
npm install
npm run setup     # downloads the Chromium build Playwright drives (once)
npm run hotel     # terminal 1: the mock hotel; leave it running
npm run chat      # terminal 2: the chat; open http://localhost:4200
npm run typecheck
```

Pick one of the example asks under the message box (or write your own) and send it. The starter agent opens the hotel, takes one look, and shows you a card.

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
| `starter/agent.ts`       | **Your agent.** Called with each new message from the traveller, plus a `chat` to talk back and a context. Today it takes one look at the hotel and stops |
| `starter/chat/`          | The chat server (`npm run chat`) and its phone-width page. `chat.say`, `chat.card`, `chat.choose` (a card with buttons; waits for a press), `chat.reply` (waits for the traveller's next message) |
| `starter/types.ts`       | The shapes the chat and the agent share: `Traveller`, `Card`, `Chat`, `Context`                                                                           |
| `starter/browser.ts`     | `openBrowser`, `observe` (visible text and interactive elements in every frame, each with an id), `act` (click / fill / select / check by id), `screenshot` |
| `starter/model.ts`       | A provider-agnostic `Model` interface and a placeholder. Implement it for the provider(s) you choose                                                      |
| `starter/log.ts`         | `RunLog`: one folder per run under `runs/`, an `events.jsonl` and numbered screenshots                                                                    |
| `starter/traveller.json` | Who is chatting: the traveller's Halcy profile                                                                                                            |
| `starter/hotels.json`    | Hotel name to booking-site address. It stands in for Halcy's places database, and at the debrief we'll add a hotel your agent hasn't seen                 |
| `starter/examples.json`  | The example asks shown under the message box                                                                                                              |

`observe` lists everything it can see, including what's inside the payment provider's frame. What your agent is allowed to look at and touch is a design decision, not a given.

Keep API keys out of the code. Read them from environment variables (export them in your shell, or load a `.env` file however you like; `.env` is gitignored here).

The mock hotel loads its fonts from Google Fonts and falls back to system fonts when you're offline. Nothing else in the pack needs the internet, apart from the model provider you choose.

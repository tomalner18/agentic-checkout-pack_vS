# The exercise

Hi! This is a design-and-build case for a fullstack role. We'd like you to design how Halcy books a hotel room for a traveller by driving the hotel's own website, doing as much of the work as possible on their behalf, and to build it so we can watch it run.

**Budget: 8 hours, maximum.** We expect you to use AI heavily (Claude, Codex, Cursor, whatever you run), and part of what we're testing is how far you get in that time. Speed counts. So does judgement: a working agent with a clear design behind it beats a polished document with nothing running.

## What Halcy is

Halcy is a group-travel app. Friends plan a trip together in one place, and an AI travel companion in the group chat helps them decide where to go, what's worth their time, and how to book it. Think of it as your coolest and most helpful friend, inside an app.

Halcy **advises and helps people book.** In this case, Halcy is not the seller: the traveller books directly with the hotel, their contract is with the hotel, and the hotel takes their money.

## The problem

Someone in the group chat writes:

> Can you book us a room at Casa Halcy for the second full weekend of next month, Friday to Sunday? River view if they have it, otherwise whatever's nicest. We need to be able to cancel. No breakfast, we'll go out.

Design the flow that turns that message into a confirmed booking, with Halcy doing **as much as possible** and the traveller doing **as little as possible**, without ever surprising them about what they pay, when, and to whom.

**Treat Casa Halcy as an example, not the target.** Your agent has to work on hotel sites it has never seen. At the debrief we'll run it on one.

There are three questions we want you to answer:

1. **Model selection.** Which models (and how many) do which jobs in your system, and why? Think about accuracy, speed, cost per booking, and what happens when a model is wrong. Say what you'd measure to know you chose right.
2. **Staying out of payments.** Halcy must never handle the traveller's payment: a company that holds or passes on other people's money needs a licence to do it, and we want to stay well clear. Explain why your design keeps Halcy out: who sees the card number, who holds the money and when, and who proves the traveller agreed. Draw it. Then say what change to your design would pull Halcy in, and where you're unsure.
3. **The best user journey.** What the traveller sees and does from that chat message to a confirmation, including when things go wrong: the room they asked for is gone, the price moved, the card is declined, their bank wants to confirm it's them, they go quiet halfway through. Sketches, screen mockups or a written walk-through are all fine.

## Constraints

- **Halcy is never presented as the seller.** The hotel is. Nothing in your journey should suggest otherwise.
- **No real money and no real hotels in your prototype.** Use the mock hotel in this folder. You're welcome to study real hotel sites for research, but don't automate bookings on them.
- **One hotel booking only.** No flights, no bundles, no combined trip prices. Selling several kinds of travel together brings a different set of rules, which is out of scope here.
- **The traveller is never surprised.** Whatever they end up paying, now or at the hotel, they knew before they agreed.

## What's in this folder

- **A mock hotel** (`mock-hotel/`): Casa Halcy, a fictional independent hotel that only borrows our name. To the traveller it is the hotel, not Halcy. It's a small but realistic hotel booking site, with its own payment provider on a separate address the way real hotel sites work. It behaves like a real hotel site, including some of the less charming parts. Like most real hotel sites, a booking can only be finished in the browser that started it. Its bank verification step can only be completed by the traveller. A test page lists every booking made, so you can check what your agent actually booked.
- **A starter** (`starter/`). **Your agent runs in the chat in `starter/`, and we'll play the traveller.** The chat is a bare phone-width page: messages, plus cards with a picture, a link or buttons. Everyone starts from the same place, and you can change it as much as your design needs. Behind it is TypeScript plumbing for driving a browser with Playwright, a seam for plugging in any model provider, and a run log with screenshots. There is no agent in it. That part is yours.

`README.md` has how to run everything. You can build on the starter or replace parts of it, but keep the chat as the way the traveller talks to your agent.

## The ask

1. **A design document** (about 4 pages, plus diagrams) that covers the three questions above, and also:
   - the architecture: what runs where, and what happens step by step when a booking runs
   - the diagram from question 2 of how money and card details move
   - failure modes: what can go wrong, how you detect it, and what the traveller sees
   - how you'd know it works before launch: what you'd test it against and what numbers you'd look at
2. **A working prototype in the chat** that books what the traveller asked for on the mock hotel, as far as your design says the agent should go, with run logs we can look at.
3. **A short closing note**: what you deliberately left out, what you're least sure about, and what you'd build next.

**Keep your AI chat logs** (exports or screenshots are fine). We'll ask what you asked, what the tools got wrong, and what you overruled.

## Costs

Use your existing AI subscriptions for the normal coding work. If that doesn't work for you, tell us. We'll reimburse the API calls your agent itself makes, **up to $50**: send us the receipts or usage statements with your submission. If you think you'll need more than that, ask us before you spend it.

## The debrief (60 minutes, together)

You'll run your agent live in the chat while we play the traveller, on requests we choose on the day, including one on a hotel site it hasn't seen. Then it's a working conversation, not a presentation. Expect us to:

- ask you to draw your money flow on a whiteboard and walk us through it
- push on your model choices: why that model for that job, and what it costs per booking
- ask what happens to the traveller at each point where your flow can fail
- go through your AI chat logs with you, and ask where the 8 hours went

## Questions

Ask Alva at alva.aqvist@halcy.site. We reply within 24 hours. Asking good questions counts in your favour.

## Practicalities

- Nothing here connects to Halcy's systems, and you don't need a Halcy account.
- Send back a zip or a repo link when you're done. Include your design document, your closing note, the run logs you want us to see and your AI chat logs. Leave out `node_modules` and any API keys.

Have fun with it. We're hoping you show us something we haven't thought of.

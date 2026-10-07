# Traveller journey and recovery decisions

Agreed behaviour, 2026-10-06. This is the product specification for the prototype, not a claim that every branch is implemented. See [system design](system-design.md), [architecture](architecture-stage-one.md), and the [mobile UI research](research/mobile-chat-booking-ui-ux.html). Use basic cards, text chips and a confirmation dialog for this stage; final layout and copy remain open to design work.

## From request to verified booking

| Stage | Traveller sees or does | Agent responsibility |
| --- | --- | --- |
| Request | Asks for a hotel and stay in chat, possibly over several messages | Retain each supplied field; resolve relative dates; separate hard constraints, exclusions, preferences and ordered priorities |
| Clarification | Supplies only missing required details | Use group count when available, explicit occupancy first; otherwise ask count, assume a bare number means adults; ask child ages only if needed |
| Search | Activity status and X/Stop | Search visible hotel pages; remove unwanted optional extras; explain ordinary retries |
| Options | All observed verified eligible room/rate offers and why they are ordered that way | Apply stated priorities in order; otherwise rank by evidenced preference fit, then comparable price; preserve unknown facts and provisional prices |
| Choice | Selects a specific room/rate | Revalidate selected availability; do not substitute another offer silently |
| Near miss, when needed | Separate choices labelled with unmet requirements; explicit conflict dialog on selection | Obtain offer-specific exception acceptance; leave original search constraints intact |
| Preparation | Brief progress updates | Fill ordinary guest details and take conventional preparatory actions; stop at an identified commitment/payment boundary |
| Full quote | Room/rate, dates, guests, inclusions, cancellation deadline/penalties, total/currency/taxes, now/later split, guarantee and hotel recipient | Validate evidence against the chosen offer; block an incomplete or contradictory quote |
| Agreement | Explicitly agrees to the complete quote | Bind agreement to quote version; recheck and ask again if material terms change |
| Private checkout | Uses the same hotel browser; chat remains available | Revoke observation/actions before sensitive interaction; answer quote questions from stored evidence |
| Check booking | Explicitly asks for inspection | Read only safely observable hotel content; require a reference and matching booking details |
| Outcome | Confirmed reference and details, or a clear unresolved status | Preserve the distinction between booking confirmation, payment approval and traveller report |

For the example request, cancellation flexibility is a hard requirement, river view a soft preference, and breakfast an exclusion. A hotel-wide river photograph does not establish that a room has a river view. Refundability is not a universal filter for other requests. Removable breakfast is deselected; mandatory breakfast conflicts with an explicit exclusion. Do not silently split a party across rooms or invent guest details.

## Eligibility, prices and near misses

Each candidate needs room/rate identity and supporting observed evidence. An unknown hard requirement does not count as met: inspect available detail or state that it remains unverified. Show all eligible options actually observed, without implying exhaustive hotel inventory coverage.

Initial ranking applies the traveller's stated order, such as river view first and then visible room quality, or cheapest comparable stay first. Without an explicit order, it uses evidenced soft-preference fit and then ascending comparable price. Room quality uses visible tier, size and amenity cues; price alone does not establish quality. Search prices may be nightly, exclude tax, or refer to different occupancy; normalize only when the evidence supports it and label incomplete totals. Do not compare a nightly subtotal with a full stay total as though equivalent.

If no verified eligible option exists, show useful near misses separately. Highlight known hard conflicts with explicit text, soft misses as preferences, and unknowns as unverified. Colour can reinforce those categories; it cannot replace the wording. A reasonable initial near-miss ranking is fewer known hard conflicts, preference fit, then comparable price; that is an implementation default, not a claim that all constraints have equal personal importance.

Selecting a near miss opens a dialog listing every known hard conflict. “Continue with this option” accepts only those exceptions for that offer and request revision. It neither changes the original request nor launches another search. Dismissal grants nothing. New conflicts require another decision; unknown facts must not be described as known exceptions. Final quote agreement still follows preparation.

When a chosen offer becomes unavailable, retain its card as unavailable and disable its actions. Show saved eligible alternatives ordered by absolute distance from its original comparable price. Include higher prices unless an explicit budget excludes them. Cached availability remains provisional and the traveller chooses. With no saved alternatives, announce the new search before beginning it. Do not crawl extra offers just to fill a cache or search over an unresolved checkout session.

## Chat during private checkout

Keep the composer open. “Why do they need a card if I pay at the hotel?” or “What was the cancellation deadline?” can be answered from the reviewed quote, clearly identified as such. A user report that the current price differs is a reason to pause and recheck with permission, not an invitation to guess what the browser shows. Do not ask for card data, bank codes or payment screenshots.

A requested date/room/guest change opens a submission-status dialog. Suggested functional copy, subject to later UI refinement:

> **Change your booking details?**
> Have you submitted the booking in the hotel window?
>
> **Not submitted — start a new search**
> **Submitted / not sure — check booking**
> **Keep current checkout**

Save pending edits without acting on the browser while this dialog is open. A report of no submission permits abandoning preparation and a revised search; record it as traveller-reported. Submitted/unsure requests restricted inspection first. If a matching booking exists, report it and finish this task; do not create a replacement or imply an amendment. If the outcome cannot be established, preserve the session and block another booking attempt. “I have not paid” is insufficient because pay-at-hotel reservations can already be confirmed.

Avoid “Cancel booking” for this control. Stop assistance leaves the hotel reservation/session untouched; actual cancellation, amendment and refund operations are outside scope.

## Interruptions

An X beside the active agent and an explicit text request to stop reach the same cancellation operation. Stop ends current assistance and clears that step's transient loaders. Keep earlier messages and cards as history; disable stale actions. It does not erase the conversation or claim a hotel cancellation.

Edits during search/preparation revoke old work and start a revised search with unchanged fields retained. Discard late model results and stale progress/card events. Already-dispatched hotel actions may still complete and need outcome reconciliation before session reuse. During private checkout, edits follow the dialog above instead of restarting immediately. Ordinary questions do not implicitly replace the request.

## Failure and edge-case map

| Trigger or evidence | Coordinator response | Traveller experience |
| --- | --- | --- |
| Preferred river room unavailable | Preserve hard constraints; keep eligible rooms | Eligible alternatives, with the missing preference labelled |
| Selected room/rate sold out | Invalidate old choice/approval; reuse candidate snapshot or search | Unavailable old card plus selectable alternatives; no automatic replacement |
| No hard-constraint match | Present separately identified near misses | Explicit conflicts and option-specific exception dialog |
| Missing/contradictory terms or costs | Inspect safe details; withhold complete-quote approval if unresolved | Specific unverified fact and a request for human review if needed |
| Tax or price appears at checkout | Recompute complete quote; identify differences | Full total before agreement; fresh agreement after material changes |
| Ordinary navigation/network failure | Fresh observation and at most two ordinary retries | Brief retry/checking status; help-needed if exhausted |
| Action timeout or stale ID | Consume ID and inspect current state; do not replay a submission blindly | Checking the previous step, rather than a false success |
| Date unavailable or calendar ambiguous | Respect disabled dates; inspect/fallback | Date clarification or human help, never a forced DOM value |
| Guest validation error | Correct ordinary fields only from known data; ask if missing | Focused clarification; sensitive identity work remains private |
| Card declined or bank verification needed | Retain traveller control | User retries/uses another method with the hotel; agent needs outcome, not bank diagnostics |
| Payment approved; hotel confirmation delayed/lost | Outcome unknown; restricted checks only on explicit request | No “booked” claim and no automatic second booking |
| Hold expires, including during bank verification | Do not renew or infer failure from the timer alone | Check existing outcome before new preparation |
| Traveller goes quiet | Pause; allow hold to expire | Existing conversation/session available on return |
| Confirmation contradicts agreed details | Preserve discrepancy; do not call it a matching success | Explain mismatch and direct to hotel; no amendment/cancellation automation |
| Login, CAPTCHA, ID upload, unsupported payment layout | Stop before sensitive content; private help where possible | Human assistance; these journeys are deferred implementation scope |
| Browser/service crash | Stop; no automatic replacement for a possibly submitted booking | Manual reconciliation; durable recovery is future scope |
| Model/API failure or budget exhausted | Stop bounded work and preserve outcome uncertainty | Clear inability to continue; no silent provider switch |

The endpoint is a verified booking communicated to the traveller, or an honest inability to verify/continue. The prototype does not manage the stay after confirmation.

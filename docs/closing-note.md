# Closing note — initial draft

Halcy should do the search and preparation while keeping the traveller in control of the chosen room, accepted exceptions, final terms and binding submission. The difficult parts are establishing what the website means, keeping agreement current, and handling a possibly successful booking without creating a second one.

## Deliberately left out

One hotel booking and one in-memory conversation keep the prototype bounded. Flights, bundles, confirmed-booking amendments/cancellations, refunds, durable crash recovery and production multi-user isolation are excluded. The local same-browser handoff is a demonstration, not finished mobile checkout infrastructure. Broad embedded-engine support, dedicated login/CAPTCHA/identity journeys, a polished design system and multi-model routing are deferred. The model is not given mock internals to make the demo easier.

## Least certain

The largest product trade-off is inferring that conventional Continue to payment steps are preparatory when no warning is visible. That reduces interruption, but a poorly labelled hotel could behave unexpectedly. The largest technical uncertainty is reliably isolating sensitive surfaces and preserving offer evidence across unfamiliar layouts. Missing confirmation after an apparent payment remains a real unresolved state, not a failure we can always repair automatically. The regulatory position requires assessment of the actual production activity and data path.

## What I would build and measure next

First finish and independently verify the human-assisted mock run, then exercise recovery and interruption races. Test held-out local layouts and study real-site journeys without automating real bookings. Measure quote accuracy, unnecessary handoffs, recovery success, latency and total spend per verified booking before choosing a smaller model or an escalation policy. Use the mobile research to refine cards and handoff comprehension once the states are reliable. Production work would then address durable reconciliation, multi-user isolation and a reviewed browser/payment architecture.

## Before submission

Replace provisional evidence with the final validation record and booking reference, or state plainly which human step remains incomplete. Report actual runtime spend and attach provider receipts. Include selected sanitized run logs and AI chat exports, explaining significant corrections such as strengthening evidence validation and revising the overly restrictive continuation rule. Report the actual work timeline against the eight-hour brief; do not invent elapsed effort or performance numbers. Exported artifacts must exclude credentials, payment data and dependency folders.

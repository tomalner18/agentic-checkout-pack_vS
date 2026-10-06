# Design documentation

Start with the [design document draft](design-document-draft.md), the initial narrative for the brief's approximately four-page submission plus diagrams. It is a working draft and distinguishes design intent from reported validation. Use the focused documents below as its source material.

- [Architecture and design decisions](architecture-stage-one.md): agreed first/second-stage policies, rationale and scope; original filename retained for existing references.
- [System design and data flow](system-design.md): component boundaries, authoritative records, booking sequence, state transitions, interruptions and audit evidence, with editable Mermaid diagrams.
- [Traveller journey and recovery](booking-journey.md): option ranking, near misses, approval, open chat during checkout, Stop/edit behaviour and failure cases.
- [Payment boundaries](payment-boundary.md): card and money flow, browser permissions, three consent records, legal uncertainties and changes requiring reassessment.
- [Model selection research](model-selection-spike.md): provider comparison, pricing assumptions, the Claude baseline, and evaluation criteria.
- [Validation procedure](validation-stage-one.md): repeatable checks and the human-assisted mock booking procedure.
- [Closing note draft](closing-note.md): deliberate omissions, principal uncertainties, next work and evidence needed before submission.
- [Mobile chat and agentic-booking UI/UX research](research/mobile-chat-booking-ui-ux.html): Mobbin-based patterns for agent activity, hotel comparisons, approvals, handoff, and outcomes.

## Coverage of the assignment

| Requirement in [BRIEF.md](../BRIEF.md) | Documentation / evidence location |
| --- | --- |
| Model roles, accuracy, speed, cost, errors and measurement | Draft §3 and §6; model research; validation procedure |
| Who sees the card, who handles funds, who records agreement | Payment boundaries and its diagram; draft §4 |
| Changes that alter payment scope; uncertainty | Payment boundaries; closing note |
| Chat-to-confirmation journey and failure behaviour | Traveller journey; draft §5 |
| What runs where and step-by-step data flow | System design; architecture; draft §2 |
| Room unavailable, repricing, decline, bank check, user absence | Journey failure map; validation scenarios |
| Tests and metrics before launch, unfamiliar sites | Validation procedure; model evaluation plan; draft §6 |
| Working mock prototype and run logs | Runtime is outside docs; follow [README.md](../README.md). Validation record links the available run evidence and pending human steps |
| Approximately four-page design document plus diagrams | Design document draft is the starting source; edit for length and render Mermaid diagrams for the final format |
| Short closing note | Closing-note draft |
| AI chat logs, corrections and exercise time budget | Export selected AI conversations separately; describe corrections and actual timeline using closing-note prompts |
| Runtime API cap and receipts | Model research describes the $50 cap; attach actual provider usage/receipts separately |
| Final zip/repository without secrets or dependencies | Include docs, selected sanitized run evidence, AI logs and receipts; omit credentials, payment data and node_modules |

## How to maintain these documents

Focused documents hold the detailed decisions. The design draft is intentionally a condensed synthesis and should be updated when those decisions change. Validation results belong in the validation record, with dates and evidence; diagrams and proposed journeys do not establish that a test passed. Model pricing is a dated research snapshot, not a standing guarantee of current pricing.

Temporary worker assignments and handoffs remain in the operating system's temporary directory, outside this documentation set. The stage-two handoff is not a permanent design source. No changes to the original assignment in BRIEF.md are required.

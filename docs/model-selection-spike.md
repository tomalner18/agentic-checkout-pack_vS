# Model selection research spike

Researched 2026-10-05. Decision: direct Claude is selected for the first implementation. This is documentation research, not a completed comparative model evaluation; the costs below are illustrative. Check account access when configuring a deployment and record implementation/test status separately.

## Recommendation

Start with the existing Anthropic account and direct Messages API, using `claude-sonnet-5-5` as the configurable baseline. Use one model for request interpretation, offer extraction, and proposing browser actions. Keep separate prompts/schemas for these responsibilities, while keeping authoritative booking state in application code. Status updates and approved booking cards should render from that state.

Use the provided observe/act interface as custom tools. A screenshot-driven computer-use model is not required for this stage. Restrict observations before they reach any model, and validate proposed actions against the current observation and coordinator state. Structured output enforces shape, not factual correctness or authority to act.

Code owns browser control, observation restrictions, consent versions, money arithmetic, stale-result invalidation, retry budgets, and the private traveller handoff. Page content remains untrusted evidence. The traveller performs the final reservation submission. A stronger model never gets broader permissions.

The research supports a tool-calling workflow with application-controlled execution, but does not establish one industry-standard vendor. Anthropic recommends starting with simple composable systems; OpenAI and Gemini document equivalent application-executed function-calling loops.

Sources: [Anthropic agent patterns](https://www.anthropic.com/engineering/building-effective-agents), [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling).

## Candidate economics

USD per million tokens at published standard rates, uncached input, short per-request context where applicable. The illustrative run uses 120,000 aggregate input tokens and 12,000 aggregate billable output tokens across all calls. This is a planning assumption, not a measured average; token counts differ across providers. Reasoning output must be included in real accounting. Figures exclude cache writes/reads, hosting, gateway fees, taxes, and additional retries.

| Candidate | Input | Output | Illustrative run | Suggested role |
| --- | ---: | ---: | ---: | --- |
| Claude Sonnet 5.5 | $2 | $10 | $0.36 | Initial baseline |
| Claude Opus 5.5 | $4 | $20 | $0.72 | Later difficult-page comparison/escalation |
| Claude Haiku 4.5 | $1 | $5 | $0.18 | Later narrow-task comparison |
| GPT-6.1 Sol | $2 | $10 | $0.36 | Comparable-price alternative to evaluate |
| GPT-6 Luna | $0.10 | $0.50 | $0.018 | Cheap focused-task candidate; validate quality |
| Gemini 3.8 Flash | $0.75 | $3.75 | $0.135 | Lower-cost worker candidate to evaluate |

Gemini rates shown are promotional through 2026-12-31; published rates double on 2027-01-01. Do not rank candidates by token prices alone. Failed runs and repeated steps contribute to cost per verified successful booking.

Sources: [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Claude models](https://platform.claude.com/docs/en/models/overview), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [OpenAI model roles](https://developers.openai.com/api/docs/guides/latest-model), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Routing and subsequent optimization

Use a provider adapter and configured model ID. Keep a stable model during a baseline run. First optimize compact observations, bounded history, concise outputs, and appropriate reasoning effort. Cache stable prompt prefixes only after measuring their actual benefit; that is separate from caching observed hotel offers.

Later, compare bounded escalation to Opus on observable failures such as repeated non-progress or conflicting extracted terms. Missing website information and ambiguous payment outcomes cannot be resolved merely by changing models. Do not use self-reported confidence as the only routing signal. An escalation must receive current sanitized state and evidence, without replaying website mutations.

OpenRouter is useful for evaluating multiple vendors through one gateway and configuring provider fallback. It adds a vendor relationship and routing configuration to a prototype that already has direct API access. Its standard platform fee is 5.5%; its pay-as-you-go fee is applied to credit purchases. If adopted later, explicitly configure eligible providers, privacy settings, parameter support, and permitted fallbacks; log the actual model/provider. Inference failover must never automatically retry a hotel submission.

Sources: [OpenRouter pricing](https://openrouter.ai/pricing), [fee mechanics](https://openrouter.ai/blog/insights/openrouter-vs-litellm/), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

## Local models

A small local model may later help with narrow intent classification, extracting simple edits, or routing a message to an existing application action. Google documents FunctionGemma as a 270M model specialized for function calling, illustrating this category; it is not evidence of reliable unfamiliar-hotel navigation.

Do not use a tiny local model as the sole interpreter of cancellation obligations, confirmation evidence, or the payment observation boundary without task-specific evaluation. Local operation removes an external inference request, but does not make sensitive data safe to collect or log. Hardware, concurrency, energy, deployment, and maintenance costs remain; no local latency or memory measurements were made. Many proposed small tasks, especially progress text, arithmetic, and permission enforcement, need ordinary code rather than another model.

Source: [FunctionGemma model card](https://ai.google.dev/gemma/docs/functiongemma/model_card).

## Evaluation plan

Compare variants on the same scenarios, with repeated runs and held-out layouts. Use saved sanitized observations for request/extraction comparisons, then full browser runs on the mock for action and recovery behavior. Do not automate real hotel bookings. The traveller alone completes bank verification. Test harnesses may inspect mock admin results; runtime code may not.

Measure:

- Verified end-to-end booking completion, respecting the requested constraints and expected human handoffs.
- Accuracy of dates, occupancy, room/rate, total including taxes, cancellation terms, payment timing, and recipient.
- Constraint violations, unsupported claims of success, unauthorized submissions, duplicate booking attempts, and sensitive observation/log leakage. Any such incident blocks promotion of a candidate; a small zero-failure sample is not a proof of safety.
- Median and p95 automated completion time, excluding traveller waiting; time to first useful proposal; model-call latency and steps per run.
- Total inference spend across successful and failed attempts divided by verified successful bookings, plus retry and escalation rates.
- Unnecessary user interruptions, recovery success, and correct stopping on unresolved outcomes.

Scenarios include preference unavailable, no qualifying room, preselected extras, newly disclosed tax, price change, stale elements, ordinary network errors, hold expiry, decline/retry, and payment success without a verified booking. Check false confirmations and attempts to repeat uncertain submissions explicitly.

The brief permits up to $50 in runtime API spend. Track cumulative usage and apply a conservative stopping margin before that cap; do not spend the entire budget on model comparisons. Start with the working baseline, then use remaining time and budget for a small comparative evaluation. Provider documentation supports suitability, not a claim that any candidate is best for this workload.

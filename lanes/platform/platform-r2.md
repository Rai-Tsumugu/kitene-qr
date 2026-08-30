# Platform lane r2

Status: PASS for feasibility review; no external resources created.

## Verified local capability

- Retrieved 2026-08-29 JST.
- Node.js `v24.13.1`, npm `11.16.0`, Wrangler `4.127.0` are executable.
- `wrangler whoami` succeeded with an authenticated Cloudflare account and Workers/D1 write permissions. Account identifiers and credentials are intentionally not copied here.
- The run has a dedicated workdir. Existing `Sapporo-Akari` and `AI_beginner` apps are not implementation templates for this run and will not be modified or reused.

## Recommended base architecture

Use a new, framework-light Cloudflare Worker with static assets in this workdir:

```text
mobile browser
  -> Worker Static Assets: one primary screen
  -> /api/* Worker: only if the selected idea needs server behavior
  -> D1: only if a participant action must survive reload or be shared
```

- Default: vanilla TypeScript + semantic HTML/CSS, no login, no external AI API, no R2, no Durable Object.
- Add D1 only for a selected idea whose core proof requires persisted invitation/commitment/check-in data.
- Add polling only if a second client must observe the change. Do not add realtime infrastructure for a single-person private flow.
- Generate guest/session identifiers with Web Crypto; use an idempotency key for retried writes.
- Store no real name. Use a local-only alias such as `N` and allow all event details to be demo data.

## Why this fits 120 minutes

- Static assets and a small Worker API share one deployable unit and HTTPS URL.
- The main uncertainty is the product intervention, not framework or infrastructure compatibility.
- No AI dependency means the demo cannot fail from model latency, quota, prompt drift, or paid inference.
- A D1 schema can remain at two tables if required: `sessions` and `actions`. If the selected idea does not need persistence, both are cut.

## Current cost and limits evidence

| Claim | Official evidence | Fit | Confidence |
|---|---|---|---|
| Static asset requests are free and unlimited; asset storage has no additional cost. | Cloudflare Workers Static Assets billing, accessed 2026-08-29: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ | The UI can be served without dynamic-request cost. | High |
| Workers Free lists 100,000 requests/day, 10 ms CPU/request, 128 MB memory. | Cloudflare Workers limits, accessed 2026-08-29: https://developers.cloudflare.com/workers/platform/limits/ | Adequate for a short event demo if API work stays small. | High |
| D1 Free lists 5 million rows read/day, 100,000 rows written/day, 5 GB total storage. | Cloudflare D1 pricing, accessed 2026-08-29: https://developers.cloudflare.com/d1/platform/pricing/ | Far above expected demo volume, but existing account-wide usage is unknown. | High |
| Workers Paid has a minimum monthly charge of USD 5; paid activation is unnecessary for the base MVP. | Cloudflare Workers pricing, accessed 2026-08-29: https://developers.cloudflare.com/workers/platform/pricing/ | Avoids a new recurring cost. | High |

Pricing and limits are current as retrieved and may change. Account-wide quota consumption has not been inspected.

## Candidate-dependent variants

1. Private rehearsal / personalized arrival plan: static assets plus client state; simplest and lowest failure risk.
2. Senior-to-N invitation handoff: Worker API + D1, one short unguessable handoff token, expiry, no personally identifying fields.
3. Live buddy matching: D1 + polling, but only after matching safety and no-show behavior are explicit. This is highest product and moderation risk and should not be the default.

## External-change boundary

- Safe and complete now: local capability and official-cost verification.
- Requires explicit environment notice after idea/UI approval: create staging Worker/D1, apply remote migration, set secrets if any, deploy staging.
- Not authorized: production deployment, production migration, paid-plan activation, real-user messages, or paid external AI calls.

## Risks / cuts

- The Cloudflare account is authenticated, but namespace quotas and existing daily usage are unknown until resource selection.
- A public anonymous write endpoint needs input length limits, schema validation, rate limiting or Turnstile if exposed beyond the demo window.
- Never make open stranger matching or location disclosure part of the 2-hour MVP.
- If deployment is not healthy by minute 90, freeze features and ship the static or single-write variant with a clearly labeled fallback.

## Handoff

- The platform does not constrain candidate selection except that open matching is discouraged.
- After candidate approval, route through `public-mvp-architecture` before requirements if participants need to open or share the result; otherwise proceed to `requirements-definition` and a static Worker prototype.

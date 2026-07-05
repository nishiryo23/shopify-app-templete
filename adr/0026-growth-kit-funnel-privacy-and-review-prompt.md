# ADR-0026 Growth kit funnel privacy and review prompt

- Status: Accepted
- Date: 2026-07-05
- Owners: template maintainers

## Context
P-009 adds the template-level growth kit: funnel events, onboarding progress, review request UI, uninstall measurement, and listing asset guidance. These features create new persisted state and a review prompt state machine, so privacy, retention, route behavior, and Shopify review constraints need a repo-local truth source before implementation.

The template still stays inside the launch platform boundary: no Orders / Customers / Discounts scopes, no Protected Customer Data, no off-platform billing, and no new webhook policy.

## Decision
- `FunnelEvent` stores `shopHash`, `event`, `occurredAt`, and allowlisted `metadata`. It never stores raw `shopDomain`.
- `shopHash` is the HMAC pseudonym produced by the existing `TELEMETRY_PSEUDONYM_KEY` policy. In production, missing pseudonym configuration is a deploy/startup validation failure rather than a webhook ingress concern. In non-production, missing pseudonym configuration makes funnel writes no-op.
- Webhook ingress must not call telemetry pseudonym-key validation before HMAC verification or compliance cleanup. Mandatory privacy webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) and `app/uninstalled` must continue their ingress path when telemetry or funnel snapshot recording is unavailable.
- `TELEMETRY_PSEUDONYM_KEY` rotation is intentionally not implicit. The first FunnelEvent read/write boundary that can resolve a key persists a SHA-256 fingerprint of the decoded key in `TelemetryPseudonymKeyFingerprint`, but only when the `FunnelEvent` table is empty. If the fingerprint row is missing while any `FunnelEvent` row exists, the app fails fast before shop-redact artifact deletion, raw growth cleanup, or FunnelEvent deletion. Recovery is manual: restore the previous `TELEMETRY_PSEUDONYM_KEY` and fingerprint row from backup, or run a documented one-off maintenance migration that hard-deletes or rewrites all `FunnelEvent.shopHash` rows before inserting the new fingerprint. Later use with a different fingerprint fails fast the same way. The template does not ship a keyring.
- `FunnelEvent` has nullable `dedupeKey` plus `@@unique([shopHash, event, dedupeKey])`. Once-only events use a stable `dedupeKey` and `createMany({ skipDuplicates: true })` for durable idempotency. They must not rely on a `findFirst` application-side race check or catch unique-violation exceptions inside an interactive transaction.
- Funnel vocabulary is fixed to:
  - `installed`
  - `onboarding_step_completed`
  - `activated`
  - `plan_selection_viewed`
  - `subscription_active`
  - `uninstalled`
- Funnel metadata is event-specific allowlist only:
  - `installed`: `source`
  - `onboarding_step_completed`: `stepId`, `completedStepCount`, `totalStepCount`
  - `activated`: `activationSource`, `completedStepCount`, `totalStepCount`
  - `plan_selection_viewed`: `entitlementState`, `hasPlanSelectionUrl`
  - `subscription_active`: `entitlementState`, `subscriptionStatus`, `subscriptionNamePresent`
  - `uninstalled`: `installedAt`, `tenureDays`, `lastEntitlementState`, `onboardingCompletedSteps`, `onboardingTotalSteps`, `onboardingCompletionRate`
- Metadata keys outside the allowlist are rejected. Customer PII fields such as name, email, phone, and address are rejected even if nested in a future caller payload.
- FunnelEvent retention is 90 days. This is long enough for weekly/monthly funnel review across public app review and early merchant activation cycles, while limiting persistent pseudonymous telemetry. Retention sweep hard-deletes events older than 90 days.
- `FunnelEvent` keeps an `occurredAt` index for retention sweeps and a `shopHash, occurredAt` index for merchant-scoped weekly summaries.
- `/app/growth/funnel-summary` is an authenticated merchant app route. It resolves the current authenticated shop to `shopHash` and returns only that shop's weekly funnel counts. It must never return all-shop aggregates to a merchant session.
- Cross-shop funnel analysis, if needed by template maintainers or developers, belongs in direct DB queries or external internal BI tooling outside the embedded app route surface. The template intentionally does not add an internal-secret app route for all-shop aggregation because current-shop scoping is simpler to review and harder to misuse.
- `app/uninstalled` records one pseudonymous `uninstalled` snapshot before deleting raw shop-bound growth state. The snapshot keeps no raw shop domain and no customer PII. Snapshot recording and raw growth cleanup are separate operations: fingerprint mismatch, missing pseudonym configuration, or snapshot insert failure is logged as best-effort telemetry and must not prevent deletion of `OnboardingProgress`, `GrowthState`, and `ReviewRequestState` or prevent webhook processing.
- `shop/redact` hard-deletes all growth data for the shop: `FunnelEvent` by `shopHash`, plus raw shop-bound `OnboardingProgress`, `GrowthState`, and `ReviewRequestState`. The template does not keep an anonymized post-redact copy.
- Onboarding step ids are `plan_selection_viewed`, `subscription_active`, and `activated`. The template-level `activated` step represents the app-defined first value action and is intentionally easy for forked apps to replace.
- Merchant POST actions can complete only onboarding steps whose registry `actionKind` is `complete`. Passive/system steps such as `plan_selection_viewed` and `subscription_active` are completed only by their system flows.
- Completing the `activated` step is an idempotent transaction: it ensures `OnboardingProgress` with `createMany({ skipDuplicates: true })`, repairs a missing `GrowthState.activatedAt` with a conditional `updateMany`, and records the once-only `activated` funnel event with `createMany({ skipDuplicates: true })`. Existing progress rows must not prevent `activatedAt` repair, and unique violations are not used as control flow inside the transaction.
- Review prompt is shown only when all of the following are true:
  - `SHOPIFY_APP_REVIEW_URL` is configured.
  - entitlement state is `ACTIVE_PAID`.
  - onboarding is complete.
  - `activatedAt` exists.
  - install age is at least 7 days.
  - merchant has not selected "do not show again".
  - any previous `askedAt` is at least 180 days old.
- Review prompt copy must stay neutral. It must not ask for a positive review, must not offer incentives, and must provide a permanent dismissal action.
- The template implements review prompt only in the embedded app home. It does not request reviews in checkout, admin UI extensions, email automation, or onboarding.
- Opening `/app/growth/review-request` rechecks current entitlement through Shopify before redirecting. `GrowthState.lastEntitlementState` is an auxiliary cache only. The open path updates `askedAt` with a conditional `updateMany` that requires `dismissedPermanently = false` and the re-ask cooldown to still be satisfied; it never resets a permanent dismissal.

## Consequences
- Funnel data can be queried for growth diagnostics without persisting raw shop identifiers or customer PII.
- Merchant-facing funnel summary cannot leak another shop's funnel events, even when multiple shops share the same app database.
- Production deployments need `TELEMETRY_PSEUDONYM_KEY` for persistent funnel measurement. This matches existing telemetry pseudonymization instead of introducing a second identity policy.
- Deploy/startup validation owns missing telemetry key failures, while privacy webhook ingress remains available for Shopify-mandated compliance topics.
- Implicit telemetry-key rotation and fingerprint-row loss are blocked because a new key cannot locate old `FunnelEvent.shopHash` rows for `shop/redact`.
- `app/uninstalled` raw growth cleanup still runs when snapshot recording fails, so uninstall webhook processing does not leave shop-bound onboarding or review state behind due to optional funnel telemetry.
- Uninstall analytics survive only as pseudonymous 90-day FunnelEvent rows. `shop/redact` remains a hard-delete boundary.
- Review request behavior is mechanically testable and conservative for Shopify review: value-first, paid-state gated, delayed, neutral, and dismissible.

## Alternatives considered
- Store raw `shopDomain` on `FunnelEvent`: rejected because funnel analytics do not need a raw shop identifier, and `TELEMETRY_PSEUDONYM_KEY` already defines the repo policy for shop-identifiable telemetry.
- Keep anonymized FunnelEvent rows after `shop/redact`: rejected for v1 because hard deletion is simpler to reason about and satisfies the P-009 acceptance directly.
- Introduce a telemetry keyring for old/new `shopHash` lookup: rejected because it adds template complexity, secret distribution burden, and migration policy surface that P-009 does not need. The root-cause fix is to forbid implicit rotation and fail fast with a migration instruction.
- Show review prompt immediately after onboarding: rejected because the ticket requires value realization first and prohibits onboarding-time review requests.
- Default to a generated App Store review URL from `SHOPIFY_APP_HANDLE`: rejected because the exact review URL is submission/app specific. `SHOPIFY_APP_REVIEW_URL` keeps the template from guessing.

## References
- `tickets/platform/P-009-growth-kit.md`
- `docs/app-store-listing-assets.md`
- `docs/shopify-review-promotions.md`
- `domain/telemetry/emf.mjs`
- `domain/retention/policy.mjs`
- Shopify privacy law compliance webhooks: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- ADR-0003, ADR-0004, ADR-0018, ADR-0019, ADR-0022

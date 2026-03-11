# AGENTS.md

Start here. Read this file first, then follow the pointers below.

## Mission
Build the Shopify public embedded app incrementally. Do not start broad implementation immediately.

## Required order
1. Read `CODEX_START_PROMPT.md`.
2. Read `docs/requirements.md` and `docs/technical_spec.md`.
3. Read `.agent/PLANS.md`.
4. Complete harness tickets first: `tickets/H-001.md` to `tickets/H-004.md`.
5. Only after harness tickets pass, move to platform/product tickets in order.

## Source of truth
- Product/business truth: `docs/requirements.md`
- Technical/platform truth: `docs/technical_spec.md`
- Active delivery sequence: `tickets/README.md`
- Architectural decisions: `docs/adr/` + code + tests

## Hard rules
- Use GraphQL Admin API only.
- Managed install only.
- Managed App Pricing only.
- Embedded app only.
- Polaris components only for merchant-facing UI.
- Session token + token exchange only.
- HTTPS app-specific webhooks only.
- Do not enable embedded direct API access.
- Do not add scopes beyond `read_products,write_products`.
- Do not change billing mapping, webhook retention, redact policy, or app config without a new plan.
- When a ticket involves an architectural decision, create an ADR in `docs/adr/` using `ADR-000-template.md`.

## Quality gates
Run these before declaring a ticket complete:
- `pnpm check`
- `pnpm test:unit`
- `pnpm test:int`
- `pnpm lint:arch`

If a ticket changes routing, billing, install/auth, webhooks, retention, or imports, update tests in the same change.

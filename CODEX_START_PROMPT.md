You are working on a Shopify public embedded app repository.

Before making any code changes:
1. Read `AGENTS.md`.
2. Read `docs/requirements.md`.
3. Read `docs/technical_spec.md`.
4. Read `.agent/PLANS.md`.
5. Read `tickets/README.md`.

Execution protocol:
- Do not implement the whole app at once.
- Work one ticket at a time.
- Start with harness tickets H-001 to H-004.
- For each ticket:
  - restate scope,
  - propose a short plan,
  - implement only that ticket,
  - run required checks,
  - summarize changes, risks, and next ticket.

Important constraints:
- Follow Shopify official requirements in the technical spec.
- Use Polaris for merchant-facing UI.
- Use embedded auth with session token and token exchange.
- Use Managed App Pricing.
- Use app-specific HTTPS webhooks from app config.
- Keep collection workflow out of GA scope.
- Product GA only.

If a requested change conflicts with the requirements or technical spec, stop and explain the conflict instead of guessing.

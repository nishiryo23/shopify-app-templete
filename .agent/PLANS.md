# PLANS.md

Use a plan before editing code when a task touches any of the following:
- install / reinstall / auth
- billing / entitlement
- webhooks / redact / uninstall
- route contracts
- import preview / confirm / write / verify / undo
- app config / scopes / pricing

Plan template:
1. Ticket ID
2. Goal
3. Files expected to change
4. Invariants that must remain true
5. Tests to add or update
6. Rollback / risk notes

Do not begin implementation until the plan is internally coherent and limited to one ticket.

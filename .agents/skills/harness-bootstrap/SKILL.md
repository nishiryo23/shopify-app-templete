---
name: harness-bootstrap
description: Use when the repo-level Codex harness, AGENTS flow, plans, ADR bootstrap, or ticket ordering needs to be created or repaired.
---

# Harness bootstrap

## Use this skill when
- `AGENTS.md` must be created or fixed
- `.agent/PLANS.md` or `.agents/skills/*` needs setup
- ticket sequencing must be clarified
- Codex should be forced to do harness work first

## Do
- keep root `AGENTS.md` short
- route detailed workflow into skills and tickets
- make `1 session = 1 ticket` explicit
- add ADR rules in the right place
- prefer repo-local truth over prose

## Do not
- put long implementation details in `AGENTS.md`
- let Codex jump directly into feature tickets before harness tickets

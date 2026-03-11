---
name: shopify-lifecycle
description: Use when a task touches install, reinstall, embedded auth, session tokens, token exchange, App Bridge, or invalid session handling.
---
Read `docs/technical_spec.md` sections for install/auth first.
Required invariants:
- managed install only
- embedded app only
- session token for frontend->backend
- token exchange for online/offline tokens
- invalid XHR -> 401 + retry header
- invalid document -> bounce

---
name: shopify-lifecycle
description: Use when changing install, reinstall, embedded auth, session token handling, token exchange, scope truth, or lifecycle state.
---

# Shopify lifecycle

## Truths
- managed install is primary
- session token authenticates frontend -> backend
- token exchange provides online/offline tokens
- reinstall is fresh bootstrap
- scope truth comes from `currentAppInstallation.accessScopes`

## Guardrails
- do not introduce manual shop input
- do not rely on cookie-only auth
- do not enable direct Admin API access

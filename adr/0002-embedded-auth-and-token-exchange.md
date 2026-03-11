# ADR-0002 Embedded auth and token exchange

- Status: Accepted

## Context
public embedded Shopify app は session token + token exchange を前提にする。

## Decision
- managed install
- App Bridge + session token
- request-scope online token
- background-only offline token
- direct API access は使わない

## Consequences
auth boundary が明確になり、review-safe になる。

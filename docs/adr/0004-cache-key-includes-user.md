# ADR 0004 · Cache key includes the user, and no cache without one

**Status**: accepted · **Date**: 2026-11-20

## Context

The app queries Teamwork Graph with `asUser()`: the graph returns what *this* user can see. Two people looking at the same `KAN-3` may legitimately see different pages, different contributors, different goals. A process-level cache keyed on the issue alone therefore does not return stale data — it returns **another user's data**.

## Decision

- `createCache` refuses to build a key without a `userId`; the port then simply does not cache.
- The key is `[userId, source, issueKey, lens, asOf]`. Lens is included because weights and thresholds are per-lens, and the payload is already scored.
- Errors (`ok === false`) and `grade === 'unknown'` are never cached: one timeout must not poison the next 60 seconds.
- TTL is 60s, size-capped at 200 entries, LRU on write.
- `userId` is injected once, in the resolver, from `context.accountId` — not read from client payloads, so a caller cannot forge it.

## Consequences

- Cold cache on every new Forge function instance. That is acceptable: the purpose is "pressing Recompute twice does not hit the graph twice", not offline caching.
- Cache effectiveness is measurable in tests: hit/miss counters are exposed.

## Rejected

- **Cache without userId.** Fast, and a data leak.
- **Cache errors for a short TTL.** "Fast wrong" is worse than "slow right".

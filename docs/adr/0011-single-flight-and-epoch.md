# ADR 0011 · Two concurrent readers, one query — and no resurrection after a write

**Status**: accepted · **Date**: 2026-11-20

## Context

The panel and the Rovo agent can open the same issue within the same second. Each Forge function
instance keeps its own cache, and the cache only helps **after** a result returns; between "cache
miss" and "result cached" there is a window where both callers hit Teamwork Graph. A single bundle
has an 8-second timeout and a scan has 20 seconds, so duplicate requests are not a bandwidth
problem — they push both callers toward the timeout line.

Separately, a worse ordering bug exists around writes. Where an installation has enabled the
optional write scope, a stamp invalidates that user's entries for the issue. But a read that
departed **before** the stamp can return **after** it, carrying the pre-stamp world, and write it
back into the cache:

```
T0  panel starts reading KAN-3 (cache miss → graph)
T1  user stamps a review → comment posted → cache invalidated
T2  the T0 read returns, still "nobody confirmed"
T3  it writes that result into the cache — the score bounces back for 60 seconds
```

The user's experience at T3 is "I recorded the review and the number didn't move." That is worse
than having no button.

## Decision

Two rules in `src/io/cache.js`, applied identically in all three ports (`evidence.twg.getBundle`,
`evidence.twg.listBundles`, `evidence.rest.getBundle`):

1. **Single-flight.** `cache.single(key, loader)` shares one in-flight promise per key. The first
   caller executes; the rest await it. A rejected loader is removed immediately, so failures do not
   stick.
2. **Epoch refusal.** A read captures `token = cache.epoch()` on departure. `dropWhere()` always
   increments the epoch. `set(key, value, token)` refuses to write when `token !== epoch`. `dropWhere`
   also removes matching in-flight entries so the next call does not join a promise that is already
   doomed.

Each port follows the same shape — cache lookup, capture token, `build()`, `set(ck, value, token)`,
`cache.single(ck, build)` — so there is no second caching path to audit.

## Consequences

- Two surfaces opening the same item now produce one graph call, not two.
- A stamp cannot be undone by a slower request. The number stays at `debtAfter`.
- Any invalidation invalidates **all** in-flight reads, not just the affected key. That is the
  intended semantics: "from this moment, reads that departed earlier do not count."
- `test/cache.test.js` pins both rules: five concurrent reads execute the loader once; a failure
  retries; a stale token is refused; a current token still writes.

## Rejected

- **Rely on the cache alone.** It cannot see the window before the first result is stored, which is
  exactly the window two surfaces collide in.
- **A lock.** Locks serialise work that is already independent (different issues, different users).
  Single-flight is per key and disappears as soon as the promise settles.
- **Cache the write result instead of invalidating.** The write path deliberately re-reads to prove
  the comment is visible (`E_WRITE_UNVERIFIED` otherwise); caching that proof would defeat its purpose.
- **A distributed cache shared across instances.** Forge does not provide one for this app, and
  claiming otherwise in the README would be the kind of statement this project avoids. Duplicate
  requests across instances remain possible and are documented in the risk table.

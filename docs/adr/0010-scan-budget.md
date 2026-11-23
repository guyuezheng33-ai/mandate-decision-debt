# ADR 0010 · A scan budget that is printed, not hidden

**Status**: accepted · **Date**: 2026-11-20

## Context

Project scans claim "one query, not fifty". That is true for Teamwork Graph, which can return a page of issues in one call. It was **not** true for the REST fallback: every item needed `GET /issue/{key}` plus `GET /issue/{key}/remotelink`. At `limit: 25` the fallback quietly issued 51 requests at concurrency 4 — the exact N+1 pattern the README criticises, hidden behind a number that looked modest.

On a trial tenant without Graph Preview — the most likely reviewer setup — that is also the path that runs. Rate limiting turns it into "everything is unknown", which reads as "the product does not work".

## Decision

The REST fallback has a hard budget of **8 items per load** (`REST_SCAN_CAP`), enforced at three points:

- the JQL search is asked for at most 8 (`maxResults`), not 25-then-slice;
- the map over ids is bounded by the same constant;
- the result array carries `scan: { source, requested, fetched, cap, capped, requestsPerItem }`.

That metadata travels through `aggregate()` → `compactProject()` → the panel, so the project page prints `8 of 25 scanned · REST caps at 8 per load` next to the coverage line. The number the user sees is the number we actually looked at.

TWG keeps `MAX_SCAN = 50`, because one graph call genuinely covers 50 items.

## Consequences

- Worst case on a REST-only tenant: 1 search + 8 × 2 requests = 17, bounded and predictable, instead of 51 and unpredictable.
- A project page on that tenant ranks the most recently updated 8 items. That is a real limitation, and it is on screen rather than in a footnote.
- The chain propagates the budget through degradation (`scan.degraded = true`), so "8 of 25" and "degraded twg→rest" appear together — one sentence, not two competing disclaimers.
- `ports.test.js` asserts the cap at the JQL layer (20 ids in, `limit === 8` out) so a future refactor cannot silently restore the N+1.

## Rejected

- **Keep 25 and accept the latency.** 51 requests at 4s timeout with 4-way concurrency is a 52-second worst case; a reviewer will close the tab before it finishes.
- **Silently cap without disclosure.** A project score computed on 8 of 25 items, presented as the project's score, is the same class of dishonesty the three-valued evidence model exists to prevent.
- **Batch endpoint.** Jira has no bulk remote-links API; pretending one exists would be a plan, not an implementation.

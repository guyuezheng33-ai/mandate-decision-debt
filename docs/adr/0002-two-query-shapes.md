# ADR 0002 · Exactly two query shapes

**Status**: accepted · **Date**: 2026-11-20

## Context

The obvious implementation is "for each issue, fetch its provenance". For a 25-item project scan that is 25 round trips; Teamwork Graph is documented to abandon around 20 seconds, and the Rovo surface gives up around 1MB. A scan that fans out per item will time out exactly when the project is interesting.

## Decision

Only two shapes exist, and no others may be added:

- `provenance.bundle` — one issue, all edges, one round trip.
- `provenance.scan` — one project, up to 50 issues, all edges for all issues, one round trip.

The scan result is scored in memory. `listBundles` is capped at 50 (`MAX_SCAN`), deduplicated by issue key, and asserted by a test that counts query calls (`test/hardening.test.js`: "扫描只有一次往返").

## Consequences

- A scan is O(1) in round trips regardless of item count.
- Very large projects are truncated, not paginated. Truncation is visible because coverage is printed.
- The REST fallback cannot do this (Jira REST has no batch provenance), so it uses bounded concurrency (4) with per-item timeouts instead — also asserted.

## Rejected

- **Per-item fan-out.** Turns a 25-item project into 25 failures waiting to happen.
- **Background job that scans the whole site.** No permission story for it, no way for a reviewer to verify it in one session.

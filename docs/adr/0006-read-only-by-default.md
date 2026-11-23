# ADR 0006 · Read-only by default; the single write is idempotent and gated

**Status**: accepted · **Date**: 2026-11-20

## Context

The product's credibility depends on not being "yet another bot that edits Jira". At the same time, a finding that cannot leave a trace is a finding that dies in a screenshot. Both instincts are right; the resolution is ordering, not compromise.

## Decision

- v1 ships with **no write scope**. `write:jira-work` is present in the manifest only as a comment, and `marketplace/check.js` fails the build if a `write:*` scope appears.
- The one write — a confirmation trace stamped back onto the mandate page — is acceptance item 13, gated behind the first twelve, and implemented as:
  - single item only, never bulk;
  - content-addressed fingerprint (`dd-<8hex>`) posted as a comment, so re-running is a no-op rather than a duplicate;
  - refused with `E_WRITE_DENIED` when the installation lacks the scope, and the UI hides the button rather than failing on click.
- Teamwork Graph is read-only by nature; there is no path where a graph call mutates anything.

## Consequences

- Reviewers can install the app without granting any write permission, which removes the most common Marketplace-review objection.
- The demo must show the trace feature as a described next step, not as a working button. That is a deliberate presentation cost.

## Rejected

- **Ship write on day one.** Changes the review surface from "read-only analysis" to "app that modifies customer pages", for one feature.
- **Store the trace in app storage instead.** It would be invisible to the people who need it, and it contradicts ADR 0004's no-persistence posture.

# ADR 0007 · One port, degraded rather than dead

**Status**: accepted · **Date**: 2026-11-20

## Context

Two failure modes were live at once:

1. `buildPort` picked Teamwork Graph *or* Jira REST at startup, based on whether the install had any `read:graph:*` scope. On a tenant that has the graph client but not the page scope, every panel became a red box.
2. The same rule meant a transient graph error had the same outcome as a permanent permission gap.

For a four-minute demo on a reviewer's own site, "the app is red because your trial org doesn't have Graph Preview" is the single most likely way to lose.

## Decision

The evidence source is a **chain**, not a switch: `TWG → REST`. Three rules, each with its own test:

- When the primary answers usably, the fallback is never called — one tenant, one source of truth, no evidence mixing.
- Degrade only on *total* unavailability (threw, or returned zero known edges). A partial `unknown` is a legitimate three-valued result and stays right where it is.
- On degradation, every edge the fallback cannot prove is forced to `unknown` — even if the fallback claims otherwise — and the bundle carries `degraded: { from, to, reason }`. The panel prints it: `Coverage 2/3 · source rest · degraded twg→rest (E_SCOPE)`.

`goals` and `reviewTraces` are graph-only, so a REST-sourced score can never fire P4 or P6. That is not a bug being hidden; it is the number of criteria that can honestly be judged on that tenant, printed next to the score.

## Consequences

- Same engine, same weights, but the panel on a graph-less tenant reports 1/3 coverage and suppresses three criteria instead of inventing findings.
- Project scans inherit the same rule, capped at 50 items.
- The demo can be recorded on a free Jira site without Graph Preview and still show a working product — with the degradation visible.

## Rejected

- **Red box on missing scope.** Honest, and useless.
- **Merge sources per edge.** Two sources inside one bundle makes the number unexplainable, and unexplainable numbers are the thing this product exists to avoid.

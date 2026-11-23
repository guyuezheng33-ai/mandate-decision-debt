# ADR 0001 · Three-valued evidence

**Status**: accepted · **Date**: 2026-11-20

## Context

A Teamwork Graph query that returns nothing has at least four causes: there really is no mandate; the installation was never granted the object-level scope; the call hit the 20s budget; the page exists but cannot be parsed. A scoring product that collapses all four into "no mandate" will produce a wall of false red on someone else's site. One false red costs the trust that the whole product is asking for.

## Decision

Every edge (`decisions`, `goals`, `reviewTraces`) carries one of three states: `present`, `absent`, `unknown`.

- Only `absent` may trigger a finding.
- `unknown` always suppresses the finding and records *which* edge and *which* scope are missing.
- A bundle with zero known edges produces **no score at all**, and the UI says "Not known / no score" instead of "0 = clean".
- Project scans always print coverage (`known/total`) next to the number.

## Consequences

- The panel can look "empty" in under-authorized tenants. That is honest, and the reason is always stated.
- Every rule must be written so it can be suppressed by one edge; the rule layer cannot assume presence.
- `normalizeEdge` additionally downgrades a `present` edge with zero items to `unknown`, because a data source contradicting itself is not evidence.

## Rejected

- **Treat empty as absent.** Cheap, and wrong on exactly the tenants judges will test.
- **Show "0" with a footnote.** A number is read before a footnote; the score would be misread.

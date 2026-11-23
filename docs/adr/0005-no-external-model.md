# ADR 0005 · No external model in the scoring path

**Status**: accepted · **Date**: 2026-11-20

## Context

LLM-based judgement would make "conflicting mandates" and "goal drift" look smarter, and would require sending customer content to a third party. The app's claim on the Marketplace is that it is read-only and sends nothing outside Atlassian. A single outbound call would falsify that claim — and `marketplace/check.js` verifies it mechanically across 16 source files.

## Decision

- Scoring is deterministic and local: 6 criteria over three-valued edges, integer weights, no similarity model beyond token-Jaccard for clustering page titles.
- The only "language" work — resolving a page title, phrasing a sentence — is templated per lens and per locale.
- `manifest.yml` requests no external fetch; the privacy policy states no outbound calls; a test-adjacent script (`marketplace/check.js`) scans the source tree for `fetch`/`axios`/`http` requires on every run.

## Consequences

- The "conflicting mandates" check is lexical, not semantic: two pages on the same topic with different owners and high title overlap. It will miss rephrased conflicts; that is declared, not hidden.
- Reviewers can reproduce every number offline with `node cli.js`.

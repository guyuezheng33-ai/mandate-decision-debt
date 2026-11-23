# ADR 0003 · The agent selects actions, it never computes

**Status**: accepted · **Date**: 2026-11-20

## Context

A Rovo agent could be given the scoring rules in its prompt and asked to reason about each finding. That reads as "smarter", and it makes the product unauditable: two runs over the same issue can disagree, and nothing in the UI explains why one said 28 and the other said 31.

## Decision

All scoring happens in the resolver, in pure functions with no I/O. The agent's prompt (`src/agent/prompt.md`) contains three actions and six hard rules; rule 1 is *never judge recency, never compute a score, never infer where the evidence is*. The agent picks an action, restates the result, and gives one next step.

The same four actions back the panel (via `@forge/resolver`), the Rovo agent, and the MCP tools — one contract, three surfaces.

## Consequences

- The agent cannot hallucinate a number; the worst it can do is mis-select an action.
- The prompt must forbid "probably / might" phrasing, because a plausible sentence is more damaging than "not available".
- Determinism becomes testable: a golden snapshot (`test/golden.json`) pins 5 fixtures × 3 lenses.

## Rejected

- **Rules in the prompt.** Irreproducible, unexplainable, and impossible to regression-test.

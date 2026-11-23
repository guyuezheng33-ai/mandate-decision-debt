# ADR 0016 · Missing fields are `unknown`, never `clear`

**Status**: accepted · **Date**: 2026-11-20

## Context

The engine already models an edge as `present / absent / unknown`, and every rule declares which
edges it needs. But a rule can also need a **field inside a present edge**, and that was unguarded:

| rule | field it silently assumed | default when absent | conclusion it produced |
|---|---|---|---|
| P2 | `decisions[].updated` | `null` → `test` returns `false` | "change not propagated: no" |
| P3 | `decisions[].owner` | `null` → `ownerSet` size 0 | "no conflicting mandates" |
| P4 | `goals[].status` | `'unknown'` → `isEnded` false | "no goal drift" |
| P5 | issue `reopenedCount` | `0`, hard-coded by the REST shaper | "never re-opened" |
| P6 | `decisions[].contributors`, `reviewTraces[].pageId/actorId` | `[]`/`''` → count 0 | "single author, no review" |

Every one of these is a **false clear** — and a false clear is worse than a false hit, because it
reads as "we checked and it's fine". On the REST port this was live: linked pages never carry an
`updated` timestamp, so P2 would report `clear` for every degraded item. On the graph port it was
latent: the mapper dropped `updated`/`owner`/`contributors` even when the registered Cypher
returned them.

## Decision

Rules may declare `gaps(bundle)`: fields the rule needs that the evidence did not supply. `evaluate`
runs it after the edge check and before `test`:

- any gap → criterion `unknown`, `skipped.reason = "insufficient:<names>"`;
- the criterion carries `why`, so the panel can say **which field** was missing, not just "unknown";
- `normalizeDecision` records `contributorsKnown` and `normalizeBundle` records `reopenedKnown`, because
  "a list that is empty" and "a list that never arrived" are different facts;
- the graph mapper now passes through `updated`, `owner`, `contributors`, `pageId`, `actorId` when
  the query returns them, and leaves them null when it does not.

## Consequences

- On a REST-only install, P2/P3/P4/P6 are `unknown` rather than `clear`. The degradation story
  ("REST can prove the link, not the timestamp") is now literally true in the numbers, not only in
  the prose.
- A project scan over graph rows that do not project `updated` reports partial rows, which the UI
  marks `†` and, below half the weight, refuses to label `healthy/watch/at-risk`.
- Existing goldens do not move: all five fixtures carry complete fields, which is the point of
  fixtures.

## Rejected

- **Threshold heuristics** ("assume `updated` = issue `updated`"). It would turn an issue edit into
  evidence of a page edit — a fabricated timestamp in the exact place the product claims precision.
- **Treat gaps as `absent`.** That is the failure this ADR exists to prevent.
- **Refuse to score the whole item on any gap.** Then a single missing field would blank a page that
  is otherwise fully evidenced; `unknown` per criterion keeps the rest of the score informative.

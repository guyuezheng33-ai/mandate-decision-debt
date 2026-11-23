# ADR 0012 · The score must be divisible

**Status**: accepted · **Date**: 2026-11-20

## Context

The panel shows `28`. It also shows two findings: P2 (20) and P6 (8). The obvious next question is
"why not 40 — what happened to the other four criteria?"

Before this change there was no answer on screen. The payload carried `flags` (what hit) and
`suppressed` (what was unknown), but nothing said "P1 was evaluated and found clear". A user could
not distinguish three very different states:

- this criterion was checked and does not apply (`clear`),
- this criterion could not be checked because an edge is missing (`unknown`),
- this criterion hit (`hit`).

Collapsing `clear` into silence is survivable. Collapsing `unknown` into silence is the exact sin
the product is built to avoid, and a score with no breakdown lets both sins happen invisibly.

## Decision

`evaluate()` returns a fourth value, `criteria`, one row per primitive:

| field | meaning |
|---|---|
| `p` | primitive id (P1–P6) |
| `w` | weight in the active lens |
| `state` | `hit` / `clear` / `unknown` |
| `label` | criterion name in the requested language |
| `why` | only for `unknown`: which edge is missing |

The panel renders these six rows inside a `<details>` block, collapsed by default, headed
"How this number is made". `hit` rows show `+w` in the alert colour; the rest show `0` and are
dimmed. The CLI prints the same information on one line.

The invariant is asserted, not documented: `hit` weights must sum to `debt`, `unknown` must match
the suppressed list exactly, and `hit` must match `flags` exactly.

## Consequences

- A reviewer can verify `28 = 20 + 8` without leaving the panel.
- "Why is this 0 and not flagged?" now has two distinct answers on screen (`clear` vs `unknown`).
- Every issue payload grows by roughly 300 bytes; the fixture maximum is 2KB against a 200KB budget.
- The bench cost rose from ~35ms to ~40ms for 1500 scores. Accepted: an auditable score is worth 5ms.
- The agent prompt must never invent a breakdown: `criteria` is the only authorised source for
  "why this number".

## Rejected

- **Only show the top finding.** It makes the number unexplainable, which is fine for a dashboard and
  fatal for a metric someone is expected to defend in a review.
- **Show the table expanded by default.** It competes with the one action the panel exists to deliver.
  Collapsed keeps the reading order: heaviest finding → next step → proof.
- **Show only the suppressed criteria.** That explains the gap but not the zeros; users still cannot
  tell "checked, fine" from "never checked".

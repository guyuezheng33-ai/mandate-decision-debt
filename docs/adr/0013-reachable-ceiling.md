# ADR 0013 · The ceiling is 71, and the label says 0–100

**Status**: accepted · **Date**: 2026-11-20

## Context

Decision Debt is described as a 0–100 index. Six weights in the software lens sum to 96, so the naive
reading is "96 is the maximum, we just never quite reach 100."

That reading is wrong, and wrong in a way a reviewer can disprove in thirty seconds.

P1 fires only when **both** the decision edge and the goal edge are absent — nothing records why the
work exists. P2, P3, P5 and P6 all require the decision edge to be **present**. P4 requires the goal
edge to be present. So the moment P1 fires, every other primitive is structurally unable to fire.
Conversely, if the decision edge is present, P1 is impossible.

The reachable maximum in the software lens is therefore `max(P1, P2+P3+P4+P5+P6) = max(25, 71) = 71`,
not 96 and certainly not 100. Launch reaches 72, portfolio 73.

## Decision

Keep the score as the weighted sum (no renormalisation), and make the ceiling a first-class, tested
property:

- `ceiling(profile)` computes `max(w.P1, Σ w.P2..P6)` and is exported from `score.js`.
- `test/property.test.js` generates 200 deterministic random bundles per lens and asserts that no
  score ever exceeds that ceiling.
- The UI continues to print the number, not the ceiling. The README states the index is bounded and
  that its top is structural.

Renormalising to 100 was rejected because every threshold (`healthy ≤ 15`, `watch ≤ 35`,
`at_risk ≤ 60`) and every golden fixture is calibrated on the raw sum; rescaling would silently move
KAN-3 from 28 to 39 and invalidate the lens comparison.

## Consequences

- "0–100" is an upper bound, not a target. The number that appears on screen is never a percentage
  of some imagined total; it is a sum of named weights, and the breakdown shows each term.
- A reviewer who asks "can this ever be 100?" gets a precise answer with a witness: P1 excludes five
  other rules, so the top of the scale is 71 in software delivery.
- The ceiling is per lens, which is correct: portfolio weights put 26 on P4, so its ceiling differs.
- Any future weight edit automatically re-derives the ceiling; the property test fails if someone
  adds a weight that makes the invariant false.

## Rejected

- **Scale to 100.** Changes every threshold and every golden fixture for cosmetic neatness.
- **Print the ceiling in the panel.** It is a curiosity, not a decision input. The one number that
  matters is the user's own score and its six rows.
- **Drop P1 to keep the six weights summing to something tidy.** P1 is the absence of any mandate —
  the clearest failure state the product has. Renumbering the metric around arithmetic tidiness
  would be backwards.

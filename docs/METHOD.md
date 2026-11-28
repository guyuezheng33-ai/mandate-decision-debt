# METHOD — Mandate's authority audit, as a citable method

> **Cite as:** Mandate Decision Debt Audit, method note v1, 2026-11-28.
> Repository: `github.com/guyuezheng33-ai/mandate-decision-debt` · this file: `docs/METHOD.md`.
> Companion: `docs/PRODUCT-DEFINITION.md` (canonical product definition; if the two conflict,
> PRODUCT-DEFINITION wins and this file is wrong). Assertion counts are never hand-copied
> here — the live number is in `docs/verification.md`.

This note exists so a third party can **re-run, disagree with, and falsify** the method
without installing the app or trusting its screenshots.

## 1. Formal model

For a work item `w` at audit time `t` (`asOf`), an authorisation record is

```text
A(w) = (d, o, t_approved, t_edited)
d          the record that authorises w (a Jira issue with MANDATE/approved/owner,
           or a linked Confluence page)
o          the owner named on d
t_approved the approval date written in d (a claim inside the record)
t_edited   the server-side last-edit time of d (a fact about the record)
```

The two dates are deliberately separate. `t_approved` can be old while `t_edited` is
recent; treating them as one number is exactly the bug class this method guards against.
The engine uses `maxDecided(d) = t_edited ?? t_approved` for propagation checks, and keeps
`t_approved` for the receipt's age line.

Six conditions, each three-valued (`present` / `absent` / `unknown`):

| # | Condition | Criterion (engine label) | Weight (software lens) |
|---|---|---|---|
| C1 | a readable authorisation record exists | P1 · No mandate | 25 |
| C2 | the record was edited after work started and never re-confirmed | P2 · Change not propagated (hero) | 20 |
| C3 | no conflicting authorisation record points at this item | P3 · Conflicting mandates | 15 |
| C4 | the item's goal still matches the record's goal | P4 · Goal drift | 18 |
| C5 | the decision was not re-opened / re-litigated without closure | P5 · Re-litigation | 10 |
| C6 | the record is not single-author with no review | P6 · Single author, no review | 8 |

```text
state(c) ∈ {present, absent, unknown}
debt(w) = Σ weight(c) · [state(c) = absent]          (integer, higher = worse)
grade   = band(debt)                                 (healthy / watch / at_risk)
```

Rules that make the number defensible:

1. **Only `absent` scores.** `unknown` suppresses the condition and is named in the
   coverage line (`known/total`). An item with no known condition gets `NO SCORE`, not `0`.
2. **Structural ceiling.** With the software weights the reachable maximum is 71, not 100;
   the ceiling is printed beside the score. A score above the ceiling is a bug, and a
   property test asserts it can never happen.
3. **Ordinal index, not probability.** `28` means "watch, with these named missing
   conditions", never "28% chance of failure". Bands are the decision unit.
   Publication rule: when `grade = unknown` (NO SCORE), every surface publishes
   `debt = null`, never `0` — a zero would be misread as "healthy".
4. **One engine, four surfaces.** Panel, Rovo agent, MCP tools and the REST audit call the
   same actions; the agent restates rows and is forbidden by prompt from computing a score.
5. **Propagation is a diff, not a threshold on age.** P2 fires when
   `maxDecided(d) > workStart`, no confirmation exists at or after `maxDecided(d)`, and
   `asOf − maxDecided(d) ≥ driftDays` (14 in software/launch, 30 in portfolio).
   A record edited *before* work started is not drift, however old it is.

## 2. Falsifiable conditions

Each condition below is a claim the method makes about itself, with the command that can
refute it **today**. If any command fails, the corresponding claim is withdrawn, not patched
with prose.

| # | Claim | Refuting observation | Command (this repo) |
|---|---|---|---|
| F1 | score can never exceed its structural ceiling | any bundle scoring above the lens ceiling | `npm test` (property suite) |
| F2 | a missing field can never become "no finding" | P2 `clear` when the record has no readable date | `node --test test/p2-live-evidence.test.js` |
| F3 | the four surfaces agree on one bundle | any debt / grade / criteria mismatch across surfaces | `npm run verify`; `npm run matrix` (fixture) and `ISSUE=MOBL-57 MODE=live npm run matrix` (live, needs `JIRA_TOKEN`) → `docs/surface-matrix.md` / `docs/surface-matrix-live.md` |
| F4 | the live audit is reproducible | MOBL 30-item run not reproducing 28 missing / 1 stale / 1 unscorable, or P2 fully `unknown` | `LIMIT=30 OUT=runs/real-audit-mobl-30.json P2_ASSERT=judged node scripts/real-audit.js` (needs `JIRA_TOKEN`) |
| F5 | scoring stays inside the latency budget | P50 above 300 ms | `npm run bench` |
| F6 | weights are defensible under ±20% perturbation | top-5 ranking flips under perturbation | **not yet automated — claim withheld.** `npm run eval` currently reports date-robustness (P2 flip rate) and a holdout split, not weight sensitivity. Until a weight-sensitivity runner exists, no precision claim rests on F6. |

F4 has a known, honest limit: on the seeded demo tenant the approval record's server edit
is recent, so P2 is `clear` there until the edit ages past `driftDays`. `P2_ASSERT=judged`
requires at least one *judged* P2 (not `unknown`); `P2_ASSERT=hit` additionally requires a
real hit and is expected to fail before the record's edit ages past the threshold. A failed
`hit` assertion is reported as a failure, never simulated.

## 3. Applicability boundaries

- **For teams that already keep decision records** (ADR, RFC, launch brief, spec, decision
  log) in Jira or Confluence. With no records, the honest output is `unknown` / `NO SCORE`;
  that is a boundary, not a failure to be hidden.
- **Jira-hosted reads only in the shipped demo.** A cross-product Confluence token could
  not be minted on the live site; page links still count as records but their dates stay
  `unknown` rather than invented.
- **Read-only by construction.** The single write is one idempotent re-confirm comment
  after a human click (`mandate:dd-<8hex>` fingerprint); it is gated behind a scope that
  ships commented out. No field mutation, no auto-approval, no batch write.
- **No model in the scoring path.** Deterministic arithmetic over three-valued evidence.
- **Out of scope:** whether a decision is strategically right; velocity forecasting;
  performance ranking; replacing Jira, Confluence or a compliance system.

## 4. Reproduction kit

Everything needed to re-run the method is public in the repository:

| Artifact | Path | Nature |
|---|---|---|
| Evidence corpus (26 files) | `test/fixtures/inbox/` | **simulated**, explicitly labelled; 152 issues / 121 pages / 10 goals |
| Seed sheet (21 rows) | `docs/data-inbox-verification.md` + `tools/seed-store.js` | engine-vs-seed row agreement, 0 mismatches |
| Live audit run | `runs/real-audit-mobl-30.json` | real seeded demo tenant, REST port, dated |
| Assertion proof | `docs/verification.md` | regenerated by `npm run check` |
| Competitor claims | `docs/COMPETITORS.md` | named, dated, URL-checked |

Commands, in order of strength:

```bash
npm run check        # 12-gate local proof: tests ×2, corpus bytes ×2, bench, docs, submission
npm run matrix       # four-surface equality matrix (fixture); MODE=live for the real tenant
npm run corpus       # regenerate corpus report from the 26 simulated files
npm run probe        # sha256 re-verification of corpus provenance
npm run eval         # date-robustness + holdout report (not weight sensitivity, see F6)
LIMIT=30 node scripts/real-audit.js   # live REST audit; JIRA_TOKEN required
```

The corpus is **simulated shape evidence**, not a customer export and not a calibration
set. It proves the engine refuses to fake findings on malformed inputs; it does not prove
any team's backlog looks like this. The live run proves the gap is observable on one real
(seeded) tenant. Neither is a benchmark, and no percentage impact claim is made from them.

## 5. What would change our mind

- A real team's backlog where P2 hits are common but delivery leads judge them noise →
  `driftDays` or the propagation rule is wrong; narrow the claim or fix the rule.
- A surface disagreeing with the panel on the same bundle → F3 broken; the method's
  "one engine" claim is withdrawn until fixed.
- A weight perturbation that flips the top-5 ranking → weights are policy, not evidence;
  either justify them with a calibration sample (see `docs/calibration.md` when present)
  or stop presenting the ranking as defensible.

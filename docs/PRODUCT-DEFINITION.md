# Product definition — Mandate

> Canonical definition for judges and for the engine. If a sentence here conflicts with
> marketing copy, this file wins.

## 1. One sentence

**Mandate is an authority audit for Jira work items: it checks whether the decision that
authorised a work item still holds at time *t*, scores the unmet authorisation conditions
0–100 as Decision Debt from three-valued evidence, and returns one owner-level action.**

It is not a status report, not a compliance attestation tool, and not an AI summariser.

## 2. Formal model

For a work item `w`, an authorisation edge is:

```text
A(w) = (d, o, t_d)
d  = the decision page that authorises w
o  = the owner named on d
t_d = when d was decided / last confirmed
```

`A(w)` is **valid at time t** only if all six conditions hold:

| Condition | Check | Criterion |
|---|---|---|
| C1 existence | `d` exists and is readable | P1 |
| C2 authority | `o` has authority for this scope; a second reviewer exists for high-impact work | P6 |
| C3 coverage | `d`'s scope covers `w` (not a sibling item) | P1 / P3 |
| C4 propagation | if `d` was materially edited after `w` started, a confirmation exists after that edit | P2 (hero) |
| C5 consistency | no later decision supersedes, contradicts, or reopens `d` without closure | P3 / P5 |
| C6 alignment | `d`'s goal still matches `w`'s current goal | P4 |

Each condition returns one of three states:

```text
present  = evidence says the condition holds
absent   = evidence says it does not hold
unknown  = the edge cannot be read (scope, timeout, parse, or missing object)
```

Only `absent` can trigger a finding. `unknown` suppresses that condition and is named in the
coverage line. If every condition is `unknown`, the item gets `NO SCORE`, not `0`.

Decision Debt is the weighted sum of the `absent` conditions:

```text
debt(w) = Σ weight(c) for c in {C1..C6} where state(c) = absent
```

Weights are fixed policy, not learned parameters. They express blast radius and reversibility,
not probability. A weight change must be justified by a sensitivity run (see §6).

## 3. What the number means

- The 0–100 value is an **ordinal index with fixed bands**, not a calibrated probability.
- `28` means “watch, with these named missing conditions”, not “28% chance of failure”.
- The software lens has a structural ceiling of **71**, not 100. The ceiling is printed; a score
  above it would be a bug.
- A higher score is worse. Bands are the decision unit; the exact integer is a ranking device.

## 4. Category and non-category

| Neighbour | What it optimises | Why Mandate is different |
|---|---|---|
| Jira report / dashboard | throughput, cycle time, status | Mandate audits the authority behind the work, not the work's status |
| Confluence page history | whether a page changed | Mandate checks whether the change reached the work and was re-confirmed |
| Compliance / attestation tool | a new manual sign-off ritual | Mandate derives evidence from pages, goals and review traces teams already produce |
| AI summariser | a plausible paragraph | Mandate is deterministic; it refuses to score what it cannot see |
| Link graph | whether two objects are connected | Mandate checks whether the connection is still valid at `t` |

**Category to own:** authority audit / decision provenance for software delivery.
**Not the category:** another Jira dashboard, another compliance checklist, another chat agent.

## 5. User and value

**Primary user:** a delivery lead running 3–8 workstreams in a Jira + Confluence team that
already writes decision pages (ADR, RFC, launch brief, spec, decision log).

**Value unit — countable, not a percentage:**

1. One review question resolved: “why is this being built, who approved it, and is it still true?”
2. One owner-level action: “ask this named person to re-confirm this page, append still-valid / changed.”
3. One evidence link: the page and the dates, not a memory.

**Value is conditional.** If the team has no decision pages, Mandate returns `unknown` and
`NO SCORE`. That is honest, but it is not a product for every Jira site. The target segment is
teams with a decision-page culture, not “all Atlassian customers”.

**Why now:** as more work is drafted or executed with agents, text is cheap and authority is
scarce. The bottleneck is no longer “write a plan”; it is “prove who authorised this, and
whether that authorisation survived the change”.

## 6. Proof obligations

A claim about precision, competitiveness or value is only valid if one of these exists:

| Claim | Proof |
|---|---|
| Precision | six conditions map to six criteria; weights documented; sensitivity run under ±20% perturbation |
| Refusal to fake | `unknown` never triggers; no known edge → no score; covered by tests |
| Competitiveness | the five-neighbour table above; four surfaces return one JSON shape |
| Value | 1–3 real delivery-lead sessions; seed sheet filled by the user; no fabricated quotes or percentages |
| Reproducibility | `npm run check`, `npm run eval`, `npm run eval:incremental`; 179 assertions |

If the sensitivity run flips the top-5 ranking, the weights are not yet defensible; fix the
weights or narrow the claim. If no real session exists, the value claim stays at “problem
definition”, not “measured impact”.

## 7. Boundaries

- Read-only. The only write is one comment after a human click (`stampMandate`); no field
  mutation, no batch write, no auto-approval.
- No external model in the scoring path. The Rovo agent selects an action and restates it;
  it does not compute a score.
- It does not answer “is this decision strategically right?” It answers “is the authorisation
  traceable and still valid?”.
- It does not replace Jira, Confluence, or a compliance system. It reads what they already hold.

# Mandate — Product Contract

## Identity

Mandate is a Forge app for Jira Cloud that answers one question per work item: **who authorised this, in which document, and when was it last confirmed?** It returns a deterministic Decision Debt score when the evidence is readable, and an explicit `NO SCORE` when it is not.

## Surfaces

| Surface | Entry | What it returns |
|---|---|---|
| Issue panel | `jira:issuePanel` / `mandate-issue-panel` | One authority receipt: decision, age, evidence rows, six criteria, one action |
| Project module | `jira:projectPage` (when the project type exposes it) | Portfolio debt mix and the highest-debt items |
| Agent tool | Forge agent action `audit_issue` | Same receipt as structured JSON |
| MCP endpoint | Forge remote MCP action | Same receipt and audit envelope over MCP |
| REST fallback | Jira REST `/rest/api/3` | Degraded read; every missing edge is labelled `unknown`, never `absent` |

## Inputs

- Jira issue fields: key, summary, status, assignee, labels, remote links.
- Remote links whose target is a Confluence page or another Jira issue.
- Confluence page metadata: page id, title, version author, `version.when`.
- A Jira issue used as the authority record when it carries the Mandate marker.

## Output contract

Every receipt carries:

- `decision`: `CURRENT` / `NOT CURRENT` / `NO RECORD` / `UNVERIFIABLE`
- `ageDays`: integer, or `null` when no readable date exists
- `debt`: 0–100 integer, or `null` when the item cannot be scored
- `grade`: `clear` / `watch` / `high` / `critical`
- `criteria`: exactly six rows, each `hit` / `clear` / `unknown`, with integer weights
- `sources`: the exact issue keys, page ids and URLs used
- `coverage`: scanned / total, plus the REST cap when applicable
- `nextAction`: one line, or `null` when the item is clear

## Invariants

1. **No score without evidence.** If any required edge is unreadable, the item is `NO SCORE`, not a guessed number.
2. **Unknown suppresses a finding.** Only `absent` can produce a `NO RECORD` finding; `unknown` never does.
3. **One deterministic engine.** Panel, agent tool, MCP and CLI must return the same debt, grade and six criteria for the same bundle.
4. **Weights are visible.** The weights that hit must sum to the displayed score; the UI exposes the sum.
5. **Age is measured, not inferred.** A missing `version.when` produces `DAYS UNCONFIRMED`, never today's date.
6. **Every scan reports its subset.** A partial scan prints `scanned / total` and the REST cap; a subset score is labelled as a subset score.
7. **No hidden write.** The app reads Jira and Confluence; it does not edit issues, pages or authority records.

## Non-goals

- Not a status report, not a compliance attestation, not an AI summariser.
- Not a replacement for Jira automation or Confluence page ownership.
- Not a benchmark against other vendors; the 30-item MOBL audit is a seeded demonstration tenant, not a customer export.

## Acceptance

The product is accepted only when:

- `npm test` passes all tests.
- `npm run check` reports all checks clean.
- `npm run submission` and `npm run marketplace` report all materials ready.
- The 30-item MOBL audit reproduces 28 missing / 1 stale / 1 unscorable.
- P50 scoring latency is at or below the 300 ms budget on the development laptop.
- `forge.py judge` exits 0 with no regressed axis and no unrun evidence.

## Change control

Any change to scoring weights, thresholds, cohort, the frozen contest rubric, or the judge kernel is out of scope for product work. Those are gate-level decisions, not product edits.

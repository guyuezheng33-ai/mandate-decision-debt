# Impact thesis and pilot — Mandate

This page is judge-facing. It separates three things that are easy to blur in a hackathon
submission: the impact we intend, the measurements that would prove it, and the evidence we
actually have today.

**Status line, read this first:** the impact model and the pilot instrument are real and
runnable. External delivery teams have **not** been run through the human pilot yet, so no
quote or time-saving claim appears in the submission. We *have* run the engine against a live
Atlassian demo tenant: the measured audit below is a live-instance sample with its scope and
limits stated.

---

## 1. The problem, stated as a decision gap

A work item is not authorised by its status. It is authorised by a decision record: a Confluence
page, a goal, a review trace. Delivery breaks when that record changes and the work keeps going:

- the page was edited on **2026-08-14**;
- work started on **2026-06-20**;
- nobody confirmed after the edit;
- the ticket still says `In Review`, and every stand-up re-asks a question the toolchain cannot
  answer.

That is not a stale-document problem. It is an **authority gap** between a decision and the work
that depends on it. Status dashboards aggregate work; they do not audit the authority behind it.

### 1b. Measured on a real site (2026-11-24)

We ran the same REST port the panel uses against a live Atlassian demo tenant
(`one-atlas-ngpq.atlassian.net`, project `MOBL`, 30 most recent issues, company-managed). The project
is a seeded demo, not a customer export; it is a live instance, not a benchmark population.
The exact run is saved at `runs/real-audit-mobl-30.json` and reproducible with
`LIMIT=30 node scripts/real-audit.js`.

| Result | Count (of 30) |
|---|---|
| No approval record at all (`missing`) | 28 |
| Record exists but expired (`stale`) | 1 |
| Current / contested | 0 |
| Not scorable (`unknown`) | 1 |

The only recorded approval (`MOBL-57` → `MDEMO-2`) is **1,703 days old** (approved
2022-03-26, owner Alana Grant) and has never been re-confirmed. The receipt therefore says
`NOT CURRENT`, not because a page is missing, but because the approval itself outlived its
review window.

The one unscorable item (`MOBL-27`) has a linked page record whose last-edited date could not be
read, so it returns `NO SCORE` instead of inventing a date. That is the intended behaviour, not a
failure to hide.

What this sample does **not** prove: it is a seeded demo tenant, one project, 30 issues, and
REST-only, so goals and review traces are `unknown`. It is not a benchmark of all Jira sites.
It is evidence that the authority gap is observable on a live instance, and that the tool reports
`missing`, `stale` and `unscorable` separately instead of collapsing them into a single "risk" number.

## 2. Who this is for

Primary user: **delivery lead / program manager** who owns a release or a multi-team workstream
and has to defend "why is this still allowed to ship" in a review.

Secondary users:

- **PMO / portfolio owner** deciding which work still serves a goal on the books;
- **engineering lead** receiving a "next action" that must be executable, not another report;
- **auditor / compliance partner** who needs the page, the dates and the gap, not a sentiment.

Explicit non-users: teams looking for velocity forecasting, performance ranking or a generic
AI summary of Jira. Mandate does none of those.

## 3. The behaviour we intend to change

| Today | With Mandate | Why it matters |
|---|---|---|
| "It's approved, I think" | Receipt: who, which page, when, still valid | The answer becomes a citation, not a memory |
| Search Confluence for the page and reconcile dates | Open the issue, read four facts | Time to evidence falls; no new process |
| A stale approval is found in a release review | The issue is flagged before review | Rework moves earlier and gets cheaper |
| "We should re-confirm" in a meeting | One named next action + copyable audit note | The fix has an owner and a paper trail |
| A dashboard says "0 findings" because a scope is missing | `UNVERIFIABLE · NO SCORE` | Silence is not reported as safety |

The product's only ask is one comment when a decision is re-confirmed. It introduces no new form,
no new field and no new ritual; the evidence already exists in Jira, Confluence and goals.

## 4. Outcomes and how they would be measured

These are the four outcomes the pilot is designed to test. They are deliberately narrow enough to
falsify.

| Outcome | Instrument | Unit |
|---|---|---|
| **O1 · Faster provenance** | Time from task start to a correct owner + page + date | seconds |
| **O2 · Faster validity judgement** | Time from seeing the receipt to a correct `current / not current` answer | seconds |
| **O3 · Higher confidence** | Self-rated confidence in the answer, 1–5 | points |
| **O4 · Correct escalation** | Did the participant choose the right next action (re-confirm vs close vs investigate)? | 0/1 |

We do **not** measure "reduced rework" or "hours saved" in the pilot. Those require a longitudinal
site study and would be a fabricated number at this stage.

## 5. Pilot design — 5 participants, 10 issues

Full protocol and consent language: [`../08_真人测评协议.md`](../08_真人测评协议.md).
Scorecard template: [`../pilot/scorecard.csv`](../pilot/scorecard.csv).

Design in one paragraph: five participants, each handling **two issues** (10 issue observations
total), one in the **baseline** condition (Jira search + Confluence search as they normally work)
and one in the **Mandate** condition. Conditions are assigned so that no participant sees the same
issue twice, and across the five participants each issue appears in both conditions. The task is
identical in both conditions: name the authorising owner, the decision record, the last change
date, and whether the approval still holds.

Primary analysis is descriptive: median seconds and median confidence per condition, plus correct
answers out of five. With N=5 we do not report p-values or percentages. If the direction is
consistent, the claim is "in a five-person pilot, the median time to a correct provenance answer
was X seconds with Mandate vs Y seconds with the current process" — and only if X and Y are real.

**Stop rule:** if fewer than five participants complete both conditions, the pilot is reported as
incomplete and no comparison is made. Incomplete evidence never becomes a sentence in the video.

## 6. What would make the impact claim stronger after the pilot

1. **A second site.** One team can be a fluke; two teams with different Confluence hygiene is a
   pattern.
2. **A holdout.** Ten issues the product was not tuned on, scored blind by the team's own owner.
3. **A repayment event.** One stale approval re-confirmed, with debt moving down because the
   evidence changed — not because the threshold moved.
4. **A false-positive review.** Every finding a participant judged wrong gets written down; the
   product's precision claim depends on it.

## 7. Adoption path (why this can ship beyond the demo)

- **Forge, read-only by default.** No write scope, no stored content, no external model in the
  scoring path. `write:jira-work` ships disabled; the only write is an opt-in, idempotent trace
  comment.
- **No migration.** It reads the links, pages and goals a team already has. If a scope is missing,
  it degrades and says which criterion was suppressed.
- **Four surfaces, one contract.** Issue panel for the daily user; project page for the owner;
  Rovo agent for a question in chat; MCP for the editor. Same engine, same six rows, same action.
- **Proportional scopes.** Issue and page edges plus user identity; no team roster, no admin
  scope. The permission request is explainable in one sentence.

## 8. The honest boundary

Mandate cannot tell you whether a decision was **good**. It tells you whether the authority behind
the work is **still on record, still current, and still owned**. That is a narrower claim than
"AI understands your project", and it is the claim the product can defend under audit.

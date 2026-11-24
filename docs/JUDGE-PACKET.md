# Judge packet — Mandate

One page for a reviewer with 3 minutes. Everything below is either a number you can reproduce
offline or a file in this repo. Nothing here asks you to trust a screenshot.

**What it is:** an authority audit for Jira work items, not a status dashboard. Every work item
should be able to say *who authorised it, in which document, when — and whether that
authorisation still holds today*. Mandate checks six conditions behind that claim, scores the
unmet ones 0–100 as **Decision Debt** from three-valued evidence (`present` / `absent` /
`unknown`; only `absent` triggers), and returns one owner-level action. Four surfaces — issue
panel, project page, Rovo agent, MCP — share one deterministic engine, with no external model
in the scoring path.

Architecture (read path, write path, offline evaluation): [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
Canonical definition (formal model, category, value, proof obligations): [`docs/PRODUCT-DEFINITION.md`](PRODUCT-DEFINITION.md).

---

## 1. The 60-second path

**A. On a live Jira site (the shipped app).** The production build is installed on a seeded
Atlassian demo tenant. The tenant is not shared with judges; the real screenshots and the 90-second
video are captured from it. To see the same panel on your own site, use the public Try it out page
(`https://telegra.ph/Install-Mandate-on-Jira-11-23`), then open any issue that has a decision
record or an approval record linked to it. The first screen is the receipt:

- `CURRENT` / `NOT CURRENT` / `CONTESTED` / `NO RECORD` / `UNVERIFIABLE`
- `Authorised by`, `Approved on`, `Recorded in`, `Still valid`
- `1703 · days unconfirmed` when stale, because a 0–100 score must never contradict the receipt
- `6 checks` expands to six weighted rows; the hit weights sum to the displayed number
- `Next action` names one owner-level step, with `Copy audit note`

If your site has not granted the Teamwork Graph scopes, the panel says so (`degraded: {from, to,
reason}`), scores only what REST can see, and marks partial results `†`. It never silently
pretends the missing evidence was clean.

**B. Offline, with no tenant.** The fixture harness renders the same current UI against the same
engine output:

```bash
npm ci
npm run harness          # builds preview/ui-harness.js from src/ui/src/app.js
# open preview/ui-harness.html in a browser
```

The harness is clearly labelled `fixture`; it is not a live-tenant capture. In the fixture set,
`KAN-3` is the stale receipt, `KAN-9` is `NO RECORD`, `KAN-11` is `UNVERIFIABLE · NO SCORE`, and
`KAN-20` is the `CURRENT` control. The same payloads are asserted by `npm run verify`.

## 2. Reproduce without a tenant (offline)

```bash
npm ci
npm run verify     # 187 assertions, 0 failing
npm run check      # full gate: manifest · verify ×2 · docs · corpus ×2 · bench · marketplace · probe · submission · eval · incremental · proof
pwsh scripts/check.ps1    # same gate as one command on Windows
make check         # same gate as one command on macOS/Linux
npm run eval       # baseline vs always-flag, 95% bootstrap CI, time holdout, P2 counterfactual
npm run eval:incremental  # watermark replay: 21 scored → 0 new → 1 new → 0 new at 10×
npm run proof      # regenerates docs/verification.md with the run you just did
npm run bench      # scoring path, budget 300 ms (measured 30–43 ms on a laptop)
```

**Evidence index.** The CI workflow is public and green on `master`: [`actions/workflows/ci.yml`](https://github.com/guyuezheng33-ai/mandate-decision-debt/actions/workflows/ci.yml). It runs `npm ci`, `npm test`, `npm run ci` (build + manifest + verify + bench), and `npm run marketplace` on every push. Live-tenant captures, not fixtures: [MOBL-57 receipt](https://github.com/guyuezheng33-ai/mandate-decision-debt/blob/master/preview/real-panel-mobl57-en.png), [MOBL-57 six checks](https://github.com/guyuezheng33-ai/mandate-decision-debt/blob/master/preview/real-panel-mobl57-en-checks.png), [MOBL-56 no record](https://github.com/guyuezheng33-ai/mandate-decision-debt/blob/master/preview/real-panel-mobl56-en.png). The 30-item audit is [`runs/real-audit-mobl-30.json`](../runs/real-audit-mobl-30.json): 28 `missing`, 1 `stale` (`MOBL-57`, 1,703 days), 1 `NO SCORE`; one seeded demo project, REST-only. The project page is live on the company-managed `MOBL` project: [route](https://one-atlas-ngpq.atlassian.net/jira/software/projects/MOBL/apps/ari:cloud:ecosystem::extension/c3df8fe6-3626-4829-9025-47d55b1bde54/696b5366-aa30-42fd-8cd6-1f4b2e7c8383/static/mandate-project-page); its gallery image remains a `Sample data` fixture and is labelled as such. The demo shows `UNVERIFIABLE · NO SCORE` at 1:03, not only the happy path.

`npm run eval` writes `docs/evaluation.md` + `docs/evaluation.json`: F1 `1.00` against an
always-flag baseline of `0.895`, a 95% bootstrap difference interval `[0.024, 0.235]`, a
time-ordered 5-row holdout, and 6/6 P2 cases that disappear when the page update is moved
before execution start. **The labels are generator-same-source**, so this is a pipe-consistency
check, not calibration; the report says that in its first paragraph.

`npm run eval:incremental` writes `docs/incremental-eval.json`: first pass `21/21 processed`,
second pass `0/21 processed` (all reused), one new row `1/22`, and a 10× table second pass
`0/210`. The invariants are asserted, not narrated.

`npm run check` runs every assertion **twice** and compares the two runs byte-for-byte for the
corpus outputs; a flaky pass shows up as a red row, not as a green summary. Exit code 0 means no
engineering failure. `docs/verification.md` is generated by the same binary, so the count in the
docs cannot drift from the count in the tests.

The 26-file evidence corpus (`../data-inbox`, 152 issues / 121 pages / 10 goals) is **simulated
and labelled simulated**. It exists to expose column gaps (missing `updated`, missing
`reopenCount`, dropped `pageInfo.hasNextPage`) and to freeze the shape of the payloads — it is
not a live-tenant capture and is never presented as one.

## 3. What is real, what is not

| Claim | Status |
|---|---|
| Scoring engine, six criteria, three lenses, arithmetic invariants | Real; 187 assertions, property test over 200 random bundles per lens |
| Issue panel, Rovo agent and MCP over one engine | Real Forge modules on the live tenant; same action layer, three reachable surfaces |
| Project page | Live on the company-managed `MOBL` project: [route](https://one-atlas-ngpq.atlassian.net/jira/software/projects/MOBL/apps/ari:cloud:ecosystem::extension/c3df8fe6-3626-4829-9025-47d55b1bde54/696b5366-aa30-42fd-8cd6-1f4b2e7c8383/static/mandate-project-page), title `Mandate · project context debt`. The gallery image is a labelled `Sample data` fixture, not a tenant capture |
| Payloads in the hero screenshots | **Live:** `MOBL-57` on the demo tenant, produced by the real engine over Jira REST. Fixture renders are separately labelled `Sample data` in the gallery |
| Live-tenant calibration (does P2 catch what a real team missed?) | **Not yet measured as accuracy.** One seeded demo tenant, 30 issues: 28 `missing`, 1 `stale` (1,703 days), 1 unscorable (`NO SCORE`). Enough to show the instrument works on live data, not enough to claim accuracy |
| “Three delivery leads tested it” | **Not claimed.** Tester protocol (`08`) is scheduled; no quote goes on screen until a real session happens |
| Marketplace approval | Depends on Atlassian review; listing and assets are prepared, status is stated in the submission form, never assumed |

## 4. Bonus mapping

| Bonus | Why it qualifies | Where to check |
|---|---|---|
| **Best Agents** | `rovo:agent` Context Auditor with a system prompt that forbids inventing a breakdown; three read-only actions it can call | `manifest.yml` (`rovo:agent`), `src/agent/prompt.md`, `test/agent-entry.test.js` |
| **Best MCP** | `rovo:mcp` exposes the same three actions as MCP tools; client-side schema and a real fixture response are documented | `manifest.yml` (`rovo:mcp`), `docs/mcp-examples.md` |
| **Best TWG** | Object-granular graph reads for **issue** and **user**; P2/P3/P4 use cross-object edges where available; a missing edge degrades to a named `unknown`, not a zero. We deliberately do **not** request Confluence page scope: see the scope rationale below. | `manifest.yml` scopes, `test/graph-fields.test.js`, `test/data-inbox.test.js` |
| **Best Marketplace** | Listing copy, privacy policy, icon set, screenshot script, and a 9/9 pre-flight check | `marketplace/listing.md`, `marketplace/privacy-policy.md`, `marketplace/check.js`, `preview/*.png` |

**Why the scopes are proportional (and why one is absent):** the shipped app requests
`read:jira-work`, `read:graph:issue:jira` and `read:graph:user:atlassian`. The user scope
resolves the people behind review traces (P6) and the owner name in the action line. Team scope
is **not requested**: no check needs a roster. Drop `user` and P6 is suppressed with
`why: "reviewTraces-scope-missing"` — the score drops by at most 8 and the panel says why.

Confluence page reads are intentionally **not** requested. In production, a Jira-hosted Forge
app could not mint a cross-product Confluence token (`401 Authentication Required`, then
`UNAVAILABLE_TOKEN_ERROR`), and a scope the app cannot use is worse than a scope it does not
claim. The panel therefore treats page metadata as optional: a Confluence remote link still
counts as a record, but its date/author stay `unknown` unless the site supplies them, and the
receipt says `UNVERIFIABLE` instead of inventing a date. The recommended pattern is a Jira-native
approval record (`MDEMO-2`): the description carries `MANDATE / approved: / owner:`, so the
receipt can compute a real age without a cross-product token.

The app requests no write scope by default; `write:jira-work` is commented out and
`stampMandate` returns `E_WRITE_DENIED` until a site grants it.

## 5. What a reviewer should try to break

- **Make evidence missing.** Remove the `updated` field from a decision page. The panel must
  suppress P2 and name `decisions-no-updated`; it must not report “no drift”.
- **Make the weights disagree.** Any change that lets the six rows not sum to the headline
  number fails `test/score.test.js` and the golden fixtures.
- **Make a partial score look healthy.** Under half the weight judged must print `PARTIAL` and
  no grade; `test/compact.test.js` pins it.
- **Make the agent improvise.** The prompt and the payload both carry `criteria`; an answer that
  invents a seventh criterion or a different total is a prompt violation, and the surface data
  needed to catch it is in the response.

## 6. If the install link is not live yet

The public Try it out page (`https://telegra.ph/Install-Mandate-on-Jira-11-23`) carries a signed
Jira install link generated on 2026-11-24. Without an Atlassian login it redirects to
`id.atlassian.com`; with a login it targets the signed app. Atlassian may show `Invalid link` when
the signed-in account administers no site that can accept the app; this is what the app-owner
account saw when its only admin site already had Mandate installed, and it has not yet been
verified on a second site. In that case, sign in with an account that administers a different
Jira site, or use path B above. The submission does not link to a dead URL: the
privacy policy, terms and install page are all public and return HTTP 200.

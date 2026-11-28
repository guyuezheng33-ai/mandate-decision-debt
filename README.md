# Mandate · Decision Debt

**CI:** [verify workflow](https://github.com/guyuezheng33-ai/mandate-decision-debt/actions/workflows/ci.yml) · **Try it out:** [Install Mandate on Jira](https://telegra.ph/Install-Mandate-on-Jira-11-23) · **90s demo:** [video](https://files.catbox.moe/l0iw16.mp4) · **Source:** this repository (MIT).

> Every work item should be able to say **who authorised it, in which document, and when — and whether that authorisation still holds today.**
> When it cannot, that gap is Decision Debt, scored 0–100.

Mandate is a Forge app that audits the authorisation behind each Jira item, scores unmet conditions 0–100 as Decision Debt, and holds a **300 ms** scoring budget with **P50 30–43 ms** on the development laptop; a **30-item MOBL audit** is reproducible by one command.

**Short definition:** Mandate is a Jira authority audit: a deterministic **score** with a **300 ms** budget (**P50 30–43 ms**) and a **30-issue** live audit.

Canonical definition (formal model, category, value, proof obligations): [`docs/PRODUCT-DEFINITION.md`](docs/PRODUCT-DEFINITION.md).

**Five verdicts, not a binary:** `CURRENT`, `NOT CURRENT`, `CONTESTED`, `NO RECORD`, and `UNVERIFIABLE · NO SCORE`. `NO RECORD` means the absence is the finding; `UNVERIFIABLE` refuses to score and names what scope to restore. The 90-second demo shows `UNVERIFIABLE` at 1:03, not only the happy path.

**Measured on the live tenant (2026-11-23):** 30 issues → 28 `missing`, 1 `stale` (`MOBL-57`, 1,703 days), 1 unscorable (`NO SCORE`). Scope: one seeded demo project, REST-only; not a benchmark of all Jira sites.

**Live evidence (tenant captures; fixture labelled):** [MOBL-57 receipt](https://github.com/guyuezheng33-ai/mandate-decision-debt/blob/master/preview/real-panel-mobl57-en.png) · [MOBL-57 six checks](https://github.com/guyuezheng33-ai/mandate-decision-debt/blob/master/preview/real-panel-mobl57-en-checks.png) · [MOBL-56 no record](https://github.com/guyuezheng33-ai/mandate-decision-debt/blob/master/preview/real-panel-mobl56-en.png) · [30-item audit](runs/real-audit-mobl-30.json) · [live project page](https://one-atlas-ngpq.atlassian.net/jira/software/projects/MOBL/apps/c3df8fe6-3626-4829-9025-47d55b1bde54/696b5366-aa30-42fd-8cd6-1f4b2e7c8383). The gallery project-page image remains a `Sample data` fixture because the tenant is not shared; the route itself is live.

Built for Atlassian Codegeist 2026. Primary user: the **delivery lead** — someone running several workstreams who has to explain "why is this being built" every week.

Architecture (read path, write path, offline evaluation): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## What it does

Four surfaces, one set of criteria:

| Surface | The question it answers |
|---|---|
| Jira issue panel | Why does this item exist, and is its mandate still valid? |
| Jira project page | How much debt does this project carry, and which item do I look at first? (coverage printed above the ranking) |
| Rovo agent | Which work in this project is resting on evidence that needs re-confirmation? |
| MCP (Cursor / Claude) | Same criteria, callable from the IDE. |

The project-page module is live on the company-managed `MOBL` project: [open the project page](https://one-atlas-ngpq.atlassian.net/jira/software/projects/MOBL/apps/c3df8fe6-3626-4829-9025-47d55b1bde54/696b5366-aa30-42fd-8cd6-1f4b2e7c8383). The page title is `Mandate · project context debt`; the gallery image is a labelled `Sample data` fixture because the tenant is not shared, not a claim that the gallery capture is the live tenant.

All four call the same three read-only actions (`get-issue-provenance`, `list-context-debt`, `trace-drift`); the panel reaches them through `@forge/resolver`, the agent and MCP through `action` modules. Nothing is computed twice, and nothing is computed in a prompt.

## Six criteria (facts, not model guesses)

| ID | Name | Test | Weight |
|---|---|---|---|
| P1 | No mandate | Neither a mandate document nor a linked goal | 25 |
| P2 | **Change not propagated** | The mandate page was edited after work started, with no confirmation since | 20 |
| P3 | Conflicting mandates | Two or more mandate documents on the same topic with different owners | 15 |
| P4 | Goal drift | The linked goal is closed (or stale), yet work continues | 18 |
| P5 | Re-litigation | Reopened ≥2 times with no new mandate document in between | 10 |
| P6 | Single author, no review | The mandate page has exactly one contributor and no second review trace | 8 |

**P2 is the hero criterion** because it is a diff, not a threshold. It does not say "this document is old". It says "this document changed, and nobody carried the change down to the people executing it."

## Three lenses (one engine, different heroes)

| Lens | Main question | Hero criterion |
|---|---|---|
| Software delivery | Which decision does this work rest on — and is it still valid? | P2 |
| Launch & marketing | Is the story we tell outside the same story we agreed inside? | P3 |
| Portfolio governance | Is the work in flight still serving a goal that is on the books? | P4 |

The lenses differ in **main question + hero criterion + what we call the evidence + weights + thresholds**. The engine is shared.

---

## The one direction we write

Everything is read-only except a single, gated step: `stampMandate` adds **one** comment recording that someone re-checked the mandate against the work — actor, UTC time, the fingerprint of what was reviewed, and the page URLs.

It is a loop, not a POST: the comment is read back (`E_WRITE_UNVERIFIED` if it cannot be seen), folded into `lastConfirmAt`, and the panel returns `debtBefore / debtAfter`. If the mandate page changes again, `confirmed < decided` re-fires P2 with no extra bookkeeping.

`write:jira-work` ships commented out; without it the port does not exist, `canWrite` is false, and the button never renders. `src/ports/write.jira.js` is the only file in `src/` allowed to contain a write verb, and `npm run marketplace` asserts it.

---

## Three-valued evidence

An empty graph query can mean "there really is no mandate" or "the scope was missing / the call timed out / the page could not be parsed". Treating both as "no mandate" would paint a wall of false red on someone else's site — and one false red costs all the trust.

So every edge carries one of three states: `present` / `absent` / `unknown`.

- Only `absent` can trigger a "no mandate" style finding
- `unknown` always suppresses the finding, and the panel says so: which edge is missing, which scope is needed
- Project scans always print coverage ("18/25 items covered, 7 unknown"), and a bundle with no known edge produces **no score at all**
- The scan budget is printed too ("8 of 25 scanned · REST caps at 8 per load"); every **score** carries **P50 30–43 ms** against a **300 ms** budget, because a score computed on a subset is a subset score
- A scan does not read comments, so it also prints `confirmations not read in a scan` — the one place where the item panel and the project page can legitimately disagree is named on the page instead of left to be discovered
- Every score can be taken apart: a folded six-row table lists each criterion as `hit` / `clear` / `unknown` with its weight, and the weights that hit must sum to the number on screen (asserted)
- A project page answers the second question too: `Debt mix: P1 26% · P2 21%` — weight contribution, not hit count, so one P1 (25) is not outvoted by two P6 (8)
- Concurrent reads of the same item are coalesced (single-flight), and a read that departed before an invalidation is refused when it comes back — a stamp cannot be undone by a slower request

In one line: **it never reports "not there" when the truth is "could not see".**

---

## Run it (no Forge CLI, no site required)

```bash
npm run verify       # 221 assertions, one line of output
npm run seed:dry     # self-test for the seed grader (fictional samples)
npm run preview      # renders preview/panel.html — open it in a browser
npm run ui:build     # bundles the real Forge panel UI (esbuild)
node cli.js          # list samples
node cli.js KAN-3    # delivery lens card for one work item
node cli.js KAN-20 launch   # same item, different lens — different colour
node cli.js KAN-3 --en     # English output
node bench.js              # 500 items × 3 lenses, p50 in a 30–43ms band (7 rounds, budget 300ms), payload sizes, single-score p95
npm run manifest          # offline manifest wiring check (actions / tools / handlers)
npm run harness           # rebuild the local panel harness (also emits preview/dev/payloads.json)
npm run proof             # regenerates docs/verification.md from the real TAP output
npm run corpus            # 21-sample corpus × 3 lenses → docs/corpus-report.md (re-checks manifest sha256)
npm run eval              # baseline / 95% CI / time holdout / P2 counterfactual → docs/evaluation.md
npm run eval:incremental  # watermark replay: 21 → 0 new → 1 new → 0 new at 10× → docs/incremental-eval.json
npm run docs:check        # fails if any doc still quotes an old assertion count
npm run check             # everything, twice: verify ×2, corpus ×2, eval, incremental, bench p50, probe, marketplace, submission
pwsh scripts/check.ps1    # one-command entry on Windows (runs npm run check)
make check                # one-command entry on macOS/Linux (runs npm run check)
npm run ci                # ui:build + manifest + verify + bench
```

`preview/ui-harness.html` renders the **actual panel UI** (`src/ui/`) against fixture payloads, with no Jira tenant. `?sample=kan11` shows the unknown state, `?sample=degraded` shows the REST-degraded state (the one a trial org without Graph Preview will see), `?sample=project` shows the project page, `?lang=zh` shows the Chinese locale.

The panel follows the system colour scheme (`prefers-color-scheme`); Jira does not re-theme a Forge iframe for you, so the dark palette is declared in `src/ui/style.css` rather than assumed.

What MCP clients actually receive — three tool schemas, three real requests, three responses produced by the fixture port, and what is deliberately **not** exposed — is in [`docs/mcp-examples.md`](docs/mcp-examples.md). The column contract the site's registered query has to satisfy (which field each criterion needs, and what happens when it is missing) is in [`docs/registered-queries.md`](docs/registered-queries.md).

Before this goes on a real site there is one gate: **`npm run seed`**. Load 21 real work items into `seed/seed-sheet.csv` (the grader accepts JSON or CSV), and it tells you whether the criteria have material on that site. If three or more criteria are empty, what must change is the content, not the thresholds.

`verify` prints something like:

```
verify 2026-11-20  agent-entry 15/15  cache 4/4  chain 7/7  compact 10/10  contract 9/9  copy 7/7
                   data-inbox 10/10  entry 9/9  golden 2/2  grade-floor 6/6  graph-fields 3/3
                   hardening 11/11  hydrate-batch 6/6  ports 20/20  profiles 4/4  property 4/4
                   robustness 3/3  rules 27/27  score 7/7  surface 4/4  tri 6/6  write 8/8
                   |  total 221/221  => PASS
bench  500 items × 3 lenses · 1500 scores · p50 30.6ms (min 28.7 / max 42.7, 7 rounds, budget 300ms) · aggregate 927KB → project payload 3KB (cap 200KB)
       issue payload max 2KB · single-score p95 0.08ms
```

`npm run proof` turns that output into [`docs/verification.md`](docs/verification.md): one row per assertion, with what it protects. It is generated from real TAP output rather than written by hand, so it cannot quietly go stale.

`npm run corpus` runs the 21-sample evidence corpus through all three lenses and writes [`docs/corpus-report.md`](docs/corpus-report.md): per-lens project numbers side by side, the grade distribution, the 21 rows with their flags, top-of-list precision (does the ranked page put the items with gaps first), and every place the engine and the corpus's own labels disagree. It also re-checks the corpus manifest sha256 (26/26) on each run. The report states in its own first paragraph that the corpus is simulated and that label agreement is pipe-consistency, not calibration — a number without that sentence would be overselling.

`npm run check` is the one command to trust, and it runs things **twice** on purpose: `verify ×2` (same assertions, same totals), `corpus ×2` (byte-identical report), `eval` + `incremental` (same counts on re-run), `bench` as a p50 over 7 rounds, the corpus probe, and the marketplace audit. It ends in one of three states, because conflating them is what makes a rerun look broken:

| verdict | meaning | exit |
|---|---|---|
| `CLEAN` | everything passed | 0 |
| `CLEAN-EXCEPT-PLACEHOLDERS` | engineering passed; only fields that require a registered site/account remain (`app.id`, icon URL, support email, privacy URL) | 0 |
| `BLOCKED` | a real regression | 1 |

`bench` is deliberately a median, not a single reading: one number that swings between 67ms and 330ms on a busy laptop cannot gate a 300ms budget without turning machine load into a fake red.

## Layout

```
src/
├─ engine/     normalise / three-valued edges / six criteria / three lenses / scoring   ← zero I/O, fully testable offline
├─ io/         payload clipping (200KB cap) / error codes / evidence fingerprint
├─ ports/      chain(twg→rest) / twg / graph client / jira client / rest / hydrate / confirm / fixture / repair / write   ← one contract, ten implementations
├─ resolvers/  the four actions (shared by the agent, MCP and the panel)
├─ agent/      Rovo agent prompt + the three action handlers (same contract as the panel)
├─ ui/         the Forge panel + project page (custom UI, bundled with esbuild)
└─ fixtures/   KAN-3 drift · KAN-7 conflict · KAN-9 no mandate · KAN-11 all unknown · KAN-20 lens difference
test/          221 assertions (rules · tri · profiles · score · compact · ports · chain · entry · agent-entry · copy · hardening · write · robustness · golden · cache · property · contract · surface · data-inbox · grade-floor · graph-fields · hydrate-batch)
verify.js      one command for everything
```

## What the tests actually pin

Not "it runs" — the ways this product can quietly become wrong:

| Risk | Test |
|---|---|
| A timeout is reported as "no mandate" | `hardening`: an edge that fails stays `unknown`; a missing `read:graph:page` scope makes decisions `unknown` even when data comes back |
| One user's visibility leaks into another's score | `hardening`: same key, two `userId`s, no cross-read; the cache refuses to build a key without one |
| A 25-item project turns into 25 round trips | `hardening`: scan performs exactly one query; `limit: 999` is clamped to 50 |
| Malformed graph data turns the panel white | `robustness`: 200 seeded mutations — no throw, debt stays 0–100, coverage stays consistent |
| The score shifts by a day on another timezone | `robustness`: same fixtures under `Asia/Singapore`, `UTC`, `America/Los_Angeles` produce identical numbers |
| The number drifts because someone "tuned" a weight next Tuesday | `golden`: 5 fixtures × 3 lenses, `debt / grade / flags / coverage` frozen |
| A trial org without Graph Preview sees a red box | `chain`: primary `E_SCOPE` → fallback answers, graph-only edges forced to `unknown`, `degraded {from,to,reason}` printed in the panel |
| An agent or MCP call reaches a function expecting a different payload | `agent-entry`: action payload + context merged, `accountId` taken from `context` only, errors returned as data |
| A new error code ships with no user-facing sentence | `copy`: every code in `errors.CODES` must have a title and body in both languages |
| The trace writes a comment, the score never moves | `write`: comment → `lastConfirmAt` → `debtBefore 28 / debtAfter 8`, through the real ADF round trip |
| A retried click writes a second trace | `write`: fingerprint excludes `lastConfirmAt`, so the second stamp returns `skipped` |
| A write reports success that cannot be read back | `write`: `E_WRITE_UNVERIFIED` instead of a green tick; a 500 is `E_SERVER`, not `No write permission` |
| The REST scan issues 51 requests while claiming not to | `ports`: 20 ids in, JQL asked for 8, 8 `getIssue` calls out; the project page prints `8 of 25 scanned` |
| Two surfaces open the same item at the same second, and both hit the graph | `cache`: single-flight — five concurrent reads execute the loader once; a failure does not stick |
| A stamp lands, then an in-flight read writes the pre-stamp world back into cache | `cache`: read captures the cache epoch on departure; after `dropWhere` the stale token is refused, so the number cannot bounce back for 60 seconds |
| A project row with no score says "no criterion hit" (= "nothing wrong") | `compact`: an `unknown` item must carry the names of the missing edges |
| The debt mix counts hits, so two small findings outrank one big one | `score`: driver sums must equal the weight of every hit, and `P1 25` sorts above `P2 20` |
| The panel prints 28 and nobody can say why the other four rows are 0 | `score` / `compact`: `criteria` stays aligned with `flags` and `skipped`, and the `hit` weights sum to `debt` |
| A page arrives without a timestamp / owner / contributor list, and the rule reports "no finding" | `rules` `gaps`: a missing field is `unknown` with the field name in `why`; `normalize` records `contributorsKnown` so an empty list is not a missing list |
| A score built from 45% of the weight is labelled "healthy" | `compact`: `partial` + `certainty < 0.5` → the UI prints "partly judged", never a grade |
| Swap in another data set and some invariant quietly breaks | `property`: 200 random bundles × three lenses, ten invariants, and no score above the structural ceiling of 71 |
| Switching a port (TWG → REST) would require touching the layer above | `contract`: one contract suite runs against all three ports; failures degrade to `unknown` instead of throwing |
| The panel says 28 and the agent says `unknown` for the same item | `surface`: the four entrances (panel / resolver / agent / MCP) return one debt, one grade and the same six rows |

Plus 11 checks on retry semantics: 429 is retried, `E_SCOPE` is retried zero times (a permission problem is not weather), and a single failing REST item does not empty the list.

`node bench.js` reports the shape of the real workload: `500 items × 3 lenses · 1500 scores · ~43ms · aggregate 735KB → project payload 2KB · issue payload max 2KB (cap 200KB) · single-score p95 0.02ms`.

## Decisions, with the alternatives that lost

Nineteen short records in [`docs/adr/`](docs/adr/): three-valued evidence · two query shapes · the agent never computes · cache key includes the user · no external model · read-only by default · one port degraded · graph via registered queries · the trace read back · scan budget · single-flight with epoch refusal · the score must be divisible · the ceiling is 71 · reads are not gated on the scope list · one scan row is one work item · a missing field is `unknown`, never `clear` · an unknown hero criterion means no grade · project-page hydration is one batched JQL · a rejected selection set falls back to basic, a 403 does not. Each one names the option I rejected and why — including the ones that would have been faster to ship.

## Deliberately not built

- **No workflow gate** — that turns into yet another approval plugin and breaks the reviewers' own testing flow
- **No bulk write-back** — the single trace stamp is idempotent and gated behind the 13th acceptance item
- **No external LLM** — semantics belong to Rovo; the scoring must be reproducible
- **No i18n of the data model / multi-tenancy / billing wrappers** — engineering that buys no points
- **No "X% faster" claims** — a number without a sample is caught by any reviewer in one glance

## Known limits

- Teamwork Graph is read-only; writes go through Jira REST, and `write:jira-work` ships disabled in v1
- Page edit timestamps and contributor sets only come from TWG; on the REST fallback P2/P6 report `unknown` rather than guessing
- `manifest.yml` wiring is verified offline by `npm run manifest` (action → function → handler export, `mcp.tools` → action keys); `forge lint` itself needs a login and a registered app id
- Graph access needs two registered persisted queries (`MANDATE_QK_BUNDLE`, `MANDATE_QK_SCAN`). Without them the app runs on Jira REST and says so — it does not fail


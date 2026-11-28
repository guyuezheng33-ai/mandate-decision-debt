# MCP: what these three tools look like from a client

`rovo:mcp` exposes three actions as MCP tools. They are the same actions the Rovo agent and
the issue panel call; only the surface differs. This page exists because "we wired MCP" is a
claim, and a reviewer wants to see the wire.

App: **Mandate** · MCP server key `mandate-mcp` · tools: `get-issue-provenance`,
`list-context-debt`, `trace-drift`. Read-only. No OAuth of our own — access is the
Atlassian Remote MCP Server plus the scopes the installing site already granted.

## How a client sees it

A user adds the app's MCP endpoint to their client. The endpoint is built from the app id:
`https://mcp.atlassian.com/forge/<appId>` (the UUID part of `ari:cloud:ecosystem::app/<appId>`).
After authorising the tenant and turning the app's tools on for external clients, the installed
app's tools appear alongside Atlassian's own. Nothing is pasted from our side; the tool list comes
from the manifest:

```json
{
  "tools": [
    {
      "name": "get-issue-provenance",
      "description": "Return the evidence chain behind one Jira work item …",
      "inputSchema": {
        "type": "object",
        "properties": {
          "issueKey": { "type": "string", "description": "The work item to audit, for example KAN-3." },
          "profile":  { "type": "string", "description": "One of software, launch, portfolio. Defaults to software." },
          "lang":     { "type": "string", "description": "en or zh. Defaults to en." }
        },
        "required": ["issueKey"]
      }
    }
  ]
}
```

## Call 1 — `get-issue-provenance`

Request:

```json
{ "name": "get-issue-provenance", "arguments": { "issueKey": "KAN-3", "profile": "software" } }
```

Response (abridged; this is the real payload from the fixture port, not a mock-up):

```json
{
  "ok": true,
  "issueKey": "KAN-3",
  "summary": "One-click archive for projects inactive over 90 days",
  "status": "In Review",
  "profile": "software",
  "debt": 28,
  "grade": "watch",
  "flags": [
    {
      "p": "P2", "k": "drift_not_propagated", "w": 20, "s": "high",
      "label": "Change not propagated",
      "detail": "The decision record was edited on 2026-08-14, work started on 2026-06-20, and nobody has confirmed since — 92 days apart.",
      "action": "Ask the decision record owner to re-confirm, and append \"still valid / changed\" back to the page …",
      "evidence": {
        "decidedAt": "2026-08-14T06:00:00.000Z",
        "inProgressSince": "2026-06-20T02:00:00.000Z",
        "lastConfirmAt": null,
        "sources": [{ "title": "Archive policy: archive anything inactive for 90 days",
                      "url": "https://example.atlassian.net/wiki/spaces/KAN/pages/8841" }]
      }
    }
  ],
  "suppressed": [],
  "criteria": [
    { "p": "P1", "w": 25, "state": "clear" },
    { "p": "P2", "w": 20, "state": "hit" },
    { "p": "P3", "w": 15, "state": "clear" },
    { "p": "P4", "w": 18, "state": "clear" },
    { "p": "P5", "w": 10, "state": "clear" },
    { "p": "P6", "w": 8,  "state": "hit" }
  ],
  "coverage": { "known": 3, "total": 3, "ratio": 1 },
  "source": "fixture",
  "degraded": null,
  "fingerprint": "dd-bef8f204",
  "canWrite": false
}
```

Two things to notice, because they are the difference between a tool and a text generator:

- `source: "fixture"` and `degraded: null` are **stated**, not inferred. A real tenant says
  `twg` or `rest`; a degraded one says `rest` plus `degraded: {from, to, reason}`.
- `suppressed` is a first-class field. When a scope is missing, the criteria that depend on it
  are listed here rather than scored as zero.
- `criteria` is six rows, one per primitive, each with its weight and one of `hit` / `clear` /
  `unknown`. A model can therefore explain `28 = 20 + 8` without inventing a breakdown, and a
  reviewer can check the arithmetic instead of trusting the summary. `unknown` rows also carry
  a `why` naming the missing edge **or the missing field** (`decisions-no-updated`,
  `goals-no-state`, `issue-no-reopen-count`).
- `partial` / `unknownPrims` / `certainty` / `thin` travel with the payload. A model that reads
  `thin: true` is required to say "under half the weight was judged" and must not print a grade —
  the panel prints `PARTIAL` in exactly the same case, so the two surfaces cannot disagree.

## Call 1b — the same tool on a live tenant (REST capture, 2026-11-28)

The block above is the fixture port. This one is a **real capture** from the seeded demo
tenant `one-atlas-ngpq.atlassian.net`, produced by the same action over the REST port on
2026-11-28. Full unabridged payload: `runs/live-provenance-mobl57.json`; the 30-item run it
belongs to is `runs/real-audit-mobl-30.json` (28 missing / 1 stale / 1 unscorable).

Request:

```json
{ "name": "get-issue-provenance", "arguments": { "issueKey": "MOBL-57", "profile": "software" } }
```

Response (abridged; `source: "rest"` is the live REST port, not a fixture):

```json
{
  "ok": true,
  "issueKey": "MOBL-57",
  "summary": "Compliance",
  "profile": "software",
  "debt": 0,
  "grade": "watch",
  "authority": {
    "state": "present",
    "verdict": "stale",
    "ownerName": "Alana Grant",
    "title": "Product requirements — approval record",
    "url": "https://one-atlas-ngpq.atlassian.net/browse/MDEMO-2",
    "updatedAt": "2022-03-26T00:00:00.000Z",
    "lastConfirmAt": null,
    "daysSinceUpdate": 1703,
    "daysWithoutConfirm": 1703,
    "decisionCount": 2
  },
  "partial": true,
  "certainty": 0.21,
  "thin": true,
  "flagCount": 0,
  "flags": [],
  "criteria": [
    { "p": "P1", "w": 25, "state": "unknown", "why": "goals" },
    { "p": "P2", "w": 20, "state": "clear", "why": null },
    { "p": "P3", "w": 15, "state": "unknown", "why": "decisions-no-owner" },
    { "p": "P4", "w": 18, "state": "unknown", "why": "goals" },
    { "p": "P5", "w": 10, "state": "unknown", "why": "issue-no-reopen-count" },
    { "p": "P6", "w": 8,  "state": "unknown", "why": "reviewTraces" }
  ],
  "coverage": { "known": 1, "total": 3, "ratio": 0.33 },
  "source": "rest",
  "degraded": null,
  "fingerprint": "dd-6e2c9910",
  "canWrite": false
}
```

Three things this live block proves that a fixture cannot:

- The hero fact is real: an approval dated 2022-03-26, owner Alana Grant, **1,703 days**
  without re-confirmation, read from a Jira-native approval record (`MDEMO-2`) — no
  cross-product Confluence token involved.
- `debt: 0` with `grade: "watch"` is not a contradiction: no criterion *hit*, but the
  authority verdict is `stale`, and the grade floor refuses to print "healthy" over a
  1,703-day-old approval. `thin: true` and `certainty: 0.21` force the agent to disclose
  that only one of six criteria could be judged on REST.
- `P2: clear` here is honest, not a miss: the record's server-side edit (2026-11-23) is
  newer than the work start, and the audit's `asOf` has not yet aged past the 14-day drift
  threshold. A hit becomes observable once the edit ages past the threshold — the engine
  does not invent one to make the demo exciting.

A TWG-port capture (`source: "twg"`) requires the Forge runtime on the installed site and
is pending; until then this page labels every block with its true port.

## Call 2 — `list-context-debt` (the one with a budget)

Request:

```json
{ "name": "list-context-debt", "arguments": { "projectKey": "KAN", "limit": 25 } }
```

Response (abridged):

```json
{
  "ok": true,
  "projectKey": "KAN",
  "debt": 24,
  "grade": "watch",
  "itemCount": 5,
  "countedCount": 4,
  "unknownCount": 1,
  "certainty": 0.9,
  "partialCount": 3,
  "disclosure": { "counted": 4, "total": 5, "unknown": 1 },
  "scan": { "source": "rest", "requested": 25, "fetched": 5, "cap": 8, "capped": true, "degraded": true },
  "items": [
    { "issueKey": "KAN-7",  "debt": 43, "grade": "at_risk", "top": "P4", "label": "Goal drift" },
    { "issueKey": "KAN-3",  "debt": 28, "grade": "watch",   "top": "P2", "label": "Change not propagated" },
    { "issueKey": "KAN-9",  "debt": 25, "grade": "watch",   "top": "P1", "label": "No mandate" },
    { "issueKey": "KAN-11", "debt": null, "grade": "unknown" }
  ]
}
```

A model reading this must repeat the coverage line before the score. That is rule 8 in
`src/agent/prompt.md`: *"a project score computed on a subset is still a subset score."*
`debt: null` on KAN-11 is not an omission — it is the honest answer for an item with no
known edges, and the panel prints `–` / `NO SCORE` rather than `0`.

`certainty` / `partialCount` carry the same idea one level up: the project number is a
**lower bound**. When a page comes back from a scan where issue metadata had to be backfilled
in one batched JQL, the payload looks like this instead:

```json
{
  "ok": true,
  "projectKey": "DEL",
  "debt": 16,
  "grade": "watch",
  "certainty": 0.9,
  "partialCount": 5,
  "countedCount": 5,
  "unknownCount": 0,
  "scan": { "source": "twg", "fetched": 5, "cap": null, "capped": false },
  "items": [
    { "issueKey": "DEL-106", "debt": 25, "grade": "watch",   "partial": true, "unknownPrims": ["P5"], "certainty": 0.9 },
    { "issueKey": "DEL-101", "debt": 20, "grade": "watch",   "partial": true, "unknownPrims": ["P5"], "certainty": 0.9 }
  ]
}
```

If fewer than half the items can be graded, `debt` is `null` and `grade` is `unknown`
(ADR 0017). A model must not average the known half and present it as the project score;
the prompt has a project-level template for exactly that case.

## Call 3 — `trace-drift`

Request:

```json
{ "name": "trace-drift", "arguments": { "issueKey": "KAN-3" } }
```

Response:

```json
{
  "ok": true,
  "issueKey": "KAN-3",
  "profile": "software",
  "source": "fixture",
  "timezoneNote": "UTC",
  "drifting": true,
  "decidedAt": "2026-08-14T06:00:00.000Z",
  "inProgressSince": "2026-06-20T02:00:00.000Z",
  "lastConfirmAt": null,
  "daysSinceChange": 92,
  "thresholdDays": 14,
  "sources": [{ "id": "page-8841", "url": "https://example.atlassian.net/wiki/spaces/KAN/pages/8841",
                "updated": "2026-08-14T06:00:00.000Z" }],
  "summary": "The mandate changed on 2026-08-14 and the delivery side has not confirmed for 92 days."
}
```

`daysSinceChange` and `thresholdDays` are both returned, so a caller can disagree with the
lens without re-deriving dates. `drifting` is just `daysSinceChange >= thresholdDays` — a
comparison, not a score. Debt lives in `get-issue-provenance`, which multiplies the finding by
the profile's weight. If this tool returned a verdict too, there would be two scoring engines
and they would drift apart.

## What is *not* exposed

- No write tool. `stampMandate` is a panel resolver action only: it is not an action module,
  not in the agent's action list, and not in `rovo:mcp.tools`. It also needs
  `write:jira-work`, which ships commented out. An MCP client — or the agent — cannot mutate
  a tenant through this app in v1, and the agent's prompt tells it to say so rather than pretend.
- No "set score" or "override" tool. The score is a function of evidence; if the evidence is
  wrong, the fix is upstream, not a knob.
- No cross-project or cross-tenant tool. Every call is bounded by the caller's own
  `accountId` and the scopes of the installation.

## How to reproduce this page

```bash
npm run manifest        # 3 actions · 4 functions · 4 scopes, tools = action keys
npm run verify          # agent-entry: payload shape accepted, accountId taken from context
npm run harness         # local panel, same payloads as above
npm run matrix          # four-surface equality, fixture; MODE=live ISSUE=MOBL-57 for the tenant
```

The live block in Call 1b was produced with `JIRA_TOKEN` set, via
`buildActions({ jira: liveClient() }).getIssueProvenance(...)` (see `tools/surface-matrix.js`),
and saved unmodified to `runs/live-provenance-mobl57.json`.

The MCP endpoint above is Atlassian's, not ours; if their URL changes, this page changes with
it and nothing in the app does.

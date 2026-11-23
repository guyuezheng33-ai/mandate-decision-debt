# Registered graph queries: the column contract

Forge apps cannot send bare Cypher to the Teamwork Graph. An admin registers a **query key** in the
site, and the app only sends that key plus parameters (`MANDATE_QK_BUNDLE`, `MANDATE_QK_SCAN`). If a
key is not set, the port reports itself unavailable and the chain falls back to Jira REST — that is
by design, not a failure.

Because the query shape lives on the site, this file is the contract the site must satisfy. The
mapper is forgiving about extra columns (it ignores them) but strict about missing ones: a field that
never arrives becomes `unknown`, never `clear` (ADR 0016).

## Two shapes

| Key | Shape | Returns |
|---|---|---|
| `MANDATE_QK_BUNDLE` | one edge node | one issue, with `decisions` / `goals` / `reviewTraces` columns |
| `MANDATE_QK_SCAN` | N edge nodes (one per issue) | each row is **one work item**, carrying its own three columns |

The scan shape matters: a row is an issue, not a linked page (ADR 0015). If the query returns one
row per page, the app will see fewer items than the project has and will say so through coverage.

## Columns the mapper reads

| Column key | Aliases accepted | Item fields used |
|---|---|---|
| `issue` | `workitem` | `id` (or `title`) becomes the issue key |
| `decisions` | `pages` | `id`, `title`, `webUrl`, `updated` / `lastModified`, `owner` / `author` / `createdBy`, `contributors` |
| `goals` | — | `id`, `title`, `status` / `state`, `updated` |
| `reviewTraces` | `contributors` | `pageId` / `decisionId`, `actorId` / `accountId`, `at` / `created` |

Column values must be a list node (`{ nodes: [...] }`). A column that is present and empty is read
as **absent** ("we looked, there is none"); a column that is missing or `null` is read as
**unknown** ("we did not get an answer"). Those two are not interchangeable — the whole three-valued
model depends on them staying distinct.

## Which field each criterion needs

| Criterion | Needs | If it never arrives |
|---|---|---|
| P1 no mandate | both edges `absent` | `unknown` |
| P2 change not propagated | `decisions[].updated` + issue `inProgressSince` | `unknown` (`decisions-no-updated`) |
| P3 conflicting mandates | ≥2 decisions with `owner` | `unknown` (`decisions-no-owner`) |
| P4 goal drift | `goals[].status` or `goals[].updated` | `unknown` (`goals-no-state`) |
| P5 re-litigation | issue `reopenedCount` (or `lastReopenedAt`) | `unknown` (`issue-no-reopen-count`) |
| P6 single author, no review | `decisions[].contributors` + traces with `pageId` and `actorId` | `unknown` |

A query that projects only `id` and `title` is legal, and the app will work — it will simply report
P2/P3/P4/P6 as not judged and mark those rows `PARTIAL`. That is the honest outcome, and it is
visible in the UI rather than buried in a log.

## Sketch (illustrative, not a copy-paste query)

The exact Cypher dialect is the site's; what matters is the projection:

```text
MATCH (i:JiraIssue {key: $issueKey})
OPTIONAL MATCH (i)-[:MENTIONED_IN]->(p:ConfluencePage)
OPTIONAL MATCH (i)-[:LINKED_TO]->(g:Goal)
OPTIONAL MATCH (u:AtlassianUser)-[:REVIEWED]->(p)
RETURN i                                            AS issue,
       collect(DISTINCT {id: p.id, title: p.title, webUrl: p.webUrl,
                         updated: p.lastModified, owner: p.authorId,
                         contributors: p.contributorIds}) AS decisions,
       collect(DISTINCT {id: g.id, title: g.title, status: g.status,
                         updated: g.lastModified})        AS goals,
       collect(DISTINCT {pageId: p.id, actorId: u.accountId,
                         at: u.lastActiveAt})             AS reviewTraces
```

For the scan shape, `MATCH (i:JiraIssue) WHERE i.projectKey = $projectKey` and `LIMIT $limit`, with
the same three columns per row.

## Which selection set, and what happens when the schema says no

`MANDATE_GRAPH_FIELDS` picks the GraphQL selection set (`basic` by default, `extended` for
`lastModified / author / contributors`, `Goal.status`, and issue metadata). The registered Cypher
does not change; only the fields we ask for do.

If a tenant's schema rejects `extended` (validation error, not 403), the client retries once with
`basic` and returns `fields: "basic"`, `fieldsFallback: true` on the same payload — the score still
comes out, and the UI can say which criteria went blind. A 403 is never retried: a narrower
selection set does not fix a missing scope. Both cases are pinned by `test/graph-fields.test.js`.

## Verifying it without a tenant

`npm run harness` renders both shapes from fixtures, and `node verify.js` runs the mapper tests
(`agent-entry`) that pin the row semantics. Neither needs a registered query, a site, or a login —
which is why the mapping bugs in ADR 0015 were caught offline rather than during a demo.

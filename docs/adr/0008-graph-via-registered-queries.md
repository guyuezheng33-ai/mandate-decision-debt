# ADR 0008 · Graph access only through registered queries, and only as the user

**Status**: accepted · **Date**: 2026-11-20

## Context

Teamwork Graph is a GraphQL endpoint that runs Cypher. Two platform facts shape the integration:

- It is **user-scoped**: calls run as the current user (`asUser()`); there is no `asApp` variant, so the graph can never see more than the viewer can.
- For apps, the runtime sends **registered persisted queries** (`customQuery(queryKey, queryParams)`); raw Cypher text is not sent from the running app.

A local prototype that injects a fake `query()` function looks complete and proves nothing about either of those facts.

## Decision

- `src/ports/graph.client.js` calls `@forge/api`'s `requestTeamworkGraph` through `asUser()`, and sends only `customQuery` with a `queryKey` read from `MANDATE_QK_BUNDLE` / `MANDATE_QK_SCAN`.
- If those keys are absent, the client declares itself unavailable **without sending a request**, and the port chain degrades to Jira REST. A misconfiguration must not turn into a red panel or a wasted 20-second call.
- The GraphQL projection selects only stable fields (`__typename`, `id`, `title`, `webUrl`, `displayName`). The mapper tolerates missing fields and never fills a gap with a guess.
- Issue metadata (`summary`, `status`, `inProgressSince`) is hydrated from Jira REST for **single-item** panels only — never during a scan, which would reintroduce N+1.
- Rovo agent and MCP tools are real `action` modules, each with its own forgetting-free function handler (`src/agent/handlers.*`) that maps action payloads onto the same resolver actions. Identity comes from `context.accountId`, never from model-extracted payload.

## Consequences

- On a tenant without registered queries, the product still works (REST path) and says so.
- Registering the persisted queries is a deployment step, not a code change: two environment variables.
- Three entries (panel, agent, MCP) share one contract and cannot drift into three implementations.

## Rejected

- **Send raw Cypher from the app.** Platform disallows it; it would fail in production while passing every local test.
- **`asApp` graph reads.** Would let one user's score rest on documents they cannot open.

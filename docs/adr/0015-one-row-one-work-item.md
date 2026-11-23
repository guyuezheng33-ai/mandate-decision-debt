# ADR 0015 · One scan row is one work item

**Status**: accepted · **Date**: 2026-11-20

## Context

The graph client's scan path mapped the wrong thing. `customQuery` returns a list of **edge nodes**;
for a project scan each edge node is one work item row, carrying three columns (`decisions`,
`goals`, `reviewTraces`). The old code flattened all columns across all rows, took the first
`decisions` column, and then emitted one bundle **per decision page**:

```js
return { issues: mapped.decisions.map((d) => ({ issue: d, decisions: [], goals: [], reviewTraces: [] })) };
```

On a tenant with a registered scan query that is worse than a wrong number: every emitted bundle had
three empty edges, so every work item would be scored as "no mandate" (P1) or as fully unknown —
depending on whether emptiness was read as `absent` or `unknown`. It also meant the row count was the
number of linked pages, not the number of issues.

The path is dormant unless `MANDATE_QK_SCAN` is configured, which is why the test suite had not
caught it: without the key, the port throws `E_SCOPE` and the chain falls back to REST.

## Decision

Mapping is row-first:

- `mapRow(edgeNode)` reads one edge node's columns into `{issue, decisions, goals, reviewTraces}`.
- Each edge column becomes `{state, items, reason}`:
  - column present with nodes → `present`
  - column present and empty → `absent` (we looked, there is none)
  - column missing or null → `unknown` with `reason: 'column-empty'` (we did not get an answer)
- `mapRows(payload)` returns one row per edge node and drops rows with no issue key at all, rather
  than inventing a work item out of a page.
- The bundle path uses the same `mapRow` on the single edge node, so the two shapes cannot drift.

## Consequences

- A scan of 25 items returns at most 25 bundles, each with its own three edges.
- "Present but empty" and "never returned" are distinguishable, which is the whole premise of the
  three-valued evidence model; the mapper now preserves that distinction instead of flattening both
  into an empty array.
- Missing a work item is visible as a shorter list, not as a fabricated one.

## Rejected

- **Keep flattening and tag the shape.** The consumer (`toBundle`) needs per-item edges; a flat
  column bag cannot supply them without a second pass that would be as wrong, only later.
- **Treat an empty column as `absent`.** It would convert a query that forgot a column into a page
  full of confident findings — the exact failure the product exists to prevent.
- **Skip rows without an issue key silently and pad the list.** The list is the evidence; padding it
  would misrepresent the scan budget.

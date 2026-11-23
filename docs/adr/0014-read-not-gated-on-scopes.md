# ADR 0014 · Read access is not gated on the scope list

**Status**: accepted · **Date**: 2026-11-20

## Context

A new cross-surface test asked one question — does the same issue score the same from all four
entrances? It did not.

Panel and resolver context carry `scopes: [...]`. Rovo action and MCP contexts are not guaranteed to
carry it. `createRestPort` used the list as a capability switch:

```js
const canReadLinks = scopes.includes('read:jira-work');
```

So on the same issue, with the same permissions in reality, the panel got `P2 clear` and the agent got
`P2 unknown`. Debt 0/healthy versus `unknown` — same data, two verdicts, one of them wrong.

Worse, the guess was in the *safe* direction only by accident: it assumed "no scope list means no
scope", which is not what an empty metadata field means. The platform is the authority on permissions;
an unprivileged call fails with 403, which we already classify as `E_SCOPE`.

## Decision

The REST read port no longer consults `scopes`:

```js
const canReadLinks = typeof client?.getIssueLinks === 'function';
```

- If the client can express the call, we make it.
- If the platform denies it, the exception is classified and the edge becomes `unknown` — the same
  outcome the old gate produced, one request later.
- `write:jira-work` keeps its gate, because a write is not a probe: we will not POST and see.

## Consequences

- All four surfaces agree on a given issue (asserted in `test/surface.test.js`).
- A reviewer's site without `read:jira-work` costs one extra denied request per bundle instead of
  silently degrading everything. An honest 403 is cheaper than a silent "no evidence".
- Scope metadata is now used only to decide what we are allowed to *write*, which is the only place a
  pre-flight check is actually worth the risk of being wrong.

## Rejected

- **Require every surface to pass `scopes`.** The Rovo/MCP context shape is not ours to define, and a
  missing field would keep producing two different scores.
- **Default `canReadLinks` to true only when scopes are absent.** Two branches, both guessing, and the
  panel path (the one with real scopes) would never exercise the other one.
- **Gate writes the same way.** A denied write is a user-visible failure and a comment someone may
  read; there the pre-flight check stays.

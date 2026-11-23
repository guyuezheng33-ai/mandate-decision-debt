# ADR 0009 · The trace is read back, or it did not happen

**Status**: accepted · **Date**: 2026-11-20

## Context

`stampMandate` existed and passed its tests while being, in practice, decorative:

1. It posted a plain-text comment. Jira Cloud REST v3 requires the comment body to be **ADF**; a plain string is rejected with 400 on a real site and accepted by every fake client used in tests.
2. `getComments` mapped `{id, author, created}` and dropped `body`. Even a successful write could never be found again, so the idempotency check always missed and every click wrote another comment.
3. Nothing read the stamp back into the evidence. `lastConfirmAt` came from the graph only, so after a "successful" stamp the score did not move. A write that does not change the conclusion is not a write.
4. Every write failure was reported as `E_WRITE_DENIED`. A timeout told the user to go ask an admin for a permission they already had.

## Decision

A single loop, four steps, each with its own assertion:

- **Write** through exactly one module (`src/ports/write.jira.js`), which converts text → ADF and is the only file in `src/` allowed to contain a write verb. `marketplace/check.js` enforces that boundary.
- **Read back** immediately. If the fingerprint we just wrote is not visible, return `E_WRITE_UNVERIFIED` — never "ok, done". We do *not* retry the POST: a duplicate trace is worse than a missing one.
- **Fold into evidence** in `src/ports/confirm.js`: single-issue reads take `latestStampAt(comments)` and raise `lastConfirmAt` when it is later than what the graph reported. Scans never call it (50 items × comments = the N+1 this product exists to avoid).
- **Invalidate and recompute**: after a write the cache entries for that user + issue + project are dropped, the bundle is re-read, and the payload carries `debtBefore / debtAfter / delta`.

Identity is excluded from the fingerprint, not the confirmation: `fingerprintOf` no longer hashes `lastConfirmAt`, because the act of stamping changes it — hashing it would make the second click look like new evidence and write a second comment.

## Consequences

- `E_WRITE_UNVERIFIED` exists in both languages and in the UI copy table; the `copy` test fails if a code ships without a sentence.
- On a graph-less tenant the loop still works: comments come from Jira REST, which needs `read:jira-work` only.
- A stamp is auditable: actor, UTC timestamp, the fingerprint it reviewed, and the mandate page URLs. If the page changes again, `confirmed < decided` re-fires P2.
- With `write:jira-work` absent — the shipping default — the port is `null` at construction, `canWrite` is false, and the button never appears.

## Rejected

- **Best-effort write with no read-back.** It reports success on a permission error that returned 200 with an error body, which is exactly how Forge surfaces some tenant misconfigurations.
- **Retry the POST on timeout.** Turns an unknown outcome into a guaranteed duplicate.
- **Store the confirmation in app storage.** The claim must live where other people can see it, or it is not a confirmation.
- **Treat any comment as a confirmation.** Only our marker counts; otherwise a casual "looks fine" three years ago would silently clear the debt.

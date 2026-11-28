# COMPETITORS · named, checked, and dated

Checked against public Atlassian Marketplace listings on **2026-11-28**.
Feature claims below come from each vendor's published listing and product page;
we did **not** install or benchmark these apps. "Does not advertise" means the
capability is absent from the published feature set, not a claim about internals.

The point of this page: Mandate is not "another approval app". The three nearest
neighbours all **create new approval events**. Mandate **audits the authority
behind work that already exists**, and refuses to score what it cannot see.

## 1. Group Sign-Off: parallel Multi-Approvals — Werkstack GmbH

- Listing: https://marketplace.atlassian.com/apps/1211104/group-sign-off-parallel-multi-approvals
- Vendor page: https://www.werkstack.dev/products/group-sign-off
- Lineage: originally Polscheit (PSIT), development taken over by Werkstack GmbH in 2026
  (https://www.werkstack.dev/blog/werkstack-continues-the-apps-you-rely-on).
- **What it does:** parallel / conditional multi-person approvals attached to workflow
  transitions; M-of-N quorum per approver group; delegation, timeouts, auto-transitions;
  full decision history; optional e-signature re-authentication. Cloud, Data Center, Server.
- **What it does not advertise:** any measure of the gap between an authority record's
  last edit and the start of work that depends on it; any coverage / `unknown` semantics
  for missing evidence. Its unit is a *vote on a transition*, not a *diff between two dates*.
- **What Mandate does instead:** reads the approval record that already exists (a Jira issue
  with `MANDATE / approved / owner`, or a linked page), computes P2 as
  `lastEdit − workStart` plus absence of confirmation, and prints `unknown` with a named
  missing edge when the record has no readable date. No new vote, no workflow change.

## 2. Approval Path for Jira — Warsaw Dynamics

- Listing: https://marketplace.atlassian.com/apps/1220490/approval-path-for-jira
- Vendor page: https://app.approval-path.com/
- **What it does:** multi-step approval definitions with conditional routing (JQL, budget,
  fields); sequential / parallel steps; approve from Jira, JSM, Slack, email; delegation,
  reminders, escalation; dashboards, KPIs and audit trail; a Rovo agent that answers
  "what waits for my decision" and can approve / reject in chat (admin opt-in).
  Cloud Fortified.
- **What it does not advertise:** an audit of whether an *already-granted* mandate still
  authorises work in flight; three-valued evidence with refusal to score. Its Rovo surface
  manages the **approval queue**; its KPIs describe the approval process (rate, median time).
- **What Mandate does instead:** the Rovo agent and MCP tools restate the same deterministic
  six-row result the panel prints; no model sits in the scoring path; a missing scope becomes
  a named `unknown`, never a confident paragraph. The question is not "who must approve"
  but "does the old approval still cover this work".

## 3. SealDoc — Electronic Signatures & Audit Trails — be4 Software

- Listing: https://marketplace.atlassian.com/apps/2595855992/sealdoc-electronic-signatures-audit-trails
- **What it does:** two-component e-signatures (PIN + session verification, 21 CFR Part 11
  style), six signature meanings, content-hash integrity; append-only SHA-256 hash-chained
  audit log with HMAC sealing and gap detection; safety classification (ASIL / DAL /
  IEC 62304 risk class) with per-class approval quorums. Jira Cloud, works with Confluence.
- **What it does not advertise:** deriving staleness from artifacts teams already produce.
  Its unit is a *new signature event*; a hash chain proves the log was not tampered with —
  it does not prove the decision still matches the work. No coverage disclosure for
  evidence the app could not read.
- **What Mandate does instead:** zero new ritual beyond one re-confirm comment; the
  `mandate:dd-<8hex>` fingerprint is an idempotency key for that comment, not a compliance
  signature. Evidence is the record's server-side edit time, the work's start, and the
  absence of a later confirmation — all already in the tenant.

## Adjacent, not the same product

- **Seal Docs** (https://marketplace.atlassian.com/apps/1729892988/seal-docs) is Confluence
  document control (Draft → In review → Approved → Published, watermarked PDFs). It shares
  the word "Seal" and the Forge platform, but its unit is a *controlled document*, not a
  Jira work item's authority. Do not confuse the two listings.

## One-line positioning

Approval apps ask people to decide again. SealDoc proves a decision was recorded.
**Mandate measures whether the decision that already exists still covers the work
that depends on it — and says `unknown` when it cannot see enough to answer.**

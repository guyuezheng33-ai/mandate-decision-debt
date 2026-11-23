# Privacy Policy · Mandate (Decision Debt)

**Last updated:** 2026-11-24
**Public URL:** https://telegra.ph/Privacy-Policy--Mandate-11-23
**App:** Mandate — Decision Debt, a read-only Forge app for Atlassian Jira
**Developer contact:** guyuezheng33@gmail.com

## What this app does

Mandate shows an authority receipt on a Jira work item: who approved the work, where the approval
record lives, when it was approved, and whether that approval is still valid. Scoring is
deterministic and runs inside the Forge runtime. It does not summarise with an external model and
does not write to Jira.

## Data we access

Mandate requests the following scopes, and nothing else:

- `read:jira-work` — issue key, summary, status, assignee, description, issue links and remote
  links that Jira already exposes to the signed-in user.
- `read:graph:issue:jira` — issue relationships exposed through the Teamwork Graph.
- `read:graph:user:atlassian` — display identity of the people behind records and review traces.

The app **does not request a Confluence page scope**. If a Jira issue links to a Confluence page,
the app may see the link metadata that Jira exposes, but it does not read the page body, page author
or page edit date. It requests no team, storage or write scopes.

Access is always performed **as the signed-in user** (`asUser()`). The app never reads data on
behalf of another user, and never reads data the current user cannot already see in Jira.

## What we store

The published version persists **no content at all** — no app storage, no database, no files.
Issue descriptions, comments, names and computed scores are never written to a persistent store.
Scores are recalculated on every read.

## In-memory cache

Each Forge function instance keeps a short-lived in-memory cache of at most **60 seconds**; entries
are lost when the instance stops. Every cache key includes the acting user's account id, so an entry
created while one user was signed in is never served to another user. Nothing enters the cache when
a read failed or returned no known evidence. There is no cross-installation or cross-tenant cache.

## Third parties

Mandate does **not** call an external service, and does **not** send data to any third-party model,
analytics provider or telemetry endpoint. All scoring runs inside the Forge runtime. If an
installation chooses to use Atlassian Rovo, that interaction is governed by Atlassian privacy terms.

## Write access

The published version requests **no write scope**. It cannot create, edit, transition or delete any
Jira object. All remediation steps it suggests are performed by a human. Trace stamping is a gated
optional capability that exists only if an installing site explicitly grants `write:jira-work`; it is
disabled in the submitted build.

## Data retention and deletion

Mandate retains no content. Uninstalling the app removes any app state; there is no residual copy on
the developer side because none is stored. To ask about deletion of an optional comment stamp, contact
the address at the top of this document.

## Changes

Material changes to this policy will be reflected in this document's "Last updated" date and in the
app listing before the change ships.

## Contact

guyuezheng33@gmail.com

# 0037. An open tab takes over a closed tab's publish

- **Status:** Accepted
- **Date:** 2026-11-23
- **Scope:** `@seedprotocol/publish` (`PublishManager`, restore, `publishLocks`, `useItemPublishStatus`),
  `@seedprotocol/sdk` tab messages. Amends [ADR 0012](0012-tabs-coordinate-through-web-locks.md).

## Context

A publish runs in the tab that holds the Web Lock `seed:publish:<seedLocalId>`. Restore at page load
skips a row whose lock another tab holds. When that tab closes partway, the browser frees the lock,
but no open tab notices: the row stays `in_progress` and unrun, and `publishLockHolder` answers
`'none'`, until some tab of the app loads. Lock changes write no row, so a host that shows who runs a
publish (PermaPress's Running card and leave warning) has nothing telling it to read the holder
again.

## Decision

Every open tab queues a waiting lock request for each in-progress publish another tab runs. It finds
them at restore, and from a `publish-lock-taken` tab message, which a tab posts on the SDK's
coordination channel when it starts a publish or takes one over (`announcePublishLockTaken`,
`onPublishLockTaken`). When the lock is granted, the tab reads the seed's latest `publish_processes`
row: if it is still `in_progress`, the tab resumes it exactly as restore at load would, including
marking one that can't resume `interrupted`; otherwise it lets the lock go. Web Locks grant a freed
lock to the first queued request, so one tab takes the publish over. `stopAll` and page unload stop
waiting.

`onPublishLockHolderChange(listener)` calls back with a seed whose holder may have changed: this tab
took or let go of its lock, a lock it queued for was granted, or another tab announced it took one. It
carries no holder; `publishLockHolder` stays the one reader.

Takeover is automatic, with no option to turn it off.

## Consequences

A publish no longer waits for a reload after its tab closes, and `'none'` on an `in_progress` row is
brief. `useItemPublishStatus().heldBy` follows the lock.

A publish taken over that reaches attestation uses the taking tab's wallet (`getPublishWallet()`), as
a restore at load does. A wallet that asks the author to confirm each transaction asks in that tab,
which may be in the background. If a host needs control over this, add an option then.

With `multiTab: 'off'` there is no channel, so a tab takes over only publishes it found at load.
Without Web Locks (Bun, old browsers) every tab runs its own publishes and nothing is taken over.

A run parked in a tab that is still open keeps its lock there; another tab can't retry or take it
over.

## Alternatives considered

- **The host decides.** Tabs only report that the lock came free and the host calls a takeover
  function. Rejected for the extra host code; the wallet prompt was the reason to consider it.
- **Polling** `navigator.locks.query()` or the `publish_processes` table on a timer to find orphaned
  publishes. Rejected: it wakes every tab, and the lock queue already says when a holder lets go.
- **Only the leader tab takes over.** Rejected: it adds a leader change to the wait, and with
  `multiTab: 'off'` every tab leads anyway.

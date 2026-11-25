# 0038. An open tab takes over a closed tab's publish

- **Status:** Accepted
- **Date:** 2026-11-23, amended 2026-11-25 (the taking tab's wallet)
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
which may be in the background. If a host needs control over this, add an option then. A tab takes a
publish only with the wallet it runs as (see the amendment below).

`stopAll` (wallet disconnect, `endPublishSession`) lets the tab's locks go and leaves its rows
`in_progress`, so another open tab takes those publishes over while the first tab is still open. It
also drops the tab's waits; since the amendment, the next change of the tab's wallet queues it again.
`stopPublish` marks the row `interrupted` before it lets the lock go, and a Publish in the same tab
waits while a stop or a takeover decides on the seed's lock.

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

## Amendment, 2026-11-25: the taking tab's wallet

A resumed publish attests as the address its row recorded (`context.address`) with the resuming tab's
registered wallet. Once external wallets let an author switch accounts in one tab, a takeover by a tab
on another account, or with its in-app session ended, would attest under the wrong account; so would
a reload with another account.

A tab now resumes a row, at a takeover or at load, only when its publish wallet publishes as that
address: the wallet's `publisherAddress`, else its sender's address, else its signer's, compared
without letter case. This is the address `ensureWalletThenPublish` would publish as. Otherwise the
tab leaves the row `in_progress`, lets the lock go (Web Locks hand it to the next queued tab), and
notes the seed with the address it waits for. When the address the registered wallet publishes as
changes to that one, the tab queues for the lock again and decides afresh on the grant, so a tab that
later connects the right account takes the publish over, and a reload resumes its publishes once its
wallet reconnects. A row with no address resumes as before: no wallet can attest it. A row that can't
resume (mid bundler upload) is still marked `interrupted` whatever the wallet, since that is the same
in every tab.

`stopAll` drops a tab's waits for other tabs' locks, and hosts call it when the account changes, just
before registering the new account. So the publishes it stops, and the waits it drops, are noted
too, and the next change of the wallet's address queues the tab again. Each still resumes only with
the matching wallet.

The interleavings this covers: the wallet is read with no await between the check and starting the
run, so a change during the row read counts; the seed is noted before the lock goes, so a listener
told of the release can switch the wallet and queue at once; and a wait marks itself granted when the
lock comes, so a queue request made while the released takeover is still settling isn't dropped.

Consequences: `'none'` on an `in_progress` row now also means no open tab holds the right wallet, and
it lasts until one does; a host can read the row's `context.address` to say which account to
connect. A page reloaded before its wallet reconnects shows `'none'` until it does. A host that
restored at load and passed a wallet only to `retryAttestations` must register the wallet instead.

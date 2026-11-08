# 0030. Attestation sends are journaled, and UserOps pin their nonce

- **Status:** Accepted
- **Date:** 2026-10-31
- **Scope:** `@seedprotocol/publish`, `packages/sdk/src/db/write/publishAttempts.ts`

## Context

A publish could attest twice. Nothing recorded a send, so a retry after a lost receipt, a restore
after a crash and a new run all reached `sendTransaction` with no way to know an earlier transaction
existed. A second property attestation costs gas and sync dedupes it. A second Seed is worse: it has
a new uid, so the unique uid indexes don't catch it, and the item's properties sit on the first one.
Attestations can be revoked where the schema allows it, but the record stays on chain.

Saving the hash after the send doesn't close this on UserOp routes. Thirdweb's `_sendUserOp`,
`sendUserOpWithHeadroom` and `createPermissionlessTxSender` wait for inclusion inside the send, so
no hash exists during the risky window, and a timeout throws while the UserOp can still land.

A chain lookup can't settle it either. Seed attestations carry the same data, so one from another
publish by the same attester looks identical.

## Decision

Every attestation transaction goes through `sendAttested`, which commits a `publish_attempts` row
before sending. The check for an open attempt and the insert are one database transaction. If the
row can't be written, the send doesn't happen, so a host with no database can't publish attestations.

**The gate is keyed by seed.** An attempt lists every seed in its requests. While an attempt is open
(`sending`, `sent` or `landed`), a send covering any of those seeds fails with
`AttestationAttemptOpenError`, whichever run, retry or restore reached it. The check sits at the send
rather than on the retry and restore transitions, because a new run bypasses both.

**The row stores the requests**, not a hash of them. Attribution needs `_metadataLocalId` and the slot
order, and the author may edit the item before a retry, so a rebuilt payload can't be trusted to match
what was sent.

**Only evidence closes an attempt.** `recorded` needs a receipt, `reverted` needs a revert, and
`notSent` needs an error that proves nothing went out. A timeout leaves the attempt open. So does a
used-nonce error on a pinned send and any failure of a resend, since the first send may have landed.
`abandoned` is the host's choice, through `PublishManager.resolveAttestationAttempt`.

**Recording is one database transaction and is repeatable.** `recordPublishRequests` writes a
transaction's seed, version and property uids and ends its attempt together. A failed record fails the
publish, and the next retry records from the stored requests without sending.

**UserOps pin their nonce.** The EntryPoint nonce key is a 192-bit hash of the attempt id, at sequence
0, so that UserOp can land once. A host whose tries don't share a database or an item passes its own id
as `CreatePublishOptions.nonceKey`, and the key is a hash of that instead (added 2026-11-02). Reconcile reads the sequence from EntryPoint: 1 means find the
`UserOperationEvent` from `fromBlock` and record it, and 0 means resend under the same key. Only the run
that sent it can resend, since a key is tied to the stored requests. A sender declares this
with `SeedTxSender.pinsNonceOn` and must then honour `SeedTxRequest.nonceKey`. Thirdweb's hook is per
wallet, so `getManagedAccountWallet` always overrides `getAccountNonce` and reads a per-account slot
set around the send.

**Retry and restore go through `reconcilingAttestations`** before anything can send. It records a
landed transaction, closes a reverted one, resends a pinned attempt that hasn't landed, and otherwise
stops at `attestationOutcomeUnknown`. Restoring a snapshot saved mid-attestation parks it and sends
`retry`, rather than re-running the attestation actor on the input saved with it.

## Consequences

- At most one attempt per seed is open, so one stuck attempt blocks publishing that seed and every
  other seed in its requests until it settles.
- Hosts have to show `attestationOutcomeUnknown`. Routes that don't pin reach it with no saved hash or
  no receipt, and pinned routes reach it when the chain can't be read or a new run meets another run's
  unlanded UserOp. A tab closed during a wallet prompt
  lands there too, even if the author never signed, because the attempt was committed before the
  prompt.
- `resolveAttestationAttempt(seedLocalId, { resend: true })` can attest twice. It is public because an
  author with a stuck publish needs a way out, and `retryAttestations` stays safe to press.
- `publish_attempts` keeps closed rows. Only `removeLocalCopiesForAddresses` deletes any.
- Pinned sends were run against a local fork with a real bundler. Sponsored UserOps through a
  paymaster, the EIP-7702 sender and the full crash path have not been run on a chain.

## Alternatives considered

- **Hash the requests instead of storing them.** Detects a change but can't record a landed transaction
  after the item was edited.
- **Find earlier attestations on chain by attester.** Can't tell a Seed from this attempt from another
  publish's Seed.
- **Dedupe in the contract.** The contracts are deployed, and the pinned nonce gives the same guarantee
  on the routes that have the long window.
- **Pin EOA nonces.** The hash returns at broadcast, so the window is small, and browser wallets choose
  their own nonce.
- **Build UserOps per call for thirdweb** with `createAndSignUserOp` and `bundleUserOp`. Kept in reserve;
  the nonce slot passed against a real bundler and leaves thirdweb's send path in place.

## Addendum, 2026-11-08: settling with no run, and giving up

**An attempt can be settled with no run.** `PublishManager.settleAttestationAttempt` runs the same
chain reads as `reconcilingAttestations`, with no run id, so it records every landed transaction it
finds and never sends: a pinned attempt that hasn't landed stays open as `pinnedNotLanded`, because
only its own run has the requests to send under that key. It refuses while a publish of the seed runs
or waits in this tab, or another tab holds the seed's lock, since that run settles on its own retry and
two settles could record one receipt twice. Without the run-less settle, a host whose run was gone
after a reload could only give the attempt up blind.

**`giveUp` ends a waiting run only once no attempt is open.** The run reads the seed's open attempts
first and goes back to the state it came from if one is open. A run ended while one of its sends may
still land would leave that attestation unrecorded, and the next publish of the seed would still be
refused by the open attempt.

**No error ends a run on its own.** Several errors repeat on every retry until something outside the
publish changes, and `isRepeatingAttestationError` names them, but most of them clear once the author
acts: deploying the account (`MANAGED_ACCOUNT_NOT_DEPLOYED`), installing the module
(`EXECUTOR_MODULE_NOT_INSTALLED`), or funding a paymaster or account (`USEROP_REVERTED`). Moving those to
`failure` would make the author start a new publish, which uploads to Arweave again, so the host
decides when to give up.

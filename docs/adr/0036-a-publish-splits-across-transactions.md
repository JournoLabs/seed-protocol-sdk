# 0036. A publish too large for one transaction goes out in several, and a new publish replaces a parked one

- **Status:** Accepted
- **Date:** 2026-11-18
- **Scope:** `@seedprotocol/publish` (`createAttestations`, `checking`, reconcile, `PublishManager.createPublish`,
  `startPublish`), `@seedprotocol/sdk` publish payload. Amends [ADR 0030](0030-attestation-sends-are-journaled.md).

## Context

A publish through the Seed contract sends the whole graph in one `multiPublish`. The contract creates
every Seed and Version first, then writes each new Seed uid into the slots that reference it
(`propertiesToUpdate`, filled by index in `encodeMultiPublish`), then attests the properties. One
transaction therefore links references in any direction, including back references
(`backReferences: 'link'`).

A graph can need more gas than one transaction may use. PermaPress hit it on a portfolio edit: about
12.42M gas estimated, 16.15M with the 30% headroom `publishGasLimit` adds, against `PUBLISH_MAX_GAS`
of 16M. The publish failed with `PUBLISH_TOO_LARGE`, and each retry failed the same way. Since
`8308dcfc` the refusal comes before uploads (`checking` sizes the payload with a 43-character
placeholder per upload), but the publish still can't go out. PermaPress works around it by
publishing draft children as separate runs, children first. Siblings can't share a run, so a Post
with 16 draft authors costs about 17 transactions.

Two facts make a split cheap:

- `getPublishPayload` orders requests referenced-first (`orderPayloadByDependencies`), and the root
  comes last. A cut of that order into contiguous parts leaves every reference between parts
  pointing at an earlier part. Only a cycle can't be cut.
- A Seed recorded by an earlier transaction is a published Seed. `getPublishGraph` references a
  published target by its uid and doesn't walk into it, so a payload rebuilt after part 1 is
  recorded holds only what is left, with part 1's uids already in its relation slots.

The second problem is what happens after a failure. A `creatingAttestations` error parks the run in
`attestationFailureRecoverable`. `createPublish` refuses a seed that has a run in `publishProcesses`,
so the author's next **Publish** returns `already_publishing`. The way out is `stopPublish` (or
`giveUpPublish` since ADR 0030's addendum), and the next run uploads everything again: uploads live
only in the parked run's context. With several transactions per publish, failing partway becomes
more likely, so this has to work.

PermaPress's change request `seed-split-large-publishes.md` (2026-11-06) asks for both (asks 1, 2
and 4). Its ask 5, one item over the limit on its own, isn't reachable on today's schemas and isn't
designed for here.

## Decision

### Splitting is automatic

A publish through the Seed contract whose graph doesn't fit in one transaction is sent as several
`multiPublish` transactions, in one run. There is no option to turn it on or off. `PUBLISH_TOO_LARGE`
remains for a graph with any unit (below) that doesn't fit on its own. Direct EAS is unchanged: it
already sends one transaction per Seed.

### Units and parts

A **unit** is one request, or every request in one cycle of references (a strongly connected
component over the same edges `orderPayloadByDependencies` uses). A unit is never split. A **part**
is a run of consecutive units in the dependency order, sent as one `multiPublish`.

### Each part is cut from a rebuilt payload

`createAttestations` loops:

1. Build the payload with `getPublishPayload` from the rows and the run's uploads, as today.
2. Cut the longest prefix of units that fits (below). Drop each `propertiesToUpdate` entry whose
   target isn't in the prefix: that target is a later part, and its rebuilt payload will hold the
   source's recorded uid.
3. Send the prefix through `sendAttested`, wait for the receipt, record it.
4. Stop when the part that held the root has been recorded. Otherwise go back to 1.

The loop keeps no plan between parts. A retry, a restore or a new run (below) rebuilds the payload
and gets only what is left, so all three continue a split publish the same way. An edit the author
saves between parts to an item no part has sent yet goes out with that item. An edit to an item an
earlier part published waits for that item's own publish: `getPublishGraph` doesn't walk into a
published target, so the rebuilt payload doesn't hold it.

### Fitting a part

`localPublishGas` is a lower bound, so it only rules a prefix out: the cut starts at the longest
prefix the local estimate and the calldata limit allow. That prefix is then estimated over RPC
(`estimateGas` from the sending account, the same call `publishGasLimit` makes) with the 30%
headroom, and shortened one unit at a time, by bisection, until the estimate is under
`min(maxPublishGas, block gas limit)`. When the RPC estimate can't be made, the part is sent with
`publishGasLimit`'s fallback gas, as a single transaction is today.

`checking` keeps its check before uploads, now on every unit: a graph refuses there when any unit
alone is over the local estimate or the calldata limit. `checking` also reports how
many parts the local estimate expects, so a host can say so before the author pays for uploads. That
count is a lower bound; the RPC estimates can raise it.

### Journaling: one attempt per part

Each part is its own `sendAttested` call, so it gets its own `publish_attempts` row, its own
requests, and its own pinned nonce key from its attempt id. ADR 0030's gate needs no change: every
attempt lists the root's `seedLocalId`, and a part's attempt is recorded (closed) before the next
part claims one.

`reconcileAttestations` keeps its outcomes. On `record`, `createAttestations` records the landed
part and then goes on with the loop instead of returning; it returns only once the root's part is
recorded. A restore, a retry after a failed record and a retry after a revert all land in that loop.

`unrecordedAttestation` names one part, as it named the one transaction before. `publishedBatch` and
`easPayload` hold the parts the finishing `createAttestations` call recorded; a call that went on from
parts recorded earlier (a retry, a restore, a replacing run) leaves those out. Each part clears its
seeds' co-publish rows as it records. `onPublished` fires once, after the root's part.

### A host's nonce key covers every part

`CreatePublishOptions.nonceKey` pins one UserOp today, so part 2 would be refused as
`NONCE_KEY_SPENT`. Part 1 keeps the key the host gave. Part *k* > 1 uses the key derived from the
host's key and *k*. `findPublishByNonceKey` reads parts 1, 2, … until a key with sequence 0 and
reports every part it finds.

How many parts went out under the key is read from the recorded `publish_attempts` rows whose
`nonce_key` is `publishNonceKey(key, 1)`, `(key, 2)` and so on, whichever run sent them
(`findPublishAttemptsByNonceKey`), not from a run's saved state. The snapshot is saved when the
machine moves on, so a tab that reloads between parts would restore a count that misses the last
part and send under its spent key. A part under the key that was sent and not settled (`sending`,
`sent` or `landed`) stops the try with `AttestationOutcomeUnknownError` until reconcile settles it,
since it may have landed.

A split publish under a host key finishes only from the database that started it. When part *k*'s
key is spent and no row of this database explains it, `NONCE_KEY_SPENT` says the publish is partly
on chain and points to `findPublishByNonceKey`'s `parts`. Recovering the parts from the chain on
another database isn't done: the rebuilt payload would re-attest part 1's content whenever the
local rows don't hold its uids.

### A new publish replaces a parked run and reuses its uploads

`createPublish` for a seed whose run in this tab is parked (`attestationFailureRecoverable` or
`attestationFailureRecoverableDirectToEas`) and that has no open attempt stops that run and starts a
new one. The parked run's row is marked `interrupted`, as `stopPublish` does. The new run takes the
parked run's uploads: an upload is reused when its `itemPropertyLocalId` and content hash match an
upload the new run needs, and the blob store still reports it stored. Anything else uploads again,
so an edit to a file property after the failure isn't attested with the old file. The new run also
takes the parked run's `nonceKey`, unless the host passes its own. The parts sent under that key are
read from the recorded attempts, so its next part sends under the next part's key. A different key, or none, starts at part 1, so
`findPublishByNonceKey` finds the new key's parts from its first.

`createPublish` checks again that the run is parked when it replaces it: a retry that started in
between keeps its run, and the Publish returns `already_publishing`. A Publish sent while restore is
running waits for restore, so a parked run restore brings back is replaced like any other.

A seed with an open attempt, in any state, gets a new outcome, `attempt_open`, from `startPublish`,
and nothing starts. The host settles the attempt (`retryAttestations`,
`settleAttestationAttempt`, `resolveAttestationAttempt`) first. A run in any other state still
returns `already_publishing`.

This doesn't adopt another run's stranded pinned attempt (the "takeover" left open on 2026-11-08):
the replacing run is refused while that attempt is open, as every run is. Nor does it reach a parked
run held by another tab; that stays with `publishLockHolder` step 2.

## Consequences

- A large publish stops being all or nothing. When part 2 fails, part 1's Seeds are published and
  the root isn't. A reader sees published children with no parent until the run finishes. That
  state is valid on chain, and it's what PermaPress's workaround produces today.
- PermaPress's Post with 16 draft authors goes out in as many parts as gas requires instead of about
  17: two for the portfolio PermaPress reported (12.42M estimated against about 12.3M usable per part). PermaPress deletes its planner (`publishPlan.ts`), the
  planning branch in `runPublish.ts`, and `tooLargeItemMessage`.
- `PUBLISH_TOO_LARGE` now means one item, or one cycle, is too large. Its message stops advising
  "publish some of its related drafts on their own first".
- Each part pays the per-transaction base cost and, on UserOp routes, its own UserOp overhead and
  wallet prompt. A browser wallet that prompts per transaction prompts per part.
- A cut costs a few more `estimateGas` calls before each part; bisection keeps it to about
  log2(units) per part.
- **Breaking:** `startPublish` gains `attempt_open`, and `already_publishing` no longer covers a
  parked run with no open attempt. Hosts that called `stopPublish` to get past a parked run can drop
  that call. PermaPress needs a heads-up.
- A host nonce key now names a sequence of keys. A host that reads the EntryPoint directly by its own
  key sees only part 1.
- A cycle too large for one transaction is refused rather than split; deferring its back reference
  into a later part is possible later and isn't built now.

## Alternatives considered

- **Opt-in splitting** (`CreatePublishOptions.splitTransactions`). Keeps all-or-nothing for hosts that
  need it, but PermaPress is the only host and wants the split; a flag it always sets adds a path to
  test for no user.
- **Plan every part up front and fill cross-part references from earlier receipts.** What the
  request describes. It needs a stored plan in the snapshot, code to write uids into slots, and a
  different path for restore and new runs. Rebuilding the payload after each record gets the same
  result from code that exists.
- **Pack units into parts out of order** (bin packing over the dependency DAG). Could save a part in
  some graphs, but a part may then reference a later one, which needs the uid-filling above.
- **A patch transaction for back references** across parts, or `backReferences: 'defer'` for them.
  Cycles in PermaPress's graphs are small; refusing an oversized cycle is enough until one shows up.
- **`startPublish` on a parked seed sends `retry`.** Smallest change, but the run keeps the uploads
  it started with, so a file edited after the failure would be attested with its old content.
- **`stopPublish(seedLocalId, { keepUploads: true })`.** The same reuse as the decision, through two
  calls, with the SDK holding uploads between runs that no longer exist.

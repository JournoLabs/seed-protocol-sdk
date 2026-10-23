/**
 * The item write outbox (ADR 0019). An edit is appended as an op to `pending_writes`; the leader
 * tab drains the table, applying each op with its kind's applier and marking it applied in one
 * transaction.
 *
 * Ops apply in append order (the row id) per item property. A property's run of consecutive
 * value ops (`set`, `storage`) is coalesced: only the newest is applied and the older ones are
 * marked superseded in the same transaction.
 *
 * This module knows nothing about items: appliers are registered per op kind
 * (registerOutboxApplier).
 */
import debug from 'debug'
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { pendingWrites, type PendingWriteType } from '@/seedSchema/PendingWriteSchema'
import { generateId } from '@/helpers/generateId'
import { TAB_ID, isLeaderTab, onTabMessage, postTabMessage, whenLeaderTab } from '@/helpers/tabCoordinator'
import { isSqliteBusyError } from '@/browser/db/sqliteBusyRetry'

const logger = debug('seedSdk:outbox')

export type OutboxOpKind = 'create' | 'set' | 'delete' | 'storage'
export type OutboxOpStatus = 'pending' | 'applied' | 'superseded' | 'failed'
export type OutboxOp = PendingWriteType

export type AppendOutboxOpInput = {
  seedLocalId: string
  /** Null for ops on the seed itself. */
  propertyName?: string | null
  kind: OutboxOpKind
  /** Stored as JSON. */
  value?: unknown
  /** The stored metadata row the edit was made against. */
  baseRowId?: string | null
  /** A staged file holding the op's content (a storage value's bytes), written by the appending tab. */
  valueRef?: string | null
}

/** Applies ops of one kind. Registered by the code that defines the kind. */
export type OutboxApplier<Prepared = unknown> = {
  /**
   * Runs before the transaction, for lookups that may call EAS or the app. Must not write to the
   * database. It may write a file that only this op uses (a storage value's file, named after its
   * new seed); `discard` deletes it if the op never applies.
   */
  prepare?: (op: OutboxOp) => Promise<Prepared>
  /**
   * Writes the op on `tx`, inside the transaction that marks it applied. Must read and write only
   * through `tx` (see BaseDb.transaction). Errors fail the op, except busy database or file errors,
   * which are retried. What it returns is stored as the op's `result`
   * (JSON).
   */
  apply: (op: OutboxOp, tx: ReturnType<typeof BaseDb.getAppDb>, prepared: Prepared) => Promise<unknown>
  /**
   * Wraps the op's transaction, for locks that must be taken before it: an ItemStorage file's
   * lock, whose other writers take it before touching the database. Calls `run` once, or throws
   * OutboxOpDeferredError without calling it when the lock is held, so the drainer isn't kept
   * waiting while other ops could apply.
   */
  around?: <T>(op: OutboxOp, run: () => Promise<T>) => Promise<T>
  /**
   * Runs after the op's transaction committed, before its waiters hear: deleting its staged file,
   * say. Errors are logged and ignored.
   */
  afterApply?: (op: OutboxOp, prepared: Prepared) => Promise<void>
  /**
   * Cleans up after an op that will never apply (superseded or failed): a file written for it,
   * say. `prepared` is what `prepare` returned when the op failed after it; undefined for a
   * superseded op, which is never prepared. Runs after the op is settled; errors are logged and
   * ignored.
   */
  discard?: (op: OutboxOp, prepared: Prepared | undefined) => Promise<void>
}

/** File-system errors that pass (another tab or the OS holding the file). */
const RETRYABLE_ERROR_NAMES = new Set(['NoModificationAllowedError', 'NotReadableError', 'InvalidStateError'])

/**
 * Whether an op that failed with `error` may apply later: the database was busy (BaseDb.transaction
 * has already retried for about a second) or a file was busy. Anything else (a broken rule, a
 * missing row, a bug) would fail the same way again.
 */
const isRetryable = (error: unknown): boolean =>
  isSqliteBusyError(error) ||
  (error instanceof Error && RETRYABLE_ERROR_NAMES.has(error.name))

/**
 * An op that can't apply yet for a reason that will pass without counting as a failure: an applier's
 * `around` found a lock held. The drainer sets the op (and its property's queue) aside for
 * OUTBOX_DEFER_MS and goes on with other ops; its attempts aren't counted.
 */
export class OutboxOpDeferredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboxOpDeferredError'
  }
}

/** How long a deferred op waits before the drainer tries it again. */
export const OUTBOX_DEFER_MS = 50

/** An op that can never apply (a broken rule, an item the client doesn't own). Not retried. */
export class OutboxOpRejectedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OutboxOpRejectedError'
  }
}

/** Rejects `waitForOutboxOp` for an op that failed, or that a failed op superseded. */
export class OutboxOpFailedError extends Error {
  readonly code = 'OUTBOX_OP_FAILED'
  constructor(
    readonly opId: string,
    message: string,
    /** The name of the error that failed the op, when it was recorded. */
    readonly errorName: string | null = null,
  ) {
    super(message)
    this.name = 'OutboxOpFailedError'
  }
}

/** Waits before each retry of an op that failed with a retryable error; the last is reused. */
export const OUTBOX_RETRY_DELAYS_MS = [50, 200, 800, 2_000, 5_000]
/** Attempts before a retryable error fails the op. */
export const OUTBOX_MAX_ATTEMPTS = 8
/** How often a waiter re-reads its op, in case a settled message from another tab is missed. */
const WAIT_POLL_MS = 1_000
/** Ops read per drain pass. */
const DRAIN_BATCH = 200
/** Applied and superseded ops are kept this long, then pruned. */
export const OUTBOX_PRUNE_AFTER_MS = 24 * 60 * 60 * 1000
/** Failed ops are kept longer, so a refused write can still be looked into. */
export const OUTBOX_PRUNE_FAILED_AFTER_MS = 7 * 24 * 60 * 60 * 1000
/** How often the leader prunes, at most. */
const PRUNE_EVERY_MS = 60 * 60 * 1000

const appliers = new Map<string, OutboxApplier<any>>()

/** Registers the applier for one op kind; returns a function that removes it. */
export function registerOutboxApplier<Prepared>(kind: OutboxOpKind, applier: OutboxApplier<Prepared>): () => void {
  appliers.set(kind, applier)
  return () => {
    if (appliers.get(kind) === applier) appliers.delete(kind)
  }
}

/** Bumped before every append in this tab, so a pending-value read begun earlier isn't reused after it. */
let appendGeneration = 0

/** How many appends this tab has started; see getPendingSetValue. */
export const outboxAppendGeneration = (): number => appendGeneration

/** Appends one op and tells the leader to drain. Returns the op id. */
export async function appendOutboxOp(input: AppendOutboxOpInput): Promise<string> {
  const row = {
    opId: generateId(),
    seedLocalId: input.seedLocalId,
    propertyName: input.propertyName ?? null,
    kind: input.kind,
    value: input.value === undefined ? null : JSON.stringify(input.value),
    baseRowId: input.baseRowId ?? null,
    valueRef: input.valueRef ?? null,
    createdAt: Date.now(),
    tabId: TAB_ID,
    status: 'pending' as OutboxOpStatus,
    attempts: 0,
  }
  appendGeneration += 1
  await BaseDb.getAppDb().insert(pendingWrites).values(row)
  startOutbox()
  if (isLeaderTab()) scheduleDrain()
  else postTabMessage({ type: 'outbox-nudge' })
  return row.opId
}

/**
 * Appends one op and waits until it settles: its applier's result once applied, or `superseded`
 * when a newer op of its property replaced it. Rejects with OutboxOpFailedError when it fails.
 */
export async function appendOutboxOpAndWait<Result = unknown>(
  input: AppendOutboxOpInput,
): Promise<{ superseded: false; result: Result | undefined } | { superseded: true }> {
  const opId = await appendOutboxOp(input)
  await waitForOutboxOp(opId)
  const [op] = await getOutboxOps([opId])
  if (op?.status !== 'applied') return { superseded: true }
  return { superseded: false, result: outboxOpResult<Result>(op) }
}

/** An op's stored value, decoded. */
export function outboxOpValue<T = unknown>(op: Pick<OutboxOp, 'value'>): T | undefined {
  return op.value == null ? undefined : (JSON.parse(op.value) as T)
}

/** What an applied op's applier returned, decoded. */
export function outboxOpResult<T = unknown>(op: Pick<OutboxOp, 'result'>): T | undefined {
  return op.result == null ? undefined : (JSON.parse(op.result) as T)
}

// --- Draining ---------------------------------------------------------------------------------

let started = false
let paused = false
/** Set by stopOutbox (client.stop) until the next startOutbox. */
let stopped = false
let stopTabMessages: (() => void) | undefined
let draining: Promise<void> | undefined
let drainAgain = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
/** When each op that failed with a retryable error may be tried again. In memory: leader only. */
const notBefore = new Map<string, number>()

/**
 * Starts draining in this tab once it is the leader, resuming ops left pending (a reload, a closed
 * leader tab), and listens for other tabs' nudges and settled ops. Safe to call more than once.
 */
export function startOutbox(): void {
  if (started) return
  started = true
  stopped = false
  stopTabMessages = onTabMessage((message) => {
    if (message.type === 'outbox-nudge' && isLeaderTab()) scheduleDrain()
    if (message.type === 'outbox-settled') void recheckWaiters(message.opIds)
  })
  void whenLeaderTab().then(() => scheduleDrain())
}

/** Drains soon in this tab (if it leads); calls made while a drain runs make it run once more. */
function scheduleDrain(): void {
  if (paused || stopped || !isLeaderTab()) return
  if (draining) {
    drainAgain = true
    return
  }
  draining = (async () => {
    try {
      do {
        drainAgain = false
        await drainOutbox()
      } while (drainAgain && !paused && !stopped)
    } catch (error) {
      logger('drain failed', error)
    } finally {
      draining = undefined
    }
    if (Date.now() - lastPrunedAt >= PRUNE_EVERY_MS) {
      lastPrunedAt = Date.now()
      pruneOutbox().catch((error) => logger('prune failed', error))
    }
  })()
}

let lastPrunedAt = 0

/**
 * Deletes settled ops older than their retention: applied and superseded ops after
 * OUTBOX_PRUNE_AFTER_MS, failed ones after OUTBOX_PRUNE_FAILED_AFTER_MS. An applied op with an
 * unresolved conflict stays until the conflict is resolved. Pending ops are never pruned. The
 * leader runs it after a drain, at most hourly. Returns how many ops it deleted.
 */
export async function pruneOutbox(now = Date.now()): Promise<number> {
  const db = BaseDb.getAppDb()
  if (!db) return 0
  const settledBefore = now - OUTBOX_PRUNE_AFTER_MS
  const deleted = await db
    .delete(pendingWrites)
    .where(
      or(
        and(
          eq(pendingWrites.status, 'applied'),
          lt(sql`coalesce(${pendingWrites.appliedAt}, ${pendingWrites.createdAt})`, settledBefore),
          or(isNull(pendingWrites.conflict), isNotNull(pendingWrites.conflictResolvedAt)),
        ),
        and(eq(pendingWrites.status, 'superseded'), lt(pendingWrites.createdAt, settledBefore)),
        and(eq(pendingWrites.status, 'failed'), lt(pendingWrites.createdAt, now - OUTBOX_PRUNE_FAILED_AFTER_MS)),
      ),
    )
    .returning({ opId: pendingWrites.opId })
  if (deleted.length > 0) logger(`pruned ${deleted.length} settled ops`)
  return deleted.length
}

/**
 * Applies every pending op that is due, in order. Exported for tests and for code that must see
 * the outbox applied before it continues; normally the leader drains on its own.
 */
export async function drainOutbox(): Promise<void> {
  for (;;) {
    const pending: OutboxOp[] = await BaseDb.getAppDb()
      .select()
      .from(pendingWrites)
      .where(eq(pendingWrites.status, 'pending'))
      .orderBy(asc(pendingWrites.id))
      .limit(DRAIN_BATCH)
    const units = planUnits(pending)
    // Nothing left, or all of it waiting for a retry
    if (units.length === 0) {
      scheduleRetry()
      return
    }
    for (const unit of units) await applyUnit(unit)
  }
}

/** One op, or the newest of a property's run of sets (the older ones are settled with it). */
type Unit = { op: OutboxOp; superseded: OutboxOp[] }

/** Kinds that replace a property's value: a run of them applies only its newest. */
const VALUE_KINDS = new Set<string>(['set', 'storage'])

const keyOf = (op: OutboxOp) => `${op.seedLocalId}\u0000${op.propertyName ?? ''}`
const isDue = (op: OutboxOp) => (notBefore.get(op.opId) ?? 0) <= Date.now()

/**
 * The units to apply now, oldest first. A property's ops apply in order, so its queue waits
 * behind its oldest pending op, including one waiting for a retry. A run of value ops is one unit
 * that applies its newest op, so it waits for that op only: an older one set aside (its staged
 * value still being written, say) is superseded with the run. An op on the seed itself (no
 * property: create, delete) is ordered against all of its seed's ops: it waits for every earlier
 * one, and every later one waits for it.
 */
function planUnits(pending: OutboxOp[]): Unit[] {
  const queues = new Map<string, OutboxOp[]>()
  for (const op of pending) {
    const queue = queues.get(keyOf(op)) ?? []
    queue.push(op)
    queues.set(keyOf(op), queue)
  }
  // Seed-level ordering: an earlier op of the seed this op must wait for
  const blockedBySeed = (op: OutboxOp) =>
    pending.some(
      (earlier) =>
        earlier.id < op.id &&
        earlier.seedLocalId === op.seedLocalId &&
        (earlier.propertyName == null || op.propertyName == null),
    )
  const units: Array<{ unit: Unit; order: number }> = []
  for (const queue of queues.values()) {
    const head = queue[0]
    if (blockedBySeed(head)) continue
    let end = 0
    if (VALUE_KINDS.has(head.kind)) {
      // Not across a later seed-level op: the run stops before it
      while (
        end + 1 < queue.length &&
        VALUE_KINDS.has(queue[end + 1].kind) &&
        !blockedBySeed(queue[end + 1])
      ) {
        end++
      }
    }
    if (!isDue(queue[end])) continue
    units.push({ unit: { op: queue[end], superseded: queue.slice(0, end) }, order: head.id })
  }
  return units.sort((a, b) => a.order - b.order).map(({ unit }) => unit)
}

/** The transaction found an op no longer pending: another drainer applied it. */
class ClaimLostError extends Error {}

async function applyUnit(unit: Unit): Promise<void> {
  const ops: OutboxOp[] = [unit.op]
  const superseded = unit.superseded
  const ids = ops.map((op) => op.opId)
  const supersededIds = superseded.map((op) => op.opId)
  const prepared: unknown[] = []
  try {
    for (const op of ops) prepared.push(await applierFor(op).prepare?.(op))

    const transaction = () => BaseDb.transaction(async (tx) => {
      // Claim: an op another drainer applied meanwhile is no longer pending. The claimed rows are
      // what is applied: a writer may have changed an op's value since it was read
      // (claimUnpublishedDrafts stamps pending creates in its own transaction).
      const claimed: OutboxOp[] = await tx
        .update(pendingWrites)
        .set({ status: 'applied', appliedAt: Date.now() })
        .where(and(inArray(pendingWrites.opId, ids), eq(pendingWrites.status, 'pending')))
        .returning()
      if (claimed.length !== ids.length) throw new ClaimLostError()
      const current = new Map(claimed.map((row) => [row.opId, row]))
      for (const [index, read] of ops.entries()) {
        const op = current.get(read.opId) ?? read
        const result = await applierFor(op).apply(op, tx, prepared[index])
        if (result !== undefined) {
          await tx
            .update(pendingWrites)
            .set({ result: JSON.stringify(result) })
            .where(eq(pendingWrites.opId, op.opId))
        }
      }
      if (supersededIds.length > 0) {
        await tx
          .update(pendingWrites)
          .set({ status: 'superseded' })
          .where(and(inArray(pendingWrites.opId, supersededIds), eq(pendingWrites.status, 'pending')))
      }
    })
    // Each op's `around` (a lock) wraps the transaction, the first op's outermost
    const wrapped = ops.reduceRight<() => Promise<unknown>>((inner, op) => {
      const around = applierFor(op).around
      return around ? () => around(op, inner) : inner
    }, transaction)
    await wrapped()
    for (const [index, op] of ops.entries()) {
      await applierFor(op)
        .afterApply?.(op, prepared[index])
        .catch((error) => logger(`after applying op ${op.opId}`, error))
    }
    for (const id of [...ids, ...supersededIds]) notBefore.delete(id)
    settle([...ids, ...supersededIds])
    discardAll(superseded)
  } catch (error) {
    if (error instanceof ClaimLostError) return
    if (error instanceof OutboxOpDeferredError) {
      logger(`op ${ids.join(', ')} deferred: ${error.message}`)
      for (const id of ids) notBefore.set(id, Date.now() + OUTBOX_DEFER_MS)
      scheduleRetry()
      return
    }
    await recordFailure(ops, superseded, error, prepared)
  }
}

function applierFor(op: OutboxOp): OutboxApplier<unknown> {
  const applier = appliers.get(op.kind)
  if (!applier) throw new OutboxOpRejectedError(`No outbox applier for op kind "${op.kind}"`)
  return applier
}

async function recordFailure(
  ops: OutboxOp[],
  superseded: OutboxOp[],
  error: unknown,
  prepared: unknown[],
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const errorName = error instanceof Error ? error.name : null
  const attempts = Math.max(...ops.map((op) => op.attempts)) + 1
  const permanent = !isRetryable(error) || attempts >= OUTBOX_MAX_ATTEMPTS
  const ids = ops.map((op) => op.opId)
  const db = BaseDb.getAppDb()
  if (!permanent) {
    logger(`op ${ids.join(', ')} failed (attempt ${attempts}), retrying: ${message}`)
    await db
      .update(pendingWrites)
      .set({ attempts, error: message, errorName })
      .where(and(inArray(pendingWrites.opId, ids), eq(pendingWrites.status, 'pending')))
    const delay = OUTBOX_RETRY_DELAYS_MS[Math.min(attempts - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)]
    for (const id of ids) notBefore.set(id, Date.now() + delay)
    scheduleRetry()
    return
  }
  logger(`op ${ids.join(', ')} failed: ${message}`)
  await db
    .update(pendingWrites)
    .set({ status: 'failed', attempts, error: message, errorName })
    .where(and(inArray(pendingWrites.opId, ids), eq(pendingWrites.status, 'pending')))
  // The values they superseded were replaced by the user; they don't come back.
  const supersededIds = superseded.map((op) => op.opId)
  if (supersededIds.length > 0) {
    await db
      .update(pendingWrites)
      .set({ status: 'superseded', error: message, errorName })
      .where(and(inArray(pendingWrites.opId, supersededIds), eq(pendingWrites.status, 'pending')))
  }
  for (const id of ids) notBefore.delete(id)
  settle([...ids, ...supersededIds])
  discardAll(ops, prepared)
  discardAll(superseded)
}

/** Runs each op's applier's discard step (ops that will never apply), with what `prepare` returned for it. */
function discardAll(ops: OutboxOp[], prepared: unknown[] = []): void {
  for (const [index, op] of ops.entries()) {
    const discard = appliers.get(op.kind)?.discard
    if (!discard) continue
    discard(op, prepared[index]).catch((error) => logger(`discarding op ${op.opId} failed`, error))
  }
}

/** Drains again when the earliest op waiting for a retry is due. */
function scheduleRetry(): void {
  if (retryTimer !== undefined || notBefore.size === 0) return
  const wait = Math.max(0, Math.min(...notBefore.values()) - Date.now())
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    scheduleDrain()
  }, wait)
}

// --- Waiting ----------------------------------------------------------------------------------

type Waiter = { resolve: () => void; reject: (error: Error) => void }
const waiters = new Map<string, Set<Waiter>>()

function settle(opIds: string[]): void {
  if (opIds.length === 0) return
  postTabMessage({ type: 'outbox-settled', opIds })
  void recheckWaiters(opIds)
}

async function recheckWaiters(opIds: string[]): Promise<void> {
  const watched = opIds.filter((id) => waiters.has(id))
  if (watched.length === 0) return
  const rows: OutboxOp[] = await BaseDb.getAppDb()
    .select()
    .from(pendingWrites)
    .where(inArray(pendingWrites.opId, watched))
  for (const row of rows) settleWaiters(row)
}

function settleWaiters(row: OutboxOp): void {
  const outcome = outcomeOf(row)
  if (outcome === 'pending') return
  const set = waiters.get(row.opId)
  if (!set) return
  waiters.delete(row.opId)
  for (const waiter of set) {
    if (outcome === 'ok') waiter.resolve()
    else waiter.reject(new OutboxOpFailedError(row.opId, row.error ?? 'The write failed', row.errorName))
  }
}

function outcomeOf(row: Pick<OutboxOp, 'status' | 'error'>): 'pending' | 'ok' | 'failed' {
  if (row.status === 'applied') return 'ok'
  if (row.status === 'failed') return 'failed'
  // Superseded by an op that applied (no error) or that failed (its error).
  if (row.status === 'superseded') return row.error ? 'failed' : 'ok'
  return 'pending'
}

/**
 * Resolves once the op is applied, or superseded by a newer op that applied; rejects with
 * OutboxOpFailedError when it, or the op that superseded it, failed.
 */
export function waitForOutboxOp(opId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let poll: ReturnType<typeof setInterval> | undefined
    const done = () => {
      if (poll !== undefined) clearInterval(poll)
    }
    const waiter: Waiter = {
      resolve: () => {
        done()
        resolve()
      },
      reject: (error) => {
        done()
        reject(error)
      },
    }
    const set = waiters.get(opId) ?? new Set<Waiter>()
    set.add(waiter)
    waiters.set(opId, set)
    const check = async () => {
      const [row]: OutboxOp[] = await BaseDb.getAppDb()
        .select()
        .from(pendingWrites)
        .where(eq(pendingWrites.opId, opId))
        .limit(1)
      if (!row) {
        waiters.get(opId)?.delete(waiter)
        waiter.reject(new OutboxOpFailedError(opId, 'No such outbox op'))
        return
      }
      settleWaiters(row)
    }
    void check()
    poll = setInterval(() => void check(), WAIT_POLL_MS)
  })
}

/**
 * Resolves once every op pending when it was called has settled (applied, superseded or failed),
 * so a reader of `metadata` sees every edit made before. Publish waits on this before it reads.
 */
export async function waitForPendingOutboxOps(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  const pending: Array<{ opId: string }> = await db
    .select({ opId: pendingWrites.opId })
    .from(pendingWrites)
    .where(eq(pendingWrites.status, 'pending'))
  if (pending.length === 0) return
  startOutbox()
  if (isLeaderTab()) scheduleDrain()
  else postTabMessage({ type: 'outbox-nudge' })
  await Promise.allSettled(pending.map(({ opId }) => waitForOutboxOp(opId)))
}

/** The status of each op, by id; ops not found are left out. */
export async function getOutboxOps(opIds: string[]): Promise<OutboxOp[]> {
  if (opIds.length === 0) return []
  return BaseDb.getAppDb().select().from(pendingWrites).where(inArray(pendingWrites.opId, opIds))
}

/**
 * Stops draining in this tab (client.stop): no new drain starts, retries are dropped, and this
 * resolves once a drain that was running has finished. Ops stay pending in the database; the next
 * startOutbox (any write after init) resumes them, as after a reload.
 */
export async function stopOutbox(): Promise<void> {
  started = false
  stopped = true
  stopTabMessages?.()
  stopTabMessages = undefined
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  notBefore.clear()
  while (draining) await draining
}

// --- Tests ------------------------------------------------------------------------------------

/** Tests only: stops automatic drains (drainOutbox still runs) until unpaused. */
export function pauseOutboxDrainForTests(pause: boolean): void {
  paused = pause
  if (!pause) scheduleDrain()
}

/** Tests only: resolves when no drain is running. */
export async function outboxIdleForTests(): Promise<void> {
  while (draining) await draining
}

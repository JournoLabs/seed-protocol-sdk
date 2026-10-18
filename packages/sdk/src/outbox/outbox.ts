/**
 * The item write outbox (ADR 0019). An edit is appended as an op to `pending_writes`; the leader
 * tab drains the table, applying each op with its kind's applier and marking it applied in one
 * transaction.
 *
 * Ops apply in append order (the row id) per item property. A property's run of consecutive
 * `set` ops is coalesced: only the newest is applied and the older ones are marked superseded in
 * the same transaction. An op with a `groupId` applies together with the rest of its group.
 *
 * This module knows nothing about items: appliers are registered per op kind
 * (registerOutboxApplier).
 */
import debug from 'debug'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { pendingWrites, type PendingWriteType } from '@/seedSchema/PendingWriteSchema'
import { generateId } from '@/helpers/generateId'
import { TAB_ID, isLeaderTab, onTabMessage, postTabMessage, whenLeaderTab } from '@/helpers/tabCoordinator'

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
  /** A staged file the value was written to (`storage` ops). */
  valueRef?: string | null
  /** The stored metadata row the edit was made against. */
  baseRowId?: string | null
  baseUid?: string | null
  /** Ops sharing a group id apply in one transaction. */
  groupId?: string | null
}

/** Applies ops of one kind. Registered by the code that defines the kind. */
export type OutboxApplier<Prepared = unknown> = {
  /**
   * Runs before the transaction, for lookups that may call EAS or the app. Must not write.
   */
  prepare?: (op: OutboxOp) => Promise<Prepared>
  /**
   * Writes the op on `tx`, inside the transaction that marks it applied. Must read and write only
   * through `tx` (see BaseDb.transaction). Throw OutboxOpRejectedError to fail the op for good;
   * any other error is retried. What it returns is stored as the op's `result` (JSON).
   */
  apply: (op: OutboxOp, tx: ReturnType<typeof BaseDb.getAppDb>, prepared: Prepared) => Promise<unknown>
}

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

const appliers = new Map<string, OutboxApplier<any>>()

/** Registers the applier for one op kind; returns a function that removes it. */
export function registerOutboxApplier<Prepared>(kind: OutboxOpKind, applier: OutboxApplier<Prepared>): () => void {
  appliers.set(kind, applier)
  return () => {
    if (appliers.get(kind) === applier) appliers.delete(kind)
  }
}

/**
 * Appends one op, or several that apply together (they share a new group id unless they carry
 * one), and tells the leader to drain. Returns the op ids in order.
 */
export async function appendOutboxOps(inputs: AppendOutboxOpInput[]): Promise<string[]> {
  if (inputs.length === 0) return []
  const groupId = inputs.length > 1 ? generateId() : null
  const now = Date.now()
  const rows = inputs.map((input) => ({
    opId: generateId(),
    groupId: input.groupId ?? groupId,
    seedLocalId: input.seedLocalId,
    propertyName: input.propertyName ?? null,
    kind: input.kind,
    value: input.value === undefined ? null : JSON.stringify(input.value),
    valueRef: input.valueRef ?? null,
    baseRowId: input.baseRowId ?? null,
    baseUid: input.baseUid ?? null,
    createdAt: now,
    tabId: TAB_ID,
    status: 'pending' as OutboxOpStatus,
    attempts: 0,
  }))
  await BaseDb.getAppDb().insert(pendingWrites).values(rows)
  startOutbox()
  if (isLeaderTab()) scheduleDrain()
  else postTabMessage({ type: 'outbox-nudge' })
  return rows.map((row) => row.opId)
}

/** Appends one op; see appendOutboxOps. */
export async function appendOutboxOp(input: AppendOutboxOpInput): Promise<string> {
  const [opId] = await appendOutboxOps([input])
  return opId
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
  onTabMessage((message) => {
    if (message.type === 'outbox-nudge' && isLeaderTab()) scheduleDrain()
    if (message.type === 'outbox-settled') void recheckWaiters(message.opIds)
  })
  void whenLeaderTab().then(() => scheduleDrain())
}

/** Drains soon in this tab (if it leads); calls made while a drain runs make it run once more. */
function scheduleDrain(): void {
  if (paused || !isLeaderTab()) return
  if (draining) {
    drainAgain = true
    return
  }
  draining = (async () => {
    try {
      do {
        drainAgain = false
        await drainOutbox()
      } while (drainAgain && !paused)
    } catch (error) {
      logger('drain failed', error)
    } finally {
      draining = undefined
    }
  })()
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

type Unit =
  /** One op, or the newest of a property's run of sets (the older ones are settled with it). */
  | { op: OutboxOp; superseded: OutboxOp[] }
  /** Every op of a group, read when the unit applies. */
  | { groupId: string }

const keyOf = (op: OutboxOp) => `${op.seedLocalId}\u0000${op.propertyName ?? ''}`
const isDue = (op: OutboxOp) => (notBefore.get(op.opId) ?? 0) <= Date.now()

/**
 * The units to apply now, oldest first. A property's ops apply in order, so its queue waits
 * behind its oldest pending op, including one waiting for a retry. A group waits until none of its
 * ops is behind another op of its property.
 */
function planUnits(pending: OutboxOp[]): Unit[] {
  const queues = new Map<string, OutboxOp[]>()
  for (const op of pending) {
    const queue = queues.get(keyOf(op)) ?? []
    queue.push(op)
    queues.set(keyOf(op), queue)
  }
  const blockedByOthers = (op: OutboxOp) => {
    const queue = queues.get(keyOf(op))!
    return queue.slice(0, queue.indexOf(op)).some((earlier) => earlier.groupId !== op.groupId)
  }
  const units: Array<{ unit: Unit; order: number }> = []
  const plannedGroups = new Set<string>()
  for (const queue of queues.values()) {
    const head = queue[0]
    if (!isDue(head)) continue
    if (head.groupId) {
      if (plannedGroups.has(head.groupId)) continue
      const members = pending.filter((op) => op.groupId === head.groupId)
      if (members.some((member) => !isDue(member) || blockedByOthers(member))) continue
      plannedGroups.add(head.groupId)
      units.push({ unit: { groupId: head.groupId }, order: members[0].id })
      continue
    }
    let end = 0
    if (head.kind === 'set') {
      while (end + 1 < queue.length && queue[end + 1].kind === 'set' && !queue[end + 1].groupId) end++
    }
    units.push({ unit: { op: queue[end], superseded: queue.slice(0, end) }, order: head.id })
  }
  return units.sort((a, b) => a.order - b.order).map(({ unit }) => unit)
}

/** The transaction found an op no longer pending: another drainer applied it. */
class ClaimLostError extends Error {}

async function applyUnit(unit: Unit): Promise<void> {
  const ops: OutboxOp[] =
    'groupId' in unit
      ? await BaseDb.getAppDb()
          .select()
          .from(pendingWrites)
          .where(and(eq(pendingWrites.groupId, unit.groupId), eq(pendingWrites.status, 'pending')))
          .orderBy(asc(pendingWrites.id))
      : [unit.op]
  if (ops.length === 0) return
  const superseded = 'groupId' in unit ? [] : unit.superseded
  const ids = ops.map((op) => op.opId)
  const supersededIds = superseded.map((op) => op.opId)
  try {
    const prepared: unknown[] = []
    for (const op of ops) prepared.push(await applierFor(op).prepare?.(op))

    await BaseDb.transaction(async (tx) => {
      // Claim: an op another drainer applied meanwhile is no longer pending
      const claimed = await tx
        .update(pendingWrites)
        .set({ status: 'applied', appliedAt: Date.now() })
        .where(and(inArray(pendingWrites.opId, ids), eq(pendingWrites.status, 'pending')))
        .returning({ opId: pendingWrites.opId })
      if (claimed.length !== ids.length) throw new ClaimLostError()
      for (const [index, op] of ops.entries()) {
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
    for (const id of ids) notBefore.delete(id)
    settle([...ids, ...supersededIds])
  } catch (error) {
    if (error instanceof ClaimLostError) return
    await recordFailure(ops, superseded, error)
  }
}

function applierFor(op: OutboxOp): OutboxApplier<unknown> {
  const applier = appliers.get(op.kind)
  if (!applier) throw new OutboxOpRejectedError(`No outbox applier for op kind "${op.kind}"`)
  return applier
}

async function recordFailure(ops: OutboxOp[], superseded: OutboxOp[], error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const attempts = Math.max(...ops.map((op) => op.attempts)) + 1
  const permanent = error instanceof OutboxOpRejectedError || attempts >= OUTBOX_MAX_ATTEMPTS
  const ids = ops.map((op) => op.opId)
  const db = BaseDb.getAppDb()
  if (!permanent) {
    logger(`op ${ids.join(', ')} failed (attempt ${attempts}), retrying: ${message}`)
    await db
      .update(pendingWrites)
      .set({ attempts, error: message })
      .where(and(inArray(pendingWrites.opId, ids), eq(pendingWrites.status, 'pending')))
    const delay = OUTBOX_RETRY_DELAYS_MS[Math.min(attempts - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)]
    for (const id of ids) notBefore.set(id, Date.now() + delay)
    scheduleRetry()
    return
  }
  logger(`op ${ids.join(', ')} failed: ${message}`)
  await db
    .update(pendingWrites)
    .set({ status: 'failed', attempts, error: message })
    .where(and(inArray(pendingWrites.opId, ids), eq(pendingWrites.status, 'pending')))
  // The values they superseded were replaced by the user; they don't come back.
  const supersededIds = superseded.map((op) => op.opId)
  if (supersededIds.length > 0) {
    await db
      .update(pendingWrites)
      .set({ status: 'superseded', error: message })
      .where(and(inArray(pendingWrites.opId, supersededIds), eq(pendingWrites.status, 'pending')))
  }
  for (const id of ids) notBefore.delete(id)
  settle([...ids, ...supersededIds])
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
    else waiter.reject(new OutboxOpFailedError(row.opId, row.error ?? 'The write failed'))
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

/** The status of each op, by id; ops not found are left out. */
export async function getOutboxOps(opIds: string[]): Promise<OutboxOp[]> {
  if (opIds.length === 0) return []
  return BaseDb.getAppDb().select().from(pendingWrites).where(inArray(pendingWrites.opId, opIds))
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

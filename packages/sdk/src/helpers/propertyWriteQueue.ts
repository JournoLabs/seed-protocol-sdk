/**
 * One queue of value writes per item property, in this tab.
 *
 * Assigning a value starts a save at once, so typing starts one per keystroke. A new save stops
 * the previous save's actor, but not its DB write, so writes used to run side by side and could
 * land out of order, leaving an older value in the DB. Writes now run one at a time, and a write
 * whose save a newer save of the same property has replaced is skipped: only the latest value
 * needs to reach the DB.
 *
 * A save reserves its place when it starts (saves do async checks before writing, and an older
 * save's checks can finish after a newer one's), then runs its write or releases the place.
 *
 * {@link hasPendingPropertyWrite} lets the metadata live query leave the in-memory value alone
 * while a save is pending: the row it reports then is older than what the user has typed.
 */
type Queue = {
  tail: Promise<void>
  latest: number
  pending: number
}

export type PropertyWriteSlot = {
  /** Runs `write` after the property's running write; skips it when a newer save has started. */
  run: <T>(write: () => Promise<T>) => Promise<{ skipped: true } | { skipped: false; result: T }>
  /** Gives the place up without writing. Safe to call more than once, and after `run`. */
  release: () => void
}

const queues = new Map<string, Queue>()
let nextTicket = 0

export const propertyWriteKey = (
  seedId: string | null | undefined,
  propertyName: string | null | undefined,
): string | undefined => (seedId && propertyName ? `${seedId}:${propertyName}` : undefined)

export const reservePropertyWrite = (key: string): PropertyWriteSlot => {
  let queue = queues.get(key)
  if (!queue) {
    queue = { tail: Promise.resolve(), latest: 0, pending: 0 }
    queues.set(key, queue)
  }
  const q = queue
  const ticket = ++nextTicket
  q.latest = ticket
  q.pending += 1

  let released = false
  const release = () => {
    if (released) return
    released = true
    q.pending -= 1
    if (q.pending === 0 && queues.get(key) === q) queues.delete(key)
  }

  const run: PropertyWriteSlot['run'] = async (write) => {
    const previous = q.tail
    let done!: () => void
    const mine = new Promise<void>((resolve) => (done = resolve))
    q.tail = previous.then(() => mine)
    try {
      await previous
      if (q.latest !== ticket) return { skipped: true }
      return { skipped: false, result: await write() }
    } finally {
      done()
      release()
    }
  }

  return { run, release }
}

export const hasPendingPropertyWrite = (key: string | undefined): boolean =>
  !!key && (queues.get(key)?.pending ?? 0) > 0

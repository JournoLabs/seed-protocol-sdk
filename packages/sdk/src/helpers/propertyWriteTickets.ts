/**
 * Which save of an item property, in this tab, is the newest (ADR 0019).
 *
 * Assigning a value starts a save at once, so typing starts one per keystroke, and each does async
 * work (an ownership check, writing a file) before it appends its outbox op. The outbox applies ops
 * in append order, so an older save whose work finishes last would win. A save takes a ticket when
 * it starts and appends only if no newer save of the property has started since; otherwise it
 * drops its value (the newer save carries the user's latest).
 *
 * {@link hasPendingPropertyWrite} lets the metadata live query leave the in-memory value alone
 * while a save is running: the row it reports then is older than what the user has typed.
 */
type Counter = {
  latest: number
  pending: number
}

export type PropertyWriteTicket = {
  /** Whether no newer save of this property has started in this tab. */
  isLatest: () => boolean
  /** Marks the save finished. Safe to call more than once. */
  end: () => void
}

const counters = new Map<string, Counter>()
let nextTicket = 0

export const propertyWriteKey = (
  seedId: string | null | undefined,
  propertyName: string | null | undefined,
): string | undefined => (seedId && propertyName ? `${seedId}:${propertyName}` : undefined)

/** Takes a ticket for a save of `key` that starts now. */
export const beginPropertyWrite = (key: string): PropertyWriteTicket => {
  let counter = counters.get(key)
  if (!counter) {
    counter = { latest: 0, pending: 0 }
    counters.set(key, counter)
  }
  const c = counter
  const ticket = ++nextTicket
  c.latest = ticket
  c.pending += 1

  let ended = false
  return {
    isLatest: () => c.latest === ticket,
    end: () => {
      if (ended) return
      ended = true
      c.pending -= 1
      if (c.pending === 0 && counters.get(key) === c) counters.delete(key)
    },
  }
}

export const hasPendingPropertyWrite = (key: string | undefined): boolean =>
  !!key && (counters.get(key)?.pending ?? 0) > 0

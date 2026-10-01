import { enqueueActions } from 'xstate'

/** Replay CREATE_PUBLISH events that arrived while restore was still running. */
export const drainPendingCreates = enqueueActions(({ context, enqueue }) => {
  const pending = context.pendingCreates ?? []
  if (pending.length === 0) return
  enqueue.assign({ pendingCreates: [] })
  for (const ev of pending) {
    enqueue.raise(ev)
  }
})

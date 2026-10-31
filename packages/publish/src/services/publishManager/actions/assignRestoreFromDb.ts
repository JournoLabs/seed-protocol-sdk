import { assign } from 'xstate'

/** Adds to what is running: a late restore runs beside publishes started in the meantime. */
export const assignRestoreFromDb = assign(({ context, event }) => {
  const { publishProcesses, subscriptions } = context as {
    publishProcesses: Map<string, import('xstate').ActorRef<any, any>>
    subscriptions: Map<string, import('xstate').ActorRef<any, import('xstate').EventObject>>
  }
  const ev = event as unknown as {
    publishProcesses?: Map<string, unknown>
    subscriptions?: Map<string, unknown>
    status: import('../actors/restoreFromDb').PublishRestoreStatus
  }
  const incomingProcesses = ev.publishProcesses ?? new Map()
  const incomingSubscriptions = ev.subscriptions ?? new Map()
  return {
    publishProcesses: new Map([
      ...publishProcesses,
      ...(incomingProcesses as Map<string, import('xstate').ActorRef<any, any>>),
    ]),
    subscriptions: new Map([
      ...subscriptions,
      ...(incomingSubscriptions as Map<string, import('xstate').ActorRef<any, import('xstate').EventObject>>),
    ]),
    restoreStatus: ev.status,
  }
})

import { assign } from 'xstate'

export const assignRestoreFromDb = assign(({ context, event }) => {
  const ev = event as {
    publishProcesses?: Map<string, unknown>
    subscriptions?: Map<string, unknown>
  }
  const incomingProcesses = ev.publishProcesses ?? new Map()
  const incomingSubscriptions = ev.subscriptions ?? new Map()
  return {
    publishProcesses: new Map(incomingProcesses as Map<string, import('xstate').ActorRef<any, any>>),
    subscriptions: new Map(
      incomingSubscriptions as Map<string, import('xstate').ActorRef<any, import('xstate').EventObject>>
    ),
  }
})

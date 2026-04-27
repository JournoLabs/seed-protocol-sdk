import { assign, createActor, fromPromise, setup } from 'xstate'
import { MachineIds } from '@/client/constants'
import {
  finalizeEasSyncProcessRow,
  insertEasSyncProcessRow,
  type EasSyncRequestSource,
} from '@/db/write/easSyncProcess'
import { mergeEasSyncRequestIntents } from '@/events/item/mergeEasSyncOptions'
import type { SyncFromEasOptions } from '@/events/item/syncDbWithEas'
import debug from 'debug'

const log = debug('seedSdk:events:easSyncManager')

export type EasSyncRequestEvent = {
  type: 'REQUEST'
  correlationId: string
  options?: SyncFromEasOptions
  source: EasSyncRequestSource
}

export type EasSyncMachineContext = {
  runOptions: SyncFromEasOptions
  activeCorrelationIds: string[]
  activePrimarySource: EasSyncRequestSource
  pendingMergedOptions: SyncFromEasOptions | undefined
  pendingCorrelationIds: string[]
  pendingPrimarySource: EasSyncRequestSource | null
  lastFinishedCorrelationIds: string[] | null
  lastFinishedStatus: 'success' | 'failed' | null
  lastFinishedError: string | null
}

function toRunSyncArg(options: SyncFromEasOptions): SyncFromEasOptions | undefined {
  if (
    options &&
    'addresses' in options &&
    options.addresses !== undefined
  ) {
    return options
  }
  return undefined
}

const runEasSync = fromPromise(
  async ({
    input,
  }: {
    input: {
      options: SyncFromEasOptions
      requestPayload: Record<string, unknown>
      runningSnapshot: Record<string, unknown>
    }
  }) => {
    const rowId = await insertEasSyncProcessRow({
      requestPayload: input.requestPayload,
      persistedSnapshot: input.runningSnapshot,
    })
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    try {
      await runSyncFromEas(toRunSyncArg(input.options))
      await finalizeEasSyncProcessRow(rowId, {
        status: 'completed',
        persistedSnapshot: {
          phase: 'completed',
          correlationIds: input.requestPayload.correlationIds,
        },
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const details =
        err instanceof Error && err.stack
          ? err.stack.slice(0, 2000)
          : undefined
      await finalizeEasSyncProcessRow(rowId, {
        status: 'failed',
        errorMessage: message,
        errorDetails: details,
        persistedSnapshot: {
          phase: 'failed',
          correlationIds: input.requestPayload.correlationIds,
        },
      })
      throw err
    }
  },
)

const initialContext: EasSyncMachineContext = {
  runOptions: {},
  activeCorrelationIds: [],
  activePrimarySource: 'event_bus',
  pendingMergedOptions: undefined,
  pendingCorrelationIds: [],
  pendingPrimarySource: null,
  lastFinishedCorrelationIds: null,
  lastFinishedStatus: null,
  lastFinishedError: null,
}

export const easSyncMachine = setup({
  types: {
    context: {} as EasSyncMachineContext,
    events: {} as EasSyncRequestEvent,
  },
  actors: {
    runEasSync,
  },
}).createMachine({
  id: MachineIds.EAS_SYNC_MANAGER,
  initial: 'idle',
  context: initialContext,
  states: {
    idle: {
      on: {
        REQUEST: {
          target: 'running',
          actions: assign({
            runOptions: ({ event }) =>
              event.options === undefined
                ? {}
                : mergeEasSyncRequestIntents([event.options]),
            activeCorrelationIds: ({ event }) => [event.correlationId],
            activePrimarySource: ({ event }) => event.source,
          }),
        },
      },
    },
    running: {
      on: {
        REQUEST: {
          actions: assign({
            pendingMergedOptions: ({ context, event }) =>
              mergeEasSyncRequestIntents(
                [
                  context.runOptions,
                  context.pendingMergedOptions,
                  event.options === undefined ? {} : event.options,
                ].filter((x): x is SyncFromEasOptions => x != null),
              ),
            pendingCorrelationIds: ({ context, event }) => [
              ...context.pendingCorrelationIds,
              event.correlationId,
            ],
            pendingPrimarySource: ({ context, event }) =>
              context.pendingPrimarySource ?? event.source,
          }),
        },
      },
      invoke: {
        src: 'runEasSync',
        input: ({ context }: { context: EasSyncMachineContext }) => ({
          options: context.runOptions,
          requestPayload: {
            source: context.activePrimarySource,
            correlationIds: context.activeCorrelationIds,
            options: context.runOptions,
          },
          runningSnapshot: {
            phase: 'running',
            correlationIds: context.activeCorrelationIds,
          },
        }),
        onDone: {
          target: 'afterRun',
          actions: assign({
            lastFinishedCorrelationIds: ({ context }) => [
              ...context.activeCorrelationIds,
            ],
            lastFinishedStatus: () => 'success',
            lastFinishedError: () => null,
            activeCorrelationIds: () => [],
            runOptions: () => ({}),
          }),
        },
        onError: {
          target: 'afterRun',
          actions: [
            assign({
              lastFinishedCorrelationIds: ({ context }) => [
                ...context.activeCorrelationIds,
              ],
              lastFinishedStatus: () => 'failed',
              lastFinishedError: ({ event }) => {
                const e = event.error as unknown
                if (e instanceof Error) {
                  return e.message
                }
                return e != null ? String(e) : 'EAS sync failed'
              },
              activeCorrelationIds: () => [],
              runOptions: () => ({}),
            }),
            ({ event }) => {
              log('runEasSync error', event.error)
            },
          ],
        },
      },
    },
    afterRun: {
      always: [
        {
          guard: ({ context }) => context.pendingCorrelationIds.length > 0,
          target: 'running',
          actions: assign({
            runOptions: ({ context }) =>
              mergeEasSyncRequestIntents([context.pendingMergedOptions]),
            activeCorrelationIds: ({ context }) => [
              ...context.pendingCorrelationIds,
            ],
            activePrimarySource: ({ context }) =>
              context.pendingPrimarySource ?? 'event_bus',
            pendingMergedOptions: () => undefined,
            pendingCorrelationIds: () => [],
            pendingPrimarySource: () => null,
          }),
        },
        { target: 'idle' },
      ],
    },
  },
})

export const easSyncActor = createActor(easSyncMachine)

let easSyncActorStarted = false

export function startEasSyncActor(): void {
  if (easSyncActorStarted) {
    return
  }
  easSyncActorStarted = true
  easSyncActor.start()
}

function newCorrelationId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) {
    return c.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function requestEasSyncFromEventBus(): void {
  startEasSyncActor()
  easSyncActor.send({
    type: 'REQUEST',
    correlationId: newCorrelationId(),
    source: 'event_bus',
  })
}

export function requestEasSyncFromAddressChange(addresses: string[]): void {
  startEasSyncActor()
  easSyncActor.send({
    type: 'REQUEST',
    correlationId: newCorrelationId(),
    options: { addresses },
    source: 'address_change',
  })
}

export function requestEasSyncFromModelsInit(): void {
  startEasSyncActor()
  easSyncActor.send({
    type: 'REQUEST',
    correlationId: newCorrelationId(),
    source: 'models_init',
  })
}

export function sendEasSyncClientRequest(
  correlationId: string,
  options?: SyncFromEasOptions,
): void {
  startEasSyncActor()
  easSyncActor.send({
    type: 'REQUEST',
    correlationId,
    options,
    source: 'client_api',
  })
}

export type { EasSyncRequestSource } from '@/db/write/easSyncProcess'

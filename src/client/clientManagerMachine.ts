import { ClientManagerContext } from "@/types"
import { assign, setup } from "xstate"
import { initialize } from "./actors/initialize"
import { setAddresses } from "./actions/setAddresses"

export const clientManagerMachine = setup({
  types: {
    context: {} as ClientManagerContext,
    input: {} as ClientManagerContext | undefined,
  },
  actions: {
    setAddresses,
  },
  actors: {
    initialize,
  },
}).createMachine({
  id: 'clientManager',
  initial: 'uninitialized',
  context: ({ input }) => input as ClientManagerContext,
  states: {
    uninitialized: {
      on: {
        init: {
          target: 'initializing',
        },
      },
    },
    initializing: {
      on: {
        initialized: {
          target: 'idle',
        },
      },
      invoke: {
        src: 'initialize',
        input: ({ event, context }) => ({ event, context }),
      },
    },
    idle: {
      entry: assign({
        isInitialized: true,
      }),
      on: {
        saveAppStateSuccess: {
          actions: assign(({ event }) => {
            const { key, value } = event
            return {
              isSaving: false
            }
          }),
        },
        setAddresses: {
          actions: [
            {type: 'setAddresses'}
          ],
        },
      },
    },
  },
})

import { setup } from 'xstate'

const createItemMachine = setup({
  types: {
    context: {},
    input: {},
  },
}).createMachine({
  id: 'createItem',
  initial: 'creating',
  context: ({ input }) => input as any,
  states: {
    idle: {
      on: {
        create: 'creating',
      },
    },
    creating: {
      invoke: {
        src: 'createItem',
        onDone: {
          target: 'created',
          actions: 'onSuccess',
        },
        onError: {
          target: 'idle',
          actions: 'onError',
        },
      },
    },
    created: {
      type: 'final',
    },
  },
})

export { createItemMachine }

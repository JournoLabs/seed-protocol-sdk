import { ActionFunction, assign } from 'xstate'

type UpdateMachineContext = {
  actions: ActionFunction<any, any, any, any, any, any, any, any, any>[] | any
}
export const updateMachineContext: UpdateMachineContext = {
  actions: assign(({ context, event }) => {
    const newContext = Object.assign({}, context)

    for (let i = 0; i < Object.keys(event).length; i++) {
      const key = Object.keys(event)[i]
      if (key === 'type') {
        continue
      }
      newContext[key] = event[key]
    }
    return {
      ...newContext,
    }
  }),
}

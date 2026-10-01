import { assign } from 'xstate'

export const queueCreatePublish = assign(({ context, event }) => {
  const pending = context.pendingCreates ?? []
  return {
    pendingCreates: [...pending, event],
  }
})

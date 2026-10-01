import type { ActorRef } from 'xstate'

const resolvers = new Map<number, (actor: ActorRef<any, any> | undefined) => void>()
let nextToken = 1

/** Register a resolver for one CREATE_PUBLISH. The token travels on the event. */
export function registerCreatePublishResolver(
  resolve: (actor: ActorRef<any, any> | undefined) => void,
): number {
  const token = nextToken++
  resolvers.set(token, resolve)
  return token
}

/** Resolve a CREATE_PUBLISH promise. `undefined` means the process was not spawned. */
export function settleCreatePublish(
  token: number | undefined,
  actor: ActorRef<any, any> | undefined,
): void {
  if (token == null) return
  const resolve = resolvers.get(token)
  if (!resolve) return
  resolvers.delete(token)
  resolve(actor)
}

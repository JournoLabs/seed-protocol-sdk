import type { AnyActorRef } from 'xstate'

/**
 * Spawned publish/subscription actors are children of the publish manager (`enqueue.stopChild`).
 * DB-restored actors are created with `createActor` and are not children — stop them with `.stop()`.
 */
export function stopScopedOrStandaloneChild(
  self: AnyActorRef,
  child: AnyActorRef,
  enqueue: { stopChild: (c: AnyActorRef) => void },
): void {
  if (child._parent === self) {
    enqueue.stopChild(child)
  } else {
    child.stop()
  }
}

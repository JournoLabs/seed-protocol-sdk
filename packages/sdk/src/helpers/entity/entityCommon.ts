/**
 * Whether two references are the same entity: an instance and its reactive proxy are different
 * objects that share one actor.
 */
export function sameEntity(a: { getService(): unknown }, b: { getService(): unknown }): boolean {
  return a === b || a.getService() === b.getService()
}

/**
 * Whether an actor has been stopped (unload, destroy, or Schema eviction). Async work started by an
 * entity (DB lookups, retry timers) must check this before sending, since a stopped actor ignores
 * events and XState warns about every one of them.
 */
export function isActorStopped(actor: { getSnapshot(): { status: string } }): boolean {
  return actor.getSnapshot().status === 'stopped'
}

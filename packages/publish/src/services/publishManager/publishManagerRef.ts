/**
 * Holds a reference to the PublishManager service to avoid circular imports.
 * Subscribe actor uses this to call savePublish and onPublishDone.
 */
export type PublishManagerRef = {
  savePublish: (
    seedLocalId: string,
    publishProcess: { getPersistedSnapshot?: () => unknown; getSnapshot: () => unknown },
    options?: { triggerPublishDone?: boolean }
  ) => void
  onPublishDone: (seedLocalId: string) => void
  removeSubscription: (seedLocalId: string) => void
}

let ref: PublishManagerRef | null = null

export function setPublishManagerRef(r: PublishManagerRef) {
  ref = r
}

export function getPublishManagerRef(): PublishManagerRef | null {
  return ref
}

/**
 * Errors from draft saves that assignment starts in the background (schema/model renames and
 * tracked-property edits). Nothing awaits those saves, so the error is kept for `lastSaveError`
 * instead of only being logged. Keyed by the instance's service, which the instance and its
 * proxy share.
 */
const draftSaveErrors = new WeakMap<object, Error>()

export function getDraftSaveError(service: object): Error | undefined {
  return draftSaveErrors.get(service)
}

/** Run a background draft save, recording its failure (or clearing an earlier one on success). */
export function trackDraftSave(service: object, save: Promise<void>, label: string): void {
  save.then(
    () => {
      draftSaveErrors.delete(service)
    },
    (error: unknown) => {
      const recorded = error instanceof Error ? error : new Error(String(error))
      draftSaveErrors.set(service, recorded)
      console.warn(`[seed] ${label}: draft save failed (see lastSaveError):`, recorded.message)
    },
  )
}

const draftSaveQueues = new Map<string, Promise<unknown>>()

/**
 * Runs `save` once the previous draft save with the same key has settled. Two quick renames then
 * reach the database in order, instead of the second being skipped while the first runs.
 */
export function queueDraftSave<T>(key: string, save: () => Promise<T>): Promise<T> {
  const previous = draftSaveQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(save)
  draftSaveQueues.set(key, current)
  const cleanup = () => {
    if (draftSaveQueues.get(key) === current) draftSaveQueues.delete(key)
  }
  current.then(cleanup, cleanup)
  return current
}

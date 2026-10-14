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

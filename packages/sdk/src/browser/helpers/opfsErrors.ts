/**
 * Errors Chromium throws for a single OPFS entry that another context is using: the entry was
 * removed between listing and reading (SQLite journals come and go per transaction), or it is
 * held by a sync access handle in another tab or a not-yet-terminated worker.
 */
const SKIPPABLE_ENTRY_ERRORS = new Set([
  'NotFoundError',
  'InvalidStateError',
  'NoModificationAllowedError',
  'NotReadableError',
])

export function isSkippableOpfsEntryError(error: unknown): boolean {
  return error instanceof DOMException && SKIPPABLE_ENTRY_ERRORS.has(error.name)
}

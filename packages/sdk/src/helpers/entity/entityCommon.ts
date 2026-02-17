/**
 * Common getters and utilities for entity classes
 * These work with any entity that has a getService() method returning an XState actor
 */

/**
 * Get the current state value from an entity's service
 */
export function getEntityStatus<T extends { getService(): any }>(entity: T): string {
  const service = entity.getService()
  const snapshot = service.getSnapshot()
  return snapshot.value as string
}

/**
 * Get validation errors from an entity's service context
 */
export function getEntityValidationErrors<T extends { getService(): any }>(entity: T): any[] {
  const service = entity.getService()
  const snapshot = service.getSnapshot()
  const context = snapshot.context as any
  return context._validationErrors || []
}

/**
 * Check if an entity is valid (no validation errors)
 */
export function isEntityValid<T extends { getService(): any }>(entity: T): boolean {
  const errors = getEntityValidationErrors(entity)
  return errors.length === 0
}

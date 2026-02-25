/**
 * Conflict detection result
 */
export type ConflictResult = {
  hasConflict: boolean
  localVersion?: number
  dbVersion?: number
  localUpdatedAt?: string
  dbUpdatedAt?: string
  message?: string
}

/**
 * Error thrown when a conflict is detected between actor context and database
 */
export class ConflictError extends Error {
  public readonly conflict: ConflictResult
  public readonly name = 'ConflictError'

  constructor(message: string, conflict: ConflictResult) {
    super(message)
    this.conflict = conflict
    Object.setPrototypeOf(this, ConflictError.prototype)
  }
}


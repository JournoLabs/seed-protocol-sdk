import { CLIENT_NOT_INITIALIZED } from '@/helpers/constants'

/**
 * Thrown when a call needs the client and `client.init()` hasn't run, hasn't opened the database in
 * time, or `client.stop()` ended it: client methods after stop, and `Item.find` once its
 * `readyTimeout` passes. Match on `code` (decision D36).
 */
export class ClientNotInitializedError extends Error {
  readonly code = 'CLIENT_NOT_INITIALIZED' as const

  constructor() {
    super(CLIENT_NOT_INITIALIZED)
    this.name = 'ClientNotInitializedError'
    Object.setPrototypeOf(this, ClientNotInitializedError.prototype)
  }
}

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

/** Thrown by `client.resetLocalData()` outside a browser. Match on `code` (decision D36). */
export class ResetLocalDataBrowserOnlyError extends Error {
  readonly code = 'RESET_LOCAL_DATA_BROWSER_ONLY' as const

  constructor() {
    super('client.resetLocalData() runs in the browser only; in Node, stop the client and delete filesDir.')
    this.name = 'ResetLocalDataBrowserOnlyError'
    Object.setPrototypeOf(this, ResetLocalDataBrowserOnlyError.prototype)
  }
}

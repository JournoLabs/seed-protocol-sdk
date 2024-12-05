import { EventObject, fromCallback } from 'xstate'
import { SqliteConnectionManager } from '@/browser/services/db'
import { getSqliteWasmClient, setManager } from '@/browser/db/sqlWasmClient'

export const prepareDb = fromCallback<EventObject>(({ sendBack }) => {
  let sqliteWasmClient
  const _prepareDb = async (): Promise<void> => {
    if (typeof window === 'undefined') {
      return
    }
    sqliteWasmClient = await getSqliteWasmClient()
  }

  const interval = setInterval(() => {
    // TODO: Add a timeout
    // TODO: Add a cancel token to the promise so we can prevent more loops starting while we're checking the successful outcome
    if (sqliteWasmClient) {
      clearInterval(interval)
      const manager = new SqliteConnectionManager(sqliteWasmClient)
      setManager(manager)
      sendBack({ type: 'prepareDbSuccess', manager })
      return
    }
    _prepareDb().then(() => {
      return
    })
  }, 200)

  return () => {
    if (interval) {
      clearInterval(interval)
    }
  }
})

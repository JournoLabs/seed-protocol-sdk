import { Snapshot, SnapshotFrom } from 'xstate'

import { SeedBase } from '@/shared/seed'
import { SeedConstructorOptions } from '@/types'
import { getClient } from '@/client/ClientManager'
import { ClientManagerState } from '@/client/constants'

class SeedBrowser extends SeedBase {
  constructor({ config: endpoints }: SeedConstructorOptions) {
    super({ endpoints })
    
    // Internal machine removed - use ClientManager instead
    const clientManager = getClient()
    const clientService = clientManager.getService()

    clientService.subscribe(
      (snapshot) => {
        this.notify(snapshot)
      },
    )
  }

  notify(snapshot: Snapshot<any>) {
    const getReturnObj = (snapshot: SnapshotFrom<any>) => {
      const meta = snapshot.getMeta()
      let displayText, percentComplete
      for (const [_, value] of Object.entries(meta)) {
        if (Object.keys(value).includes('displayText')) {
          displayText = value.displayText
        }
        if (Object.keys(value).includes('displayText')) {
          percentComplete = value.percentComplete
        }
      }
      return {
        state: snapshot.value,
        displayText,
        percentComplete,
        ...snapshot.context,
      }
    }

    this._subject.next(getReturnObj(snapshot))
  }

  unload() {
    // ClientManager is a singleton, don't stop it here
    // Just complete the subject
    this._subject.complete()
  }
}

export { SeedBrowser }

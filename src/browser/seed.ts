import { Snapshot, SnapshotFrom } from 'xstate'
import { BehaviorSubject } from 'rxjs'

import { SeedConstructorOptions } from '@/types'
import { getClient } from '@/client/ClientManager'

type SeedState = {
  state: unknown
  displayText?: string
  percentComplete?: number
  [key: string]: unknown
}

type MetaValue = {
  displayText?: string
  percentComplete?: number
}

class SeedBrowser {
  protected _subject: BehaviorSubject<SeedState>

  constructor({ config: endpoints }: SeedConstructorOptions) {
    this._subject = new BehaviorSubject<SeedState>({ state: 'initializing' })
    
    // Internal machine removed - use ClientManager instead
    const clientManager = getClient()
    const clientService = clientManager.getService()

    clientService.subscribe(
      (snapshot) => {
        this.notify(snapshot)
      },
    )
  }

  notify(snapshot: Snapshot<unknown>) {
    const getReturnObj = (snapshot: SnapshotFrom<any>): SeedState => {
      const meta = snapshot.getMeta() as Record<string, MetaValue>
      let displayText: string | undefined
      let percentComplete: number | undefined
      for (const [_, value] of Object.entries(meta)) {
        if (value && typeof value === 'object') {
          if ('displayText' in value) {
            displayText = value.displayText
          }
          if ('percentComplete' in value) {
            percentComplete = value.percentComplete
          }
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

  /**
   * Subscribe to state changes
   */
  subscribe(callback: (state: SeedState) => void) {
    return this._subject.subscribe(callback)
  }

  unload() {
    // ClientManager is a singleton, don't stop it here
    // Just complete the subject
    this._subject.complete()
  }
}

export { SeedBrowser }

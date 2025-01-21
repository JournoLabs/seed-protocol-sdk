import { ActorRefFrom, createActor, Snapshot, SnapshotFrom } from 'xstate'

import { SeedBase } from '@/shared/seed'
import { SeedConstructorOptions } from '@/types'
import { CHILD_SNAPSHOT } from '@/services/internal/constants'
import { internalMachine } from '@/services/internal/internalMachine'

class SeedBrowser extends SeedBase {
  private _internalProcess: ActorRefFrom<typeof internalMachine>

  constructor({ config: endpoints }: SeedConstructorOptions) {
    super({ endpoints })
    this._internalProcess = createActor(internalMachine, {
      input: {
        endpoints,
      },
    })

    this._internalProcess.subscribe(
      (snapshot: SnapshotFrom<typeof internalMachine>) => {
        this.notify(snapshot)
      },
    )

    this._internalProcess.on(CHILD_SNAPSHOT, (event) => {
      this.notify(event.snapshot)
    })

    this._internalProcess.start()
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
    this._internalProcess.stop()
    this._subject.complete()
  }
}

export { SeedBrowser }

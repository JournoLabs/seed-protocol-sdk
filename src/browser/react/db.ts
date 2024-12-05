import { useCallback, useEffect, useState } from 'react'
import { Subscription } from 'xstate'
import { getGlobalService } from '@/browser/services/global'
import debug from 'debug'

const logger = debug('app:react:db')

export const useDbsAreReady = () => {
  const [dbsAreReady, setDbsAreReady] = useState(false)

  const update = useCallback(() => {
    if (dbsAreReady) {
      return
    }
    setDbsAreReady(true)
  }, [])

  useEffect(() => {
    let globalSubscription: Subscription | undefined
    let internalSubscription: Subscription | undefined

    const _waitForDbs = async (): Promise<void> => {
      const globalService = getGlobalService()
      const internalService =
        globalService.getSnapshot().context.internalService
      if (!internalService) {
        logger('[useDbsAreReady] [useEffect] no internalService')

        globalSubscription = globalService.subscribe(({ context }) => {
          if (!internalSubscription && context && context.internalService) {
            globalSubscription?.unsubscribe()
            internalSubscription = context.internalService.subscribe(
              (snapshot) => {
                if (snapshot.value === 'ready') {
                  update()
                  internalSubscription?.unsubscribe()
                }
              },
            )
          }
        })

        return
      }
      const currentState = internalService.getSnapshot().value
      if (currentState === 'ready') {
        update()
        return
      }
      internalSubscription = internalService.subscribe((snapshot) => {
        if (snapshot.value === 'ready') {
          update()
          internalSubscription?.unsubscribe()
        }
      })
    }

    _waitForDbs()

    return () => {
      if (globalSubscription) {
        globalSubscription.unsubscribe()
      }

      if (internalSubscription) {
        internalSubscription.unsubscribe()
      }
    }
  }, [])

  return {
    dbsAreReady,
  }
}

import { useState, useEffect } from 'react'
import { useSelector } from '@xstate/react'
import { PublishManager } from '../services/publishManager'

export function usePublishProcess(seedLocalId: string) {
  const publishManager = PublishManager.getService()

  const publishProcess = useSelector(publishManager, (snapshot) => {
    return snapshot?.context?.publishProcesses?.get(seedLocalId) ?? null
  })

  const [value, setValue] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!publishProcess) {
      setValue(undefined)
      return
    }
    setValue(publishProcess.getSnapshot()?.value as string | undefined)
    const sub = publishProcess.subscribe((snapshot: { value?: unknown }) => {
      setValue(snapshot?.value as string | undefined)
    })
    return () => sub.unsubscribe()
  }, [publishProcess])

  return {
    publishProcess: publishProcess ?? null,
    value,
  }
}

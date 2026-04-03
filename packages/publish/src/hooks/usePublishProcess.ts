import { useState, useEffect, useRef, useMemo } from 'react'
import { useSelector } from '@xstate/react'
import { useLiveQuery } from '@seedprotocol/react'
import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { eq, desc } from 'drizzle-orm'
import { PublishManager } from '../services/publishManager'
import { PublishMachineStates } from '~/helpers/constants'
import { getPublishMachineValueForUi, resolvePublishDisplayValue } from '~/helpers/publishDisplayHelpers'

function isTerminalDoneSnapshot(snapshot: { value?: unknown; status?: string } | null): snapshot is { value: string; status: 'done' } {
  if (!snapshot || snapshot.status !== 'done') return false
  return snapshot.value === PublishMachineStates.SUCCESS || snapshot.value === PublishMachineStates.FAILURE
}

export function usePublishProcess(seedLocalId: string) {
  const publishManager = PublishManager.getService()

  const publishProcess = useSelector(publishManager, (snapshot) => {
    return snapshot?.context?.publishProcesses?.get(seedLocalId) ?? null
  })

  /** Last snapshot from the publish actor; survives removal from the manager map so we can keep terminal `value`. */
  const lastPublishSnapshotRef = useRef<{ value?: unknown; status?: string } | null>(null)

  useEffect(() => {
    lastPublishSnapshotRef.current = null
  }, [seedLocalId])

  const [machineValue, setMachineValue] = useState<string | undefined>(undefined)
  /**
   * Once we have observed a terminal outcome for this seed (machine done or DB row), keep
   * showing success/failure until a new publish actor is spawned. Prevents the UI from
   * flipping back to an intermediate step when live-query or row ordering briefly reports
   * in_progress or a stale persistedSnapshot after completion.
   */
  const [terminalLatch, setTerminalLatch] = useState<'success' | 'failure' | null>(null)

  const db = BaseDb.getAppDb()
  const latestRecords = useLiveQuery(
    seedLocalId && db
      ? db
          .select()
          .from(publishProcesses)
          .where(eq(publishProcesses.seedLocalId, seedLocalId))
          .orderBy(desc(publishProcesses.startedAt))
          .limit(1)
      : null
  )
  const latestRecord = latestRecords?.[0] as
    | { status: string; persistedSnapshot: string; completedAt?: number | null }
    | undefined
  const recordStatus = latestRecord?.status as
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | undefined

  const value = useMemo(() => {
    if (publishProcess != null) {
      return machineValue
    }
    if (terminalLatch === 'success' || terminalLatch === 'failure') {
      return terminalLatch
    }
    const fromRow = getPublishMachineValueForUi(latestRecord)
    if (fromRow === PublishMachineStates.SUCCESS || fromRow === PublishMachineStates.FAILURE) {
      return fromRow
    }
    return resolvePublishDisplayValue(
      publishProcess,
      recordStatus != null ? { status: recordStatus } : undefined,
      machineValue
    )
  }, [publishProcess, recordStatus, machineValue, terminalLatch, latestRecord])

  useEffect(() => {
    setTerminalLatch(null)
  }, [seedLocalId])

  useEffect(() => {
    if (publishProcess != null) {
      return
    }
    if (recordStatus === 'completed') {
      setTerminalLatch('success')
    } else if (recordStatus === 'failed') {
      setTerminalLatch('failure')
    }
  }, [recordStatus, publishProcess])

  useEffect(() => {
    if (publishProcess != null) {
      setTerminalLatch(null)
    }
  }, [publishProcess])

  useEffect(() => {
    if (!publishProcess) {
      const last = lastPublishSnapshotRef.current
      const preserve = isTerminalDoneSnapshot(last)
      if (preserve) {
        setMachineValue(last.value as string)
        if (last.value === PublishMachineStates.SUCCESS) {
          setTerminalLatch('success')
        } else if (last.value === PublishMachineStates.FAILURE) {
          setTerminalLatch('failure')
        }
      } else {
        setMachineValue(undefined)
      }
      return
    }
    const initial = publishProcess.getSnapshot()
    lastPublishSnapshotRef.current = { value: initial?.value, status: (initial as { status?: string }).status }
    setMachineValue(initial?.value as string | undefined)
    const sub = publishProcess.subscribe((snapshot: { value?: unknown; status?: string }) => {
      lastPublishSnapshotRef.current = { value: snapshot?.value, status: snapshot?.status }
      setMachineValue(snapshot?.value as string | undefined)
    })
    return () => {
      sub.unsubscribe()
    }
  }, [publishProcess, seedLocalId])

  return {
    publishProcess: publishProcess ?? null,
    value,
  }
}

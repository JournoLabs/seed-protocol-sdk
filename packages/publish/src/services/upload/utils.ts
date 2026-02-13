import { uploadMachine, UploadMachineContext, } from './index'
import { UploadActor, }                         from './actors'
import { getDb, }          from '~/db'
import { UploadProcessRecord } from '~/types/db'
import { type SnapshotFrom, createActor, }                   from 'xstate'
import { createBrowserInspector, }              from '@statelyai/inspect'
import { subscribeToProcess, }                  from '../shared'


const { inspect, } = createBrowserInspector({
  autoStart : false,
},)


type UploadProcessParams = {
  reimbursementTransactionId?: string
  transactionKeys?: string
}

type SaveUploadProcessToDbParams = UploadProcessParams & {
  persistedSnapshot: SnapshotFrom<typeof uploadMachine>
}

type SaveUploadProcessToDb = ( params: SaveUploadProcessToDbParams ) => Promise<void>
type GetUploadProcessFromDb = ( params: UploadProcessParams ) => Promise<UploadProcessRecord | undefined>

const getUploadProcessFromDb: GetUploadProcessFromDb = async ( {
  reimbursementTransactionId,
  transactionKeys,
}, ) => {
  const db = getDb()
  return db.uploadProcesses.filter(
    ( uploadProcess, ) => uploadProcess.transactionKeys === transactionKeys || uploadProcess.reimbursementTransactionId === reimbursementTransactionId,
  ).first()
}

export const saveUploadProcessToDb: SaveUploadProcessToDb = async ( {
  persistedSnapshot,
}, ) => {

  if ( !persistedSnapshot ) {
    throw Error('No persisted snapshot given for save to db',)
  }

  const db = getDb()

  const { context, } = persistedSnapshot
  const {
    reimbursementTransactionId,
    transactionKeys,
    reimbursementConfirmed,
  } = context

  db.transaction('rw', db.uploadProcesses, async () => {

    const existingUploadProcessRecord = await getUploadProcessFromDb({
      reimbursementTransactionId,
      transactionKeys,
    },)

    if (!existingUploadProcessRecord) {
      await db.uploadProcesses.add({
        reimbursementConfirmed : reimbursementConfirmed || false,
        reimbursementTransactionId,
        transactionKeys,
        persistedSnapshot,
      },)
    } else {

      // Only update if true. If false, we somehow are getting a stale update since we can't go from true -> false
      if (existingUploadProcessRecord.reimbursementConfirmed && !reimbursementConfirmed) {
        return
      }

      // Only update if we have a reimbursementTransactionId. If we don't, we're getting a stale update
      if (existingUploadProcessRecord.reimbursementTransactionId && !reimbursementTransactionId) {
        return
      }

      // This would mean that we lost the transactionKeys value somehow.
      // TODO: Investigate why this would happen and report to Sentry
      if (existingUploadProcessRecord.transactionKeys && !transactionKeys) {
        return
      }

      try {
        await db.uploadProcesses.update(existingUploadProcessRecord, {
          reimbursementConfirmed : reimbursementConfirmed || false,
          reimbursementTransactionId,
          transactionKeys,
          persistedSnapshot,
        },)

      } catch ( e ) {
        console.error('Error updating upload process', e,)
      }

    }
  },)

}

type GetUploadProcessParams = Partial<UploadMachineContext>

type GetUploadProcess = ( params: GetUploadProcessParams ) => Promise<UploadActor | undefined>

export const getUploadProcess: GetUploadProcess = async (context, ) => {
  const { reimbursementTransactionId, transactionKeys, } = context
  const uploadProcessRecord = await getUploadProcessFromDb({ reimbursementTransactionId, transactionKeys, },)
  if ( uploadProcessRecord && uploadProcessRecord.persistedSnapshot ) {
    const uploadProcess = createActor(uploadMachine, {
      inspect,
      snapshot : uploadProcessRecord.persistedSnapshot,
    },)
    return subscribeToProcess(uploadProcess, saveUploadProcessToDb,)
  } else {

    const uploadProcess = createActor(uploadMachine, {
      inspect,
      input : context,
    },)

    return subscribeToProcess(uploadProcess, saveUploadProcessToDb,)
  }
}

type StartUploadParams = Partial<UploadMachineContext>

export const startUpload = async ( context: StartUploadParams, ): Promise<UploadActor | undefined> => {

  const {
    transactionKeys,
    reimbursementTransactionId,
  } = context

  if (!transactionKeys && !reimbursementTransactionId) {
    throw new Error('No transaction keys or reimbursement transaction id',)
  }

  const uploadProcess = await getUploadProcess(context,)

  if (!uploadProcess) {
    throw new Error(`No upload process found for reimbursement transaction: ${reimbursementTransactionId} or transaction keys ${transactionKeys}`,)
  }

  uploadProcess.start()

  return uploadProcess

}




// export const initQueues = async () => {
//
//   if ( typeof window === 'undefined' ) {
//     return
//   }
//
//   const db = getDb()
//   const uploadProcessRecords = await db.uploadProcesses.toArray()
//
//   // Restore queues from db
//   for ( const uploadProcessRecord of uploadProcessRecords ) {
//     // Clean up bad records
//     if ( !uploadProcessRecord.persistedSnapshot ) {
//       await db.uploadProcesses.where({ id : uploadProcessRecord.id, },).delete()
//       continue
//     }
//
//     const uploadProcess = createActor(uploadMachine, {
//       inspect,
//       snapshot : uploadProcessRecord.persistedSnapshot,
//     },)
//
//     uploadProcess.subscribe(uploadProcessListener,)
//     uploadProcess.start()
//
//     // Handle saved processes that already have a reimbursementTransactionId
//     if ( uploadProcessRecord.reimbursementTransactionId && uploadProcessRecord.persistedSnapshot ) {
//       uploadProcessQueue.set(uploadProcessRecord.reimbursementTransactionId, uploadProcess,)
//     }
//     // Handle saved processes that are waiting for reimbursement
//     if ( !uploadProcessRecord.reimbursementTransactionId && uploadProcessRecord.transactionKeys ) {
//       waitingForReimbursementConfirmation.set(uploadProcessRecord.transactionKeys, uploadProcess,)
//     }
//   }
//
//   await writeAppState(AppStateKey.Upload_queuesInitialized, true,)
//
//   window.addEventListener('beforeunload', () => {
//     writeAppState(AppStateKey.Upload_queuesInitialized, false,)
//   },)
//
// }






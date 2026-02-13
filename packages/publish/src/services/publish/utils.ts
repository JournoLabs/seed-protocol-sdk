import { ActorRefFrom, createActor, SnapshotFrom, Subscription, } from 'xstate'
import { getDb, PublishProcessRecord }                            from '~/db'
import { PublishMachineContext }                                  from '~/types/types'
import { publishMachine }                                         from '~/services/publish/index'
import { useEffect, useRef, useState }                           from 'react'
import { useLiveQuery }                                           from 'dexie-react-hooks'
import { useSelector }                                            from '@xstate/react'
import { PublishManager } from '../PublishManager'


type PublishActor = ActorRefFrom<typeof publishMachine>

type UsePublishProcess = (seedLocalId: string) => {
  publishProcess: PublishActor | null | undefined
  // status: string | undefined
  value: string | undefined
  // context: PublishMachineContext | undefined
}

export const usePublishProcess: UsePublishProcess = (seedLocalId: string) => {

  const publishManager = PublishManager.getService()

  const publishProcess = useSelector(publishManager, (snapshot) => {
    if (snapshot?.context?.publishProcesses?.get(seedLocalId)) {
      return snapshot?.context?.publishProcesses?.get(seedLocalId)
    }
  })

  const value = useSelector(publishProcess, (snapshot) => snapshot?.value as string | undefined)

  return {
    publishProcess,
    value,
  }
}


// type UsePublishProcess = (seedLocalId: string) => {
//   publishProcess: PublishActor | null | undefined
//   status: string | undefined
//   value: string | undefined
//   context: PublishMachineContext | undefined
// }

// export const usePublishProcess: UsePublishProcess = (seedLocalId) => {

//   const [publishProcess, setPublishProcess] = useState<PublishActor | undefined>(undefined)

//   const db = getDb()

//   const isLoading = useRef(false)

//   const status = useSelector(publishProcess, (snapshot) => snapshot?.status as string | undefined)
//   const value = useSelector(publishProcess, (snapshot) => snapshot?.value as string | undefined)
//   const context = useSelector(publishProcess, (snapshot) => snapshot?.context as PublishMachineContext | undefined)

//   const publishProcessRecord = useLiveQuery(
//     () => db.appState.where('key',).startsWith(`publishProcess_${seedLocalId}`).filter((appState) => {
//       if (!appState || !appState.value) {
//         return false
//       }
//       const publishProcess = JSON.parse(appState.value as string) as SnapshotFrom<typeof publishMachine>
//       return publishProcess.status !== 'done' 
//     }).reverse().sortBy('createdAt',).then((appStates) => appStates[0]),
//   )

//   useEffect(() => {
//     if (publishProcessRecord && !publishProcess && !isLoading.current) {
//       isLoading.current = true
//       const persistedSnapshot = JSON.parse(publishProcessRecord.value as string) as SnapshotFrom<typeof publishMachine>
//       const publishProcess = createActor(publishMachine, {
//         snapshot: persistedSnapshot,
//         input: undefined,
//       })

//       // TODO: If this hook is used in multiple places, we need to make sure that the publish process is not subscribed to multiple times
//       // Probably need a PublishProcessManager that manages all processes and only subscribes once
//       publishProcess.subscribe(async( snapshot ) => {
//         if ( snapshot && snapshot.context ) {
          
//           await db.transaction('rw', db.appState, async () => {
//             await db.appState.update(publishProcessRecord, {
//               value: JSON.stringify(publishProcess.getPersistedSnapshot()),
//               updatedAt : new Date(),
//             },)
//           })
//         }
//       })

//       if (publishProcess.getSnapshot().value === 'success' || publishProcess.getSnapshot().status !== 'active') {
//         setPublishProcess(undefined)
//         isLoading.current = false
//         return
//       }

//       publishProcess.start()

//       setPublishProcess(publishProcess)
//       isLoading.current = false
//     }
//   }, [publishProcessRecord])

//   return {
//     publishProcess,
//     status,
//     value,
//     context,
//   }
// }

// export const usePublishProcess = () => {
//   const [ publishProcess, setPublishProcess, ] = useState<PublishActor | null | undefined>()
//   const [ subscription, setSubscription ]      = useState<Subscription | undefined | null>()

//   const hasCheckedDb = useRef(false)
//   const isCheckingDb = useRef(false)

//   const account = useActiveWallet()?.getAccount()

//   const db = getDb()

//   const seedLocalIdFromDb = useLiveQuery(
//     () => db.appState.where('key',).startsWith('itemPublishRequest',).first().then(( appState, ) => appState?.value || null,),
//   )

//   const startPublish = useCallback(async ( seedLocalId?: string ) => {
//     const seedLocalIdToPublish = (seedLocalId || seedLocalIdFromDb) as string
//     if ( !seedLocalIdToPublish || !account || !account.address || hasPublishProcessInStore(seedLocalIdToPublish) ) {
//       return
//     }
//     await writeAppState('itemPublishRequest', null,)
//     await writeAppState(`publishProcess_${seedLocalIdToPublish}`, null)

//     const post = await Item.find({seedLocalId: seedLocalIdToPublish,})

//     const publishProcess = createActor(publishMachine, {
//       input: {
//         address: account.address,
//         item: post,
//       }
//     })

//     if ( hasPublishProcessInStore(seedLocalIdToPublish) ) {
//       return
//     }

//     setPublishProcessInStore(seedLocalIdToPublish, publishProcess)

//     publishProcess.subscribe(( snapshot ) => {
//       if ( snapshot && snapshot.context && publishProcess ) {

//         if ( snapshot.value === 'success' ) {
//           deletePublishProcessFromStore(seedLocalIdToPublish)
//           db.appState.delete(`publishProcess_${seedLocalIdToPublish}`).then(() => {
//             console.log(`Deleted publish process ${seedLocalIdToPublish} from db`, snapshot.context)
//           })
//         }

//         if ( snapshot.value !== 'success' ) {
//           writeAppState(`publishProcess_${seedLocalIdFromDb}`, JSON.stringify(publishProcess.getPersistedSnapshot()),)
//             .then(() => {
//               console.log(`Saved publish process ${seedLocalIdFromDb} to db`, snapshot.context)
//             })
//         }
//       }
//     })

//     publishProcess.start()
//     setPublishProcess(publishProcess,)
//   }, [ seedLocalIdFromDb, account ])

//   useEffect(() => {
//     if (
//       publishProcess ||
//       !seedLocalIdFromDb ||
//       !hasCheckedDb.current ||
//       !account ||
//       !account.address
//     ) {
//       return
//     }

//     const _startPublish = async (): Promise<void> => {
//       await startPublish()
//     }

//     _startPublish()

//   }, [ seedLocalIdFromDb, account ])

//   useEffect(() => {

//     const _checkDb = async (): Promise<void> => {
//       if ( hasCheckedDb.current || isCheckingDb.current ) {
//         return
//       }
//       isCheckingDb.current        = true
//       const _db                   = getDb()
//       const _publishProcessRecord = await _db.appState.filter(
//         ( appState, ) => appState.key.startsWith('publishProcess_'),
//       ).first().then(( appState, ) => appState?.value || null,)
//       if ( _publishProcessRecord ) {
//         const publishProcessRecord = JSON.parse(_publishProcessRecord) as SnapshotFrom<typeof publishMachine>

//         if ( publishProcessRecord.context &&
//           publishProcessRecord.context.item &&
//           publishProcessRecord.context.item.seedLocalId ) {


//           if (
//             publishProcessRecord.status === 'done' ||
//             stepsNotToRestore.includes(publishProcessRecord.value)
//           ) {
//             const seedLocalId = publishProcessRecord.context.item.seedLocalId
//             if ( seedLocalId ) {
//               await writeAppState(`publishProcess_${seedLocalId}`, null)
//               deletePublishProcessFromStore(seedLocalId)
//               await startPublish(seedLocalId)
//             }
//             isCheckingDb.current = false
//             return
//           }

//           if ( !hasPublishProcessInStore(publishProcessRecord.context.item.seedLocalId) ) {
//             const restoredPublishProcess = createActor(publishMachine, {
//               snapshot: publishProcessRecord,
//             })
//             setPublishProcessInStore(publishProcessRecord.context.item.seedLocalId, restoredPublishProcess)
//             restoredPublishProcess.subscribe(( snapshot ) => {
//               if ( snapshot && snapshot.context && publishProcess ) {
//                 console.log('snapshot.value', snapshot.value)

//                 if ( snapshot.value === 'success' ) {
//                   deletePublishProcessFromStore(publishProcessRecord.context.item.seedLocalId)
//                   _db.appState.delete(`publishProcess_${publishProcessRecord.context.item.seedLocalId}`).then(() => {
//                     console.log(`Deleted publish process ${publishProcessRecord.context.item.seedLocalId} from db`, snapshot.context)
//                   })
//                 }

//                 if ( snapshot.value !== 'success' ) {
//                   writeAppState(`publishProcess_${seedLocalIdFromDb}`, JSON.stringify(publishProcess.getPersistedSnapshot()),)
//                     .then(() => {
//                       console.log(`Saved publish process ${seedLocalIdFromDb} to db`, snapshot.context)
//                     })
//                 }
//               }
//             })
//             restoredPublishProcess.start()
//             setPublishProcess(restoredPublishProcess,)
//             isCheckingDb.current = false
//           }
//         }

//       }
//       hasCheckedDb.current = true
//     }

//     _checkDb()

//     return () => {
//       if ( subscription ) {
//         subscription.unsubscribe()
//       }
//     }
//   }, [])

//   return {
//     publishProcess,
//   }
// }


type PublishProcessParams = {
  publishProcessRecordId?: string
}

type SavePublishProcessToDbParams = PublishProcessParams & {
  persistedSnapshot: SnapshotFrom<typeof publishMachine>
}

type SavePublishProcessToDb = ( params: SavePublishProcessToDbParams ) => Promise<void>
type GetPublishProcessFromDb = ( params: { seedLocalId?: string; seedId?: string; existingSeedUid?: string } ) => Promise<PublishProcessRecord | undefined>


export const savePublishProcessToDb: SavePublishProcessToDb = async ( {
                                                                        persistedSnapshot,
                                                                      }, ) => {

  if ( !persistedSnapshot ) {
    throw Error('No persisted snapshot given for save to db',)
  }

  const db = getDb()
  const { context } = persistedSnapshot
  const ctx = context as PublishMachineContext
  const seedLocalId = ctx.item?.seedLocalId
  if ( !seedLocalId ) {
    throw Error('No seedLocalId in publish snapshot context',)
  }

  const snapshotStr = JSON.stringify(persistedSnapshot)
  const status = persistedSnapshot.status === 'active' ? 'in_progress' : 'completed'
  const now = Date.now()

  await db.transaction('rw', db.publishProcesses, async () => {

    const existing = await getPublishProcessFromDb({ seedLocalId, seedId: ctx.seedId, existingSeedUid: ctx.existingSeedUid },)

    if ( existing && existing.status === 'in_progress' ) {
      await db.publishProcesses.update(existing.id!, {
        persistedSnapshot: snapshotStr,
        seedId: ctx.seedId,
        existingSeedUid: ctx.existingSeedUid,
        updatedAt: now,
      },)
    } else {
      const modelName = ctx.modelName ?? ctx.item?.modelName ?? ''
      const schemaId = ctx.schemaId ?? ctx.item?.schemaId
      await db.publishProcesses.add({
        seedLocalId,
        modelName,
        schemaId,
        status,
        startedAt: now,
        persistedSnapshot: snapshotStr,
        seedId: ctx.seedId,
        existingSeedUid: ctx.existingSeedUid,
        createdAt: now,
        updatedAt: now,
      },)
    }
  },)
}

const getPublishProcessFromDb: GetPublishProcessFromDb = async ( params ) => {
  const { seedLocalId, seedId, existingSeedUid } = params
  const db = getDb()
  if ( !seedLocalId ) {
    const bySeed = await db.publishProcesses.filter(( r ) => {
      if ( r.status !== 'in_progress' ) return false
      if ( seedId != null ) return r.seedId === seedId
      if ( existingSeedUid != null ) return r.existingSeedUid === existingSeedUid
      return false
    },).reverse().sortBy('createdAt',).then(( rows ) => rows[0])
    return bySeed as PublishProcessRecord | undefined
  }
  const candidates = await db.publishProcesses
    .where('seedLocalId')
    .equals(seedLocalId)
    .filter(( r ) => r.status === 'in_progress' && ( seedId == null || r.seedId === seedId ) && ( existingSeedUid == null || r.existingSeedUid === existingSeedUid ),)
    .reverse()
    .sortBy('createdAt',)
  return candidates[0] as PublishProcessRecord | undefined
}
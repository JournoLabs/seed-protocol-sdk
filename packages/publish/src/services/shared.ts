import { Actor, ActorLogic, Snapshot, } from 'xstate'



type SubscribeToProcess = ( actor: Actor<ActorLogic<any, any>>, saveFn: ( params: { persistedSnapshot: Snapshot<unknown> }, ) => Promise<void>, ) => Actor<ActorLogic<any, any>>

export const subscribeToProcess: SubscribeToProcess = ( actor, saveFn,) => {

  const processListener = async ( _, ) => {
    const persistedSnapshot = actor.getPersistedSnapshot()
    await saveFn({ persistedSnapshot, },)
  }

  actor.subscribe(processListener,)

  return actor

}
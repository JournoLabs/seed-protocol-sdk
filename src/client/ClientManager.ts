import debug                      from 'debug'
import { createActor, waitFor }   from 'xstate'
import { clientManagerMachine }   from '@/client/clientManagerMachine'
// import { BaseDb }                 from '@/db/Db/BaseDb'
// import { appState }               from '@/seedSchema'
// import { eq }                     from 'drizzle-orm'
import { CLIENT_NOT_INITIALIZED } from '@/helpers/constants'
import { BaseDb }           from '@/db/Db/BaseDb'
import { appState, models } from '@/seedSchema'
import { eq }               from 'drizzle-orm'
import { getGlobalService }       from '@/services/global/globalMachine'

const logger               = debug('seedSdk:client')

type ModelDefObj = {
  name: string
  type: string
  properties: {
    [key: string]: any
  }
}

export const clientManager = createActor(clientManagerMachine, {
  input: {
    isInitialized: false,
  }
})

const subscription         = clientManager.subscribe(( snapshot ) => {
  logger('ClientManager snapshot.value:', snapshot.value)
  logger('ClientManager snapshot.context.isInitialized:', snapshot.context.isInitialized)
})

clientManager.start()

const ensureInitialized = () => {
  if (!clientManager.getSnapshot().context.isInitialized) {
    throw new Error(CLIENT_NOT_INITIALIZED);
  }
}

export const ClientManager = {
  isInitialized: () => {
    return clientManager.getSnapshot().context.isInitialized
  },
  getService: () => {
    ensureInitialized();
    return clientManager;
  },
  init: async (options: any) => {
    clientManager.send({ type: 'init', options });
    await waitFor(clientManager, (snapshot) => snapshot.context.isInitialized);
  },
  setAddresses: async (addresses: string[]) => {
    ensureInitialized();
    logger('setAddresses', addresses);
    clientManager.send({ type: 'setAddresses', addresses });
    await waitFor(clientManager, (snapshot) => !snapshot.context.isSaving);
    logger('setAddresses success', addresses);
  },
  getAddresses: async () => {
    ensureInitialized();
    const db = await BaseDb.getAppDb();
    const results = await db.select().from(appState).where(eq(appState.key, 'addresses'));
    return JSON.parse(results[0]?.value);
  },
  addModel: async (modelDef: ModelDefObj) => {
    const db = await BaseDb.getAppDb();
    const existingModels = await db.select().from(models).where(eq(models.name, modelDef.name));
    if (existingModels.length > 0) {
      return;
    }
    await db.insert(models).values({
      name: modelDef.name
    })
    const globalService = getGlobalService()
    globalService.send({ type: 'addModel', modelDef });
  },
  onReady: (callback: () => void) => {
    const subscription = clientManager.subscribe((snapshot) => {
      if (snapshot.context.isInitialized) {
        subscription.unsubscribe()
        callback();
      }
    });
  },
  stop: () => {
    ensureInitialized();
    clientManager.stop();
  },
  unload: () => {
    ensureInitialized();
    clientManager.stop();
    subscription.unsubscribe();
  },
}

import debug                      from 'debug'
import { createActor, waitFor }   from 'xstate'
import { clientManagerMachine }   from '@/client/clientManagerMachine'
import { SeedConstructorOptions } from '@/types/index'
import { BaseDb }                 from '@/db/Db/BaseDb'
import { appState }               from '@/seedSchema'
import { eq }                     from 'drizzle-orm'
import { CLIENT_NOT_INITIALIZED } from '@/helpers/constants'

const logger               = debug('app:client')

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
  isInitialized: () => clientManager.getSnapshot().context.isInitialized,
  getService: () => {
    ensureInitialized();
    return clientManager;
  },
  init: async (options: SeedConstructorOptions) => {
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

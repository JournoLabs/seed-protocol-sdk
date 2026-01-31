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
    addressesSet: false,
    isSaving: false,
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

// Singleton instance - created once at module load time
// ES modules cache exports, ensuring all imports get the same instance
const clientInstance = {
  isInitialized: () => {
    return clientManager.getSnapshot().context.isInitialized
  },
  getService: () => {
    // ensureInitialized();
    return clientManager;
  },
  init: async (options: any) => {
    // If the actor is stopped (e.g., from a previous failed test), restart it
    const snapshot = clientManager.getSnapshot()
    const currentState = snapshot.value as string
    const isStopped = snapshot.status === 'stopped'
    
    if (isStopped) {
      logger('Client manager was stopped, restarting...')
      clientManager.start()
      // Wait for the actor to be ready
      try {
        await waitFor(clientManager, (snapshot) => snapshot.status !== 'stopped', { timeout: 1000 })
      } catch (e) {
        logger('Timeout waiting for actor to restart, continuing anyway...')
      }
    }
    
    // Clear any stale context from previous failed initializations
    // This ensures we start with a clean slate before the new init updates it
    if (currentState !== 'uninitialized') {
      logger(`Client manager is in state ${currentState}, clearing stale context before re-init...`)
      clientManager.send({ 
        type: 'updateContext', 
        context: {
          isInitialized: false,
          addressesSet: false,
          isSaving: false,
          endpoints: undefined,
          addresses: undefined,
          models: undefined,
          arweaveDomain: undefined,
          filesDir: undefined,
          dbConfig: undefined,
          initError: undefined,
        }
      })
      // Wait a moment for the context update to be processed
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    // Send init event - the root-level handler will transition to PLATFORM_CLASSES_INIT
    // which will stop any running actors and start fresh with the new options
    // The platformClassesInit actor will update the context with the correct endpoints from options
    clientManager.send({ type: 'init', options });
    
    // Wait for the state machine to transition to PLATFORM_CLASSES_INIT to ensure
    // any old actors are stopped and the new initialization flow begins
    try {
      await waitFor(clientManager, (snapshot) => {
        return snapshot.value === 'platformClassesInit' || snapshot.context.isInitialized
      }, { timeout: 1000 })
    } catch (e) {
      // If we can't transition, continue anyway - the waitFor below will catch any errors
      logger('Timeout waiting for state transition, continuing...')
    }
    try {
      await waitFor(clientManager, (snapshot) => {
        // Check for errors in context (for cases where error is set but state hasn't transitioned yet)
        if (snapshot.context.initError) {
          const error = snapshot.context.initError instanceof Error 
            ? snapshot.context.initError 
            : new Error(String(snapshot.context.initError))
          throw error
        }
        return snapshot.context.isInitialized
      }, { timeout: 30000 });
    } catch (error: any) {
      // Ensure we never throw undefined
      if (error === undefined || error === null) {
        throw new Error('Initialization failed with undefined error')
      }
      throw error
    }
  },
  setAddresses: async (addresses: string[]) => {
    ensureInitialized();
    logger('setAddresses', addresses);
    clientManager.send({ type: 'setAddresses', addresses });
    await waitFor(clientManager, (snapshot) => !snapshot.context.isSaving, { timeout: 10000 });
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
    // Global service removed - model registration is now handled by ClientManager
    // Models are added to DB during the ADD_MODELS_TO_DB state
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

// Export the singleton instance
// This ensures all imports across different files get the same instance
export const ClientManager = clientInstance

export const getClient = () => {
  return clientInstance
}
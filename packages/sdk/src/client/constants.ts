const MACHINE_ID_SCOPE = '@seedSdk'

export enum MachineIds {
  CLIENT_MANAGER = `${MACHINE_ID_SCOPE}/clientManager`,
  EAS_SYNC_MANAGER = `${MACHINE_ID_SCOPE}/easSyncManager`,
  GLOBAL      = `${MACHINE_ID_SCOPE}/global`,
  INTERNAL    = `${MACHINE_ID_SCOPE}/internal`,
  EAS         = `${MACHINE_ID_SCOPE}/eas`,
  ITEM        = `${MACHINE_ID_SCOPE}/item`,
  ALL_ITEMS   = `${MACHINE_ID_SCOPE}/allItems`,
  MODEL       = `${MACHINE_ID_SCOPE}/model`,
  FILE_SYSTEM = `${MACHINE_ID_SCOPE}/fileSystem`,
}

export enum ClientManagerState {
  UNINITIALIZED = 'uninitialized',
  PLATFORM_CLASSES_INIT = 'platformClassesInit',
  FILE_SYSTEM_INIT = 'fileSystemInit',
  DB_INIT = 'dbInit',
  SAVE_CONFIG = 'saveConfig',
  ADD_MODELS_TO_DB = 'addModelsToDb',
  PROCESS_SCHEMA_FILES = 'processSchemaFiles',
  IDLE = 'idle',
  INIT_FAILED = 'initFailed',
}

export enum ClientManagerEvents {
  UPDATE_CONTEXT = 'updateContext',
  SAVE_APP_STATE_SUCCESS = 'saveAppStateSuccess',
  SAVE_APP_STATE_ERROR = 'saveAppStateError',
  SET_ADDRESSES = 'setAddresses',
}

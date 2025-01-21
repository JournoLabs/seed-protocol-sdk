const ENV = (typeof process !== 'undefined' && process.env) 
            ? process.env 
            : (typeof window !== 'undefined' && (window as any).env) 
            ? (window as any).env 
            : {};


const MACHINE_ID_SCOPE = '@seedSdk'

export enum MachineIds {
  GLOBAL      = `${MACHINE_ID_SCOPE}/global`,
  INTERNAL    = `${MACHINE_ID_SCOPE}/internal`,
  DB          = `${MACHINE_ID_SCOPE}/db`,
  EAS         = `${MACHINE_ID_SCOPE}/eas`,
  ITEM        = `${MACHINE_ID_SCOPE}/item`,
  ALL_ITEMS   = `${MACHINE_ID_SCOPE}/allItems`,
  MODEL       = `${MACHINE_ID_SCOPE}/model`,
  FILE_SYSTEM = `${MACHINE_ID_SCOPE}/fileSystem`,
}

const { INTERNAL, DB, GLOBAL, EAS, MODEL } = MachineIds

export enum GlobalState {
  UNINITIALIZED       = 'uninitialized',
  INITIALIZING        = 'initializing',
  INITIALIZED         = 'initialized',
  PUBLISHING_ITEM     = 'publishingItem',
  ADDING_MODELS_TO_DB = 'addingModelsToDb',
}

const {
        UNINITIALIZED,
        INITIALIZING,
        INITIALIZED,
        PUBLISHING_ITEM,
        ADDING_MODELS_TO_DB,
      } = GlobalState

export enum InternalState {
  IDLE             = 'idle',
  INITIALIZING     = 'initializing',
  VALIDATING_INPUT = 'validatingInput',
  CONFIGURING_FS   = 'configuringFs',
  LOADING_SEED_DB  = 'loadingSeedDb',
  SAVING_CONFIG    = 'savingConfig',
  LOADING_APP_DB   = 'loadingAppDb',
  LOADING_SDK_DB   = 'loadingSdkDb',
}

const { VALIDATING_INPUT, CONFIGURING_FS, LOADING_SEED_DB, LOADING_APP_DB } =
        InternalState

export enum DbState {
  CHECKING_STATUS   = 'checkingStatus',
  WAITING_FOR_FILES = 'waitingForFiles',
  VALIDATING        = 'validating',
  CONNECTING_TO_DB  = 'connectingToDb',
  // FETCHING_MIGRATIONS = 'fetchingMigrations',
  MIGRATING         = 'migrating',
}

const {
        CHECKING_STATUS,
        VALIDATING,
        CONNECTING_TO_DB,
        WAITING_FOR_FILES,
        MIGRATING,
      } = DbState

export enum PublishMachineStates {
  VALIDATING_ITEM_DATA           = 'validatingItemData',
  CREATING_PUBLISH_ATTEMPT       = 'creatingPublishAttempt',
  UPLOADING                      = 'uploading',
  PREPARING_PUBLISH_REQUEST_DATA = 'preparingPublishRequestData',
  PUBLISHING                     = 'publishing',
  IDLE                           = 'idle',
}

export const INTERNAL_VALIDATING_INPUT_SUCCESS = `${INTERNAL}.${VALIDATING_INPUT}.success`

export const INTERNAL_CONFIGURING_FS_SUCCESS = `${INTERNAL}.${CONFIGURING_FS}.success`
export const INTERNAL_CONFIGURING_FS_FAILURE = `${INTERNAL}.${CONFIGURING_FS}.failure`

export const INTERNAL_LOADING_SEED_DB_SUCCESS = `${INTERNAL}.${LOADING_SEED_DB}.success`
export const INTERNAL_LOADING_SEED_DB_FAILURE = `${INTERNAL}.${LOADING_SEED_DB}.failure`

export const INTERNAL_LOADING_APP_DB_SUCCESS = `${INTERNAL}.${LOADING_APP_DB}.success`
export const INTERNAL_LOADING_APP_DB_FAILURE = `${INTERNAL}.${LOADING_APP_DB}.failure`

export const INTERNAL_SAVING_CONFIG_SUCCESS = `${INTERNAL}.savingConfig.success`
export const INTERNAL_SAVING_CONFIG_FAILURE = `${INTERNAL}.savingConfig.failure`

export const GLOBAL_GETTING_SEED_CLASS_SUCCESS             = `${GLOBAL}.${PUBLISHING_ITEM}.success`
export const GLOBAL_INITIALIZING_SEND_CONFIG               = `${GLOBAL}.${INITIALIZING}.sendConfig`
export const GLOBAL_INITIALIZING_INTERNAL_SERVICE_READY    = `${GLOBAL}.${INITIALIZING}.internalServiceReady`
export const GLOBAL_INITIALIZING_CREATE_ALL_ITEMS_SERVICES = `${GLOBAL}.${INITIALIZING}.createAllItemsServices`
export const GLOBAL_ADDING_MODELS_TO_DB_SUCCESS            = `${GLOBAL}.${ADDING_MODELS_TO_DB}.success`

export const DB_CHECK_STATUS_UPDATE_PATHS   = `${DB}.${CHECKING_STATUS}.updatePaths`
export const DB_CHECK_STATUS_EXISTS         = `${DB}.${CHECKING_STATUS}.exists`
export const DB_CHECK_STATUS_DOES_NOT_EXIST = `${DB}.${CHECKING_STATUS}.doesNotExist`
export const DB_CHECK_STATUS_FAILURE        = `${DB}.${CHECKING_STATUS}.failure`

export const DB_VALIDATING_SUCCESS         = `${DB}.${VALIDATING}.success`
export const DB_VALIDATING_WAIT            = `${DB}.${VALIDATING}.wait`
export const DB_MIGRATING_WAIT             = `${DB}.${MIGRATING}.wait`
export const DB_MIGRATING_SUCCESS          = `${DB}.${MIGRATING}.success`
export const DB_CREATING_SUCCESS           = `${DB}.${CONNECTING_TO_DB}.success`
export const DB_WAITING_FOR_FILES_RECEIVED = `${DB}.${WAITING_FOR_FILES}.filesReceived`
export const DB_ON_SNAPSHOT                = `${DB}.onSnapshot`
export const CHILD_SNAPSHOT                = 'childSnapshot'

export const INTERNAL_SERVICE_SNAPSHOT = 'internalServiceSnapshot'

export const DB_NAME_APP        = 'app_db'
export const BROWSER_FS_TOP_DIR = 'app-files'

export const EAS_ENDPOINT =
               ENV.NEXT_PUBLIC_EAS_ENDPOINT ||
               ENV.EAS_ENDPOINT ||
               'https://optimism-sepolia.easscan.org/graphql'

export const ARWEAVE_HOST     =
               ENV.NEXT_PUBLIC_ARWEAVE_HOST || 'arweave.net'
export const ARWEAVE_ENDPOINT = `https://${ARWEAVE_HOST}/graphql`

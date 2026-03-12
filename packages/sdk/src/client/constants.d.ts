export declare enum MachineIds {
    CLIENT_MANAGER = "@seedSdk/clientManager",
    GLOBAL = "@seedSdk/global",
    INTERNAL = "@seedSdk/internal",
    EAS = "@seedSdk/eas",
    ITEM = "@seedSdk/item",
    ALL_ITEMS = "@seedSdk/allItems",
    MODEL = "@seedSdk/model",
    FILE_SYSTEM = "@seedSdk/fileSystem"
}
export declare enum ClientManagerState {
    UNINITIALIZED = "uninitialized",
    PLATFORM_CLASSES_INIT = "platformClassesInit",
    FILE_SYSTEM_INIT = "fileSystemInit",
    DB_INIT = "dbInit",
    SAVE_CONFIG = "saveConfig",
    ADD_MODELS_TO_STORE = "addModelsToStore",
    ADD_MODELS_TO_DB = "addModelsToDb",
    PROCESS_SCHEMA_FILES = "processSchemaFiles",
    IDLE = "idle"
}
export declare enum ClientManagerEvents {
    UPDATE_CONTEXT = "updateContext",
    PLATFORM_CLASSES_READY = "platformClassesReady",
    FILE_SYSTEM_READY = "fileSystemReady",
    DB_READY = "dbReady",
    SAVE_CONFIG_SUCCESS = "saveConfigSuccess",
    SAVE_APP_STATE_SUCCESS = "saveAppStateSuccess",
    SET_ADDRESSES = "setAddresses",
    ADD_MODELS_TO_STORE_SUCCESS = "addModelsToStoreSuccess",
    ADD_MODELS_TO_DB_SUCCESS = "addModelsToDbSuccess",
    PROCESS_SCHEMA_FILES_SUCCESS = "processSchemaFilesSuccess"
}
export declare enum GlobalState {
    UNINITIALIZED = "uninitialized",
    INITIALIZING = "initializing",
    INITIALIZED = "initialized",
    PUBLISHING_ITEM = "publishingItem",
    ADDING_MODELS_TO_DB = "addingModelsToDb"
}
export declare enum InternalState {
    IDLE = "idle",
    INITIALIZING = "initializing",
    VALIDATING_INPUT = "validatingInput",
    CONFIGURING_FS = "configuringFs",
    LOADING_SEED_DB = "loadingSeedDb",
    SAVING_CONFIG = "savingConfig",
    LOADING_APP_DB = "loadingAppDb",
    LOADING_SDK_DB = "loadingSdkDb"
}
export declare enum PublishMachineStates {
    VALIDATING_ITEM_DATA = "validatingItemData",
    CREATING_PUBLISH_ATTEMPT = "creatingPublishAttempt",
    UPLOADING = "uploading",
    PREPARING_PUBLISH_REQUEST_DATA = "preparingPublishRequestData",
    PUBLISHING = "publishing",
    IDLE = "idle"
}
export declare const INTERNAL_VALIDATING_INPUT_SUCCESS: string;
export declare const INTERNAL_CONFIGURING_FS_SUCCESS: string;
export declare const INTERNAL_CONFIGURING_FS_FAILURE: string;
export declare const INTERNAL_LOADING_SEED_DB_SUCCESS: string;
export declare const INTERNAL_LOADING_SEED_DB_FAILURE: string;
export declare const INTERNAL_LOADING_APP_DB_SUCCESS: string;
export declare const INTERNAL_LOADING_APP_DB_FAILURE: string;
export declare const INTERNAL_SAVING_CONFIG_SUCCESS: string;
export declare const INTERNAL_SAVING_CONFIG_FAILURE: string;
export declare const GLOBAL_GETTING_SEED_CLASS_SUCCESS: string;
export declare const GLOBAL_INITIALIZING_SEND_CONFIG: string;
export declare const GLOBAL_INITIALIZING_INTERNAL_SERVICE_READY: string;
export declare const GLOBAL_INITIALIZING_CREATE_ALL_ITEMS_SERVICES: string;
export declare const GLOBAL_ADDING_MODELS_TO_DB_SUCCESS: string;
export declare const CHILD_SNAPSHOT = "childSnapshot";
export declare const INTERNAL_SERVICE_SNAPSHOT = "internalServiceSnapshot";
export declare const BROWSER_FS_TOP_DIR = "app-files";
export declare const EAS_ENDPOINT: any;
/**
 * @deprecated Use BaseArweaveClient.getHost() instead.
 * This constant is kept for backward compatibility but will be removed in a future version.
 * Migration: import { BaseArweaveClient } from '@/helpers' and use BaseArweaveClient.getHost()
 */
export declare const ARWEAVE_HOST: any;
/**
 * @deprecated Use BaseArweaveClient.getEndpoint() instead.
 * This constant is kept for backward compatibility but will be removed in a future version.
 * Migration: import { BaseArweaveClient } from '@/helpers' and use BaseArweaveClient.getEndpoint()
 */
export declare const ARWEAVE_ENDPOINT: string;
//# sourceMappingURL=constants.d.ts.map
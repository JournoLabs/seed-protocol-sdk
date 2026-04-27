import { Endpoints, Environment } from './index';
import { ActorRefFrom } from 'xstate';
import { PublishRequestData } from './seedProtocol';
import { SchemaFileFormat } from './import';
import type { Model } from '@/Model/Model';
export type GlobalMachineContext = {
    isInitialized?: boolean;
    environment?: Environment;
    endpoints?: Endpoints;
    addresses?: string[];
    models?: {
        [key: string]: Model;
    };
    publishItemService?: ActorRefFrom<any>;
    arweaveDomain?: string;
    filesDir?: string;
};
export type PublishMachineContext = PublishRequestData & {
    status: string;
};
export type GetSchemaForModelEvent = {
    type: 'getSchemaForModel';
    modelName: string;
};
export type HydrateExistingItemEvent = {
    type: 'hydrateExistingItem';
    existingItem: any;
};
export type FromCallbackInput<T, P = undefined> = {
    context: T;
    event?: P;
};
export type ClientManagerContext = {
    isInitialized: boolean;
    addressesSet: boolean;
    isSaving: boolean;
    /** When true, successful save of app_state key `addresses` triggers an EAS sync via the orchestrator. */
    syncFromEasOnAddressChange?: boolean;
    endpoints?: Endpoints;
    addresses?: string[];
    ownedAddresses?: string[];
    watchedAddresses?: string[];
    models?: {
        [key: string]: Model;
    };
    schemas?: {
        [schemaName: string]: SchemaFileFormat;
    };
    arweaveDomain?: string;
    filesDir?: string;
    dbConfig?: import('@/types').DbConfig;
    schemaFile?: string;
    initError?: Error | string;
};
//# sourceMappingURL=machines.d.ts.map
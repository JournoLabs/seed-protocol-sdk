import type { AddressConfiguration } from '@/types';
import type { SyncFromEasOptions } from '@/events/item/syncDbWithEas';
type ModelDefObj = {
    name: string;
    type: string;
    properties: {
        [key: string]: any;
    };
};
export declare const clientManager: import("xstate").Actor<any>;
export declare const ClientManager: {
    isInitialized: () => any;
    getService: () => import("xstate").Actor<any>;
    init: (options: any) => Promise<void>;
    setAddresses: (addresses: AddressConfiguration) => Promise<void>;
    getAddresses: () => Promise<{
        owned: any;
        watched: any;
    }>;
    getOwnedAddresses: () => Promise<any>;
    getWatchedAddresses: () => Promise<any>;
    /**
     * Syncs item attestations from EAS for the configured models and given addresses.
     * Uses owned + watched addresses from DB when addresses are not provided.
     */
    syncFromEas: (options?: SyncFromEasOptions) => Promise<void>;
    addModel: (modelDef: ModelDefObj) => Promise<void>;
    onReady: (callback: () => void) => void;
    stop: () => void;
    unload: () => void;
};
export declare const getClient: () => {
    isInitialized: () => any;
    getService: () => import("xstate").Actor<any>;
    init: (options: any) => Promise<void>;
    setAddresses: (addresses: AddressConfiguration) => Promise<void>;
    getAddresses: () => Promise<{
        owned: any;
        watched: any;
    }>;
    getOwnedAddresses: () => Promise<any>;
    getWatchedAddresses: () => Promise<any>;
    /**
     * Syncs item attestations from EAS for the configured models and given addresses.
     * Uses owned + watched addresses from DB when addresses are not provided.
     */
    syncFromEas: (options?: SyncFromEasOptions) => Promise<void>;
    addModel: (modelDef: ModelDefObj) => Promise<void>;
    onReady: (callback: () => void) => void;
    stop: () => void;
    unload: () => void;
};
export {};
//# sourceMappingURL=ClientManager.d.ts.map
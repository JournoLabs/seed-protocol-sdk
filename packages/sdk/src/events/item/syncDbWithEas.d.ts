import { DebouncedFunc } from 'lodash-es';
export type SyncFromEasOptions = {
    /** Override addresses to sync. Default: owned + watched from DB. */
    addresses?: string[];
};
/**
 * Core sync logic: fetches item attestations from EAS for configured models and given addresses,
 * then saves seeds, versions, and properties to the local DB.
 * Uses owned + watched addresses from DB when addresses are not provided.
 */
export declare const runSyncFromEas: (options?: SyncFromEasOptions) => Promise<void>;
declare const syncDbWithEasHandler: DebouncedFunc<any>;
export { syncDbWithEasHandler };
//# sourceMappingURL=syncDbWithEas.d.ts.map
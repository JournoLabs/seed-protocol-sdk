import { ActorRefFrom } from 'xstate';
import { schemaMachine } from './service/schemaMachine';
import { Model } from '@/Model/Model';
import { Subscription } from 'rxjs';
type SchemaService = ActorRefFrom<typeof schemaMachine>;
export declare const schemaInstanceState: WeakMap<Schema, {
    liveQuerySubscription: Subscription | null;
    modelInstances?: Map<string, Model>;
}>;
/**
 * Options for Schema.all() method
 */
export interface SchemaAllOptions {
    /**
     * If true, returns all versions of each schema. If false (default), returns only the latest version of each schema.
     * @default false
     */
    includeAllVersions?: boolean;
    /**
     * If true, includes the internal Seed Protocol schema. If false (default), excludes it.
     * @default false
     */
    includeInternal?: boolean;
    /**
     * If true, wait for each schema to reach idle state before returning.
     * @default false
     */
    waitForReady?: boolean;
    /**
     * Timeout in ms for waiting for each schema to be ready (when waitForReady is true).
     * @default 5000
     */
    readyTimeout?: number;
}
export declare class Schema {
    protected static instanceCacheById: Map<string, {
        instance: Schema;
        refCount: number;
    }>;
    protected static instanceCacheByName: Map<string, {
        instance: Schema;
        refCount: number;
    }>;
    protected static savingSchemas: Set<string>;
    protected readonly _service: SchemaService;
    $schema?: string;
    version?: number;
    metadata?: {
        name: string;
        createdAt: string;
        updatedAt: string;
    };
    _models?: Model[];
    enums?: {
        [enumName: string]: any;
    };
    migrations?: Array<{
        version: number;
        timestamp: string;
        description: string;
        changes: any[];
    }>;
    constructor(schemaName: string);
    static create(schemaName: string, options?: {
        waitForReady?: false;
    }): Schema;
    static create(schemaName: string, options?: {
        waitForReady?: true;
        readyTimeout?: number;
    }): Promise<Schema>;
    /**
     * Update the cache to use schemaFileId as the key instead of schemaName
     * This should be called once the schema is loaded and we have the schemaFileId
     * We keep the instance in BOTH caches for efficient lookups by either name or ID
     */
    private static _updateCacheKey;
    /**
     * Get schema instance by schemaFileId (preferred method)
     * Returns null if not found in cache
     */
    static getById(schemaFileId: string): Schema | null;
    /**
     * Clear all cached Schema instances.
     * This is primarily useful for test cleanup.
     * All cached instances will be unloaded and removed from both caches.
     */
    static clearCache(): void;
    /**
     * Create or get schema instance by schemaFileId
     * Queries the database to find the schema name if not cached
     * @param schemaFileId - The schema file ID
     * @returns Schema instance
     */
    static createById(schemaFileId: string): Promise<Schema>;
    /**
     * Find schema instance by schemaFileId
     * Waits for the schema to be fully loaded (idle state) by default
     * @param options - Find options including schemaFileId and wait configuration
     * @returns Schema instance if found, undefined otherwise
     */
    static find({ schemaFileId, waitForReady, readyTimeout, }: {
        schemaFileId: string;
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<Schema | undefined>;
    /**
     * Get instantiated Schema objects for all schemas (from database and files)
     * By default, returns only the latest version of each schema and excludes the internal Seed Protocol schema.
     * Uses loadAllSchemasFromDb() as the single source of truth, which intelligently merges database and file data.
     *
     * @param options - Configuration options
     * @param options.includeAllVersions - If true, returns all versions of each schema. Default: false
     * @param options.includeInternal - If true, includes the internal Seed Protocol schema. Default: false
     * @returns Array of Schema instances
     */
    static all(options?: SchemaAllOptions): Promise<Schema[]>;
    getService(): SchemaService;
    private _getSnapshot;
    private _getSnapshotContext;
    get schemaName(): string;
    get schemaFileId(): string | undefined;
    get id(): string | undefined;
    /**
     * Returns Model instances for this schema
     * This is a computed property that reads from the service context
     * Note: This is NOT reactive - use useModels() hook for reactivity
     */
    get models(): Model[];
    get status(): "error" | "idle" | "addingModels" | "validating" | {
        loading: "checkingExisting" | "writingSchema" | "verifyingSchema" | "writingModels" | "verifyingModels" | "creatingModelInstances" | "verifyingModelInstances" | "writingProperties" | "verifyingProperties" | "creatingPropertyInstances" | "verifyingPropertyInstances";
    };
    get isEdited(): boolean;
    get validationErrors(): ValidationError[];
    get isValid(): boolean;
    /**
     * Validate the schema
     * @returns Validation result
     */
    validate(): Promise<{
        isValid: boolean;
        errors: any[];
    }>;
    /**
     * Build models object from Model instances (for persistence)
     * Model instances are the source of truth for model data
     */
    private _buildModelsFromInstances;
    /**
     * Saves all edited properties to a new schema version.
     * This writes the changes to a new JSON file and clears the draft flags.
     * Validates the schema before saving.
     * Transitions schema from draft (DB-only) to published (file + DB).
     * @returns The file path of the new schema version
     */
    saveNewVersion(): Promise<string>;
    /**
     * Check for conflicts between actor context and database
     * @returns ConflictResult indicating if a conflict exists
     */
    private _checkForConflicts;
    /**
     * Reload schema from database
     * This refreshes the actor context with the latest data from the database
     */
    reload(): Promise<void>;
    /**
     * Save the current schema state to the database as a draft
     * This persists changes immediately without creating a new file version
     * @param oldName - Optional old name to look up existing record before name change
     * @param newName - Optional new name to use (if not provided, uses this.schemaName)
     */
    private _saveDraftToDb;
    unload(): void;
    /**
     * Destroy the schema instance completely: remove from caches, delete from database (cascade),
     * and stop the service. Uses shared destroy helpers.
     */
    destroy(): Promise<void>;
    /**
     * Set up liveQuery subscription to watch for model changes in the database
     * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
     */
    private _setupLiveQuerySubscription;
}
export {};
//# sourceMappingURL=Schema.d.ts.map
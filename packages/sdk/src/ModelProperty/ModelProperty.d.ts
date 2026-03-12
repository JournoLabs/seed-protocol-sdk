import { ActorRefFrom } from 'xstate';
import { Static } from '@sinclair/typebox';
import { ModelPropertyDataTypes, TProperty } from '@/Schema';
import { modelPropertyMachine, ModelPropertyMachineContext } from './service/modelPropertyMachine';
import { StorageType } from '@/types';
type ModelPropertyService = ActorRefFrom<typeof modelPropertyMachine>;
export declare class ModelProperty {
    protected static instanceCache: Map<string, {
        instance: ModelProperty;
        refCount: number;
    }>;
    private static pendingWrites;
    protected readonly _service: ModelPropertyService;
    name?: string;
    dataType?: ModelPropertyDataTypes;
    ref?: string;
    modelId?: number;
    modelName?: string;
    refModelId?: number;
    refModelName?: string;
    refValueType?: ModelPropertyDataTypes;
    storageType?: StorageType;
    localStorageDir?: string;
    filenameSuffix?: string;
    constructor(property: Static<typeof TProperty>);
    /**
     * Initialize original values and schema name for tracking changes
     * This is called asynchronously after construction
     * If the property was loaded from the database and differs from the schema file,
     * it will be marked as edited.
     */
    private _initializeOriginalValues;
    /**
     * Load isEdited flag from database if property exists in DB
     * @param property - The property data
     * @param fallbackIsEdited - Fallback value if property doesn't exist in DB
     * @returns The isEdited flag from database or fallback value
     */
    private _loadIsEditedFromDb;
    /**
     * Resolve refModelId from refModelName by querying the database
     * @param refModelName - The name of the referenced model
     * @returns The database ID of the referenced model, or undefined if not found
     */
    private _resolveRefModelId;
    /**
     * Get schema file values for this property to use as "original" values
     * This allows comparison with database values to detect edits
     */
    private _getSchemaFileValues;
    /**
     * Set the schema name for this property by looking it up from the model
     * Tries database first (more reliable), then falls back to schema files
     */
    private _setSchemaName;
    /**
     * Resolve schema name from DB when _schemaName is missing (e.g. destroy ran before _setSchemaName finished).
     * Uses context.id (schemaFileId) and context.modelId to query properties → model_schemas → schemas.
     */
    private _resolveSchemaNameForDestroy;
    /**
     * Manually set the schema name for this property
     * Useful when you know the schema name from context (e.g., when working with Schema instances)
     */
    setSchemaName(schemaName: string): void;
    static create(property: Static<typeof TProperty>, options?: {
        waitForReady?: false;
        schemaName?: string;
    }): ModelProperty;
    static create(property: Static<typeof TProperty>, options?: {
        waitForReady?: true;
        readyTimeout?: number;
        schemaName?: string;
    }): Promise<ModelProperty>;
    /**
     * Get ModelProperty instance by propertyFileId from static cache
     */
    static getById(propertyFileId: string): ModelProperty | undefined;
    /**
     * Create or get ModelProperty instance by propertyFileId
     * Queries the database to find the property if not cached
     */
    static createById(propertyFileId: string): Promise<ModelProperty | undefined>;
    /**
     * Find ModelProperty instance by propertyFileId
     * Waits for the property to be fully loaded (idle state) by default
     * @param options - Find options including propertyFileId and wait configuration
     * @returns ModelProperty instance if found, undefined otherwise
     */
    static find({ propertyFileId, waitForReady, readyTimeout, }: {
        propertyFileId: string;
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<ModelProperty | undefined>;
    /**
     * Get all ModelProperty instances for a model.
     * Loads property rows from DB for the given modelFileId, creates instances via createById, optionally waits for idle.
     */
    static all(modelFileId: string, options?: {
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<ModelProperty[]>;
    /**
     * Track a pending write for a property
     */
    static trackPendingWrite(propertyFileId: string, modelId: number): void;
    /**
     * Clear or update pending write status
     */
    static clearPendingWrite(propertyFileId: string, status?: 'success' | 'error'): void;
    /**
     * Get all pending property IDs for a model
     */
    static getPendingPropertyIds(modelId: number): string[];
    /**
     * Get modelId for a property that has a pending write (row may not be in DB yet).
     * Used to resolve modelName when validating a just-created property rename.
     */
    static getPendingModelId(propertyFileId: string): number | undefined;
    getService(): ModelPropertyService;
    private _getSnapshot;
    _getSnapshotContext(): ModelPropertyMachineContext;
    get path(): string | undefined;
    get status(): "idle" | "validating" | "compareAndMarkDraft" | {
        saveToSchema: "saving";
    };
    get isEdited(): any;
    get validationErrors(): any;
    get isValid(): boolean;
    /**
     * Validate the property
     * @returns Validation result
     */
    validate(): Promise<{
        isValid: boolean;
        errors: any[];
    }>;
    save(): void;
    /**
     * Reload property from database
     * This refreshes the actor context with the latest data from the database
     * Note: ModelProperty doesn't have a dedicated load actor, so this will
     * re-initialize from the current property data
     */
    reload(): Promise<void>;
    unload(): void;
    /**
     * Destroy the model property: remove from caches, delete from database, update Schema context, stop service.
     */
    destroy(): Promise<void>;
}
export {};
//# sourceMappingURL=ModelProperty.d.ts.map
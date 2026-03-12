import { ActorRefFrom } from 'xstate';
import { modelMachine, ModelMachineContext } from './service/modelMachine';
import { Item } from '@/Item/Item';
import { ItemData } from '@/types/item';
type ModelService = ActorRefFrom<typeof modelMachine>;
export declare class Model {
    protected static instanceCacheById: Map<string, // modelFileId
    {
        instance: Model;
        refCount: number;
    }>;
    protected static instanceCacheByName: Map<string, // "schemaName:modelName"
    string>;
    protected static instanceCache: Map<string, {
        instance: Model;
        refCount: number;
    }>;
    private static pendingWrites;
    protected static savingModels: Set<string>;
    private static cachedClientInitialized;
    private static clientCheckTime;
    private static readonly CLIENT_CHECK_CACHE_MS;
    static trackPendingWrite(modelFileId: string, schemaId: number): void;
    static getPendingModelIds(schemaId: number): string[];
    protected readonly _service: ModelService;
    modelName?: string;
    schemaName?: string;
    _properties?: any[];
    constructor(modelName: string, schemaName: string, id?: string, // schemaFileId (string) - public ID
    initialContext?: Pick<ModelMachineContext, '_pendingPropertyDefinitions'>, idFromSchema?: boolean);
    /**
     * Find a unique model name by checking for duplicates (case-insensitive) in the cache
     * If duplicates are found, appends an incrementing number to make it unique
     *
     * @param modelName - The desired model name
     * @param schemaName - The schema name
     * @param skipAllChecks - If true, skip all duplicate checks and return original name (used when creating schema models to preserve original names)
     * @returns A unique model name
     */
    static findUniqueModelName(modelName: string, schemaName: string, skipAllChecks?: boolean): string;
    /**
     * Create a new Model instance or return existing cached instance
     *
     * @param modelName - The name of the model
     * @param schemaNameOrSchema - The schema name (string) or Schema instance
     * @param options - Optional configuration (can be omitted to create model with empty properties):
     *   - modelFileId: Pre-existing model file ID
     *   - properties: Model properties definition (defaults to empty object if not provided)
     *   - registerWithSchema: Whether to automatically register this model with its schema (default: true if schema instance provided)
     *
     * @example
     * // Create model with empty properties
     * const model = Model.create('MyModel', schema)
     *
     * @example
     * // Create model with properties
     * const model = Model.create('MyModel', schema, {
     *   properties: { title: { dataType: 'String' } }
     * })
     */
    static create(modelName: string, schemaNameOrSchema: string | any, // Schema type - using any to avoid circular dependency
    options?: {
        id?: string;
        modelFileId?: string;
        properties?: {
            [propertyName: string]: any;
        };
        registerWithSchema?: boolean;
        waitForReady?: false;
    }): Model;
    static create(modelName: string, schemaNameOrSchema: string | any, options?: {
        id?: string;
        modelFileId?: string;
        properties?: {
            [propertyName: string]: any;
        };
        registerWithSchema?: boolean;
        waitForReady?: true;
        readyTimeout?: number;
    }): Promise<Model>;
    /**
     * Get Model instance by modelFileId (O(1) lookup)
     */
    static getById(modelFileId: string): Model | undefined;
    /**
     * Get Model instance by name (O(1) lookup via name→ID mapping)
     *
     * @param modelName - The name of the model
     * @param schemaName - The schema name (optional, will query DB if not provided)
     * @returns The Model instance if found, undefined otherwise
     */
    static getByName(modelName: string, schemaName?: string): Model | undefined;
    /**
     * Find Model by modelType (snake_case from DB/metadata).
     * Handles model names with spaces: "new_model" -> finds "New model" (toSnakeCase("New model") === "new_model").
     */
    static findByModelType(modelType: string): Model | undefined;
    /**
     * Get all Model instances for a schema from cache only (synchronous).
     * Includes models created at runtime via Model.create() that may not yet be in schema context.
     */
    static getCachedInstancesForSchema(schemaName: string): Model[];
    /**
     * Get Model instance by name, querying database if not in cache
     * This is an async version that can query the database when schemaName is not provided
     *
     * @param modelName - The name of the model
     * @param schemaName - Optional schema name (will query DB if not provided)
     * @returns The Model instance if found, undefined otherwise
     */
    static getByNameAsync(modelName: string, schemaName?: string): Promise<Model | undefined>;
    /**
     * Create or get Model instance by modelFileId
     * Checks cache first, then database if not found
     *
     * @param modelFileId - The model file ID to look up
     * @returns The Model instance if found, undefined otherwise
     */
    static createById(modelFileId: string): Promise<Model | undefined>;
    /**
     * Find Model instance by modelFileId, modelName/schemaName, or both
     * Waits for the model to be fully loaded (idle state) by default
     * @param options - Find options including lookup parameters and wait configuration
     * @returns Model instance if found, undefined otherwise
     */
    static find({ modelFileId, modelName, schemaName, waitForReady, readyTimeout, }: {
        modelFileId?: string;
        modelName?: string;
        schemaName?: string;
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<Model | undefined>;
    /**
     * Get all Model instances for a schema by schemaFileId or schemaName
     * Queries database for all models with the given schemaId/schemaName and returns Model instances
     *
     * @param schemaIdentifier - The schema file ID or schema name to get models for
     * @returns Array of Model instances for the schema
     */
    static createBySchemaId(schemaIdentifier: string): Promise<Model[]>;
    /**
     * Get all Model instances, optionally filtered by schema.
     * When DB is available, loads from DB via getModelsData; otherwise returns from cache.
     * Supports waitForReady to wait for each model to reach idle state before returning.
     */
    static all(schemaName?: string, options?: {
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<Model[]>;
    /**
     * Update name index when model name changes
     */
    static updateNameIndex(oldName: string, newName: string, schemaName: string, modelFileId: string): void;
    getService(): ModelService;
    private _getSnapshot;
    private _getSnapshotContext;
    /**
     * Check for conflicts between actor context and database
     * @returns ConflictResult indicating if a conflict exists
     */
    private _checkForConflicts;
    /**
     * Saves model name changes to the database immediately (draft save)
     * This is called when modelName is changed to persist the change immediately
     * @param oldName - The old model name (if name changed)
     * @param newName - The new model name
     */
    private _saveDraftToDb;
    get status(): "error" | "loading" | "idle" | "validating" | "creatingProperties";
    get validationErrors(): ValidationError[];
    get isValid(): boolean;
    get isEdited(): boolean;
    get id(): string | undefined;
    get name(): string;
    /**
     * Returns ModelProperty instances for this model
     * This is a computed property that reads from the service context
     * Note: This is NOT reactive - use useModelProperties() hook for reactivity
     */
    get properties(): any[];
    /**
     * Validate the model
     * @returns Validation result
     */
    validate(): Promise<{
        isValid: boolean;
        errors: any[];
    }>;
    /**
     * Create a new item instance from this model
     * Automatically injects the model name, so you don't need to pass it explicitly.
     *
     * @example
     * const Post = Model.create('Post', schema)
     * const post = await Post.create({ title: 'My Post', content: '...' })
     *
     * @param values - Item property values (modelName is automatically injected)
     * @returns The created item instance
     */
    create(values: Partial<ItemData> & Record<string, any>): Promise<Item<any>>;
    /**
     * Reload model from database
     * This refreshes the actor context with the latest data from the database
     */
    reload(): Promise<void>;
    /**
     * Unload the model instance and clean up resources
     */
    unload(): void;
    /**
     * Destroy the model instance completely: remove from caches, delete from database,
     * update Schema context, stop service. Uses shared destroy helpers.
     */
    destroy(): Promise<void>;
    /**
     * Set up liveQuery subscription to watch for property changes in the database
     * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
     */
    private _setupLiveQuerySubscription;
    /**
     * Refresh property IDs from database (useful in Node.js where liveQuery isn't available)
     */
    private _refreshPropertiesFromDb;
    /**
     * Public method to refresh properties from database
     */
    refreshProperties(): Promise<void>;
}
export {};
//# sourceMappingURL=Model.d.ts.map
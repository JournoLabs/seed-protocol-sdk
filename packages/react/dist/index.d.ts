import { ActorRef } from 'xstate';
import { ClientManagerState } from '@seedprotocol/sdk';
import { default as default_2 } from 'react';
import { DefaultOptions } from '@tanstack/react-query';
import { EventObject } from 'xstate';
import { IItem } from '@seedprotocol/sdk';
import { IItemProperty } from '@seedprotocol/sdk';
import { Item } from '@seedprotocol/sdk';
import { JSX } from 'react/jsx-runtime';
import { Model } from '@seedprotocol/sdk';
import { ModelProperty } from '@seedprotocol/sdk';
import { ModelValues } from '@seedprotocol/sdk';
import { QueryClient } from '@tanstack/react-query';
import { QueryClientConfig } from '@tanstack/react-query';
import { QueryObserverResult } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { RefetchOptions } from '@tanstack/react-query';
import { Schema } from '@seedprotocol/sdk';

/**
 * Creates a QueryClient configured with Seed's default options.
 * Use this when you want to provide your own QueryClientProvider but still use Seed's defaults.
 *
 * @param overrides - Optional config to merge with Seed defaults (e.g. defaultOptions, logger).
 */
export declare function createSeedQueryClient(overrides?: Partial<QueryClientConfig>): QueryClient;

export declare const FILES_QUERY_KEY_PREFIX: readonly ["seed", "files"];

/**
 * Returns the default options used by Seed for list-query caching.
 * Use this when building your own QueryClient so Seed hooks get consistent behavior.
 */
export declare function getSeedQueryDefaultOptions(): DefaultOptions;

export declare const getServiceName: (service: ActorRef<any, any>) => string;

export declare const getServiceUniqueKey: (service: ActorRef<any, any>) => any;

export declare const getServiceValue: (service: ActorRef<any, any>) => string | undefined;

/**
 * Invalidates and refetches the item-properties query for an item.
 * Call this after updating an ItemProperty (e.g. after save()) so useItemProperties
 * refetches and the UI updates. Returns a Promise that resolves when the refetch has completed (if available).
 */
export declare function invalidateItemPropertiesForItem(canonicalId: string): Promise<void>;

/**
 * Merges Seed's default query options with your existing default options.
 * Your options take precedence over Seed's. Use when constructing your own QueryClient:
 *
 * @example
 * ```ts
 * const client = new QueryClient({
 *   defaultOptions: mergeSeedQueryDefaults({
 *     queries: { gcTime: 1000 * 60 * 60 },
 *   }),
 * })
 * ```
 */
export declare function mergeSeedQueryDefaults(userOptions?: Partial<DefaultOptions> | null): DefaultOptions;

/**
 * Provider that supplies a React Query client to Seed list hooks (useSchemas, useItems, useModels, etc.)
 * so results are cached and shared across components. Wrap your app (or the subtree that uses Seed hooks)
 * after calling client.init().
 *
 * - No props: uses an internal QueryClient with Seed defaults.
 * - queryClient prop: use your own client (e.g. merge getSeedQueryDefaultOptions when creating it).
 */
export declare function SeedProvider({ children, queryClient: queryClientProp, queryClientRef }: SeedProviderProps): JSX.Element;

export declare type SeedProviderProps = {
    children: ReactNode;
    /** Optional: use your own QueryClient. If not provided, a default client with Seed options is created. */
    queryClient?: QueryClient;
    /** Optional: ref to receive the QueryClient instance (e.g. for tests). */
    queryClientRef?: default_2.MutableRefObject<QueryClient | null>;
};

export declare const useAllSchemaVersions: () => Schema[] | null | undefined;

export declare const useCreateItem: () => UseCreateItemReturn;

/**
 * Hook to create an ItemProperty with loading and error state.
 * create(props) creates a new property instance for an item; provide seedLocalId or seedUid, propertyName, and modelName.
 */
export declare const useCreateItemProperty: () => UseCreateItemPropertyReturn;

export declare type UseCreateItemPropertyProps = {
    seedLocalId?: string;
    seedUid?: string;
    propertyName: string;
    modelName: string;
    propertyValue?: any;
    versionLocalId?: string;
    versionUid?: string;
    [key: string]: any;
};

export declare type UseCreateItemPropertyReturn = {
    create: (props: UseCreateItemPropertyProps) => IItemProperty | undefined;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

export declare type UseCreateItemReturn = {
    createItem: (modelName: string, itemData?: Record<string, any>) => Promise<Item<any> | undefined>;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

export declare const useCreateModel: () => UseCreateModelReturn;

declare type UseCreateModelOptions = {
    modelFileId?: string;
    properties?: {
        [propertyName: string]: any;
    };
    registerWithSchema?: boolean;
};

/**
 * Hook to create a ModelProperty with loading and error state.
 * create(schemaId, modelName, property) creates a new property on the model.
 */
export declare const useCreateModelProperty: () => UseCreateModelPropertyReturn;

export declare type UseCreateModelPropertyOptions = {
    name: string;
    dataType: string;
    [key: string]: any;
};

export declare type UseCreateModelPropertyReturn = {
    create: (schemaId: string, modelName: string, property: UseCreateModelPropertyOptions) => ModelProperty;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

declare type UseCreateModelReturn = {
    create: (schemaName: string, modelName: string, options?: UseCreateModelOptions) => Model;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

export declare const useCreateSchema: () => {
    createSchema: (schemaName: string) => Schema;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

export declare const useDbsAreReady: () => {
    dbsAreReady: boolean;
};

export declare const useDeleteItem: () => UseDeleteItemReturn;

declare type UseDeleteItemReturn = {
    deleteItem: (item: Item<any>) => Promise<void>;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

export declare const useDestroyItemProperty: () => UseDestroyItemPropertyReturn;

export declare type UseDestroyItemPropertyReturn = {
    destroy: (itemProperty: IItemProperty) => Promise<void>;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

export declare const useDestroyModel: () => UseDestroyModelReturn;

export declare const useDestroyModelProperty: () => UseDestroyModelPropertyReturn;

export declare type UseDestroyModelPropertyReturn = {
    destroy: (modelProperty: ModelProperty) => Promise<void>;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

declare type UseDestroyModelReturn = {
    destroy: (model: Model) => Promise<void>;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

export declare const useDestroySchema: () => UseDestroySchemaReturn;

export declare type UseDestroySchemaReturn = {
    destroy: (schema: Schema) => Promise<void>;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

/**
 * Returns an up-to-date list of filenames stored in the given directory.
 * Automatically refetches when files are saved (file-saved) or after bulk downloads (fs.downloadAll.success).
 *
 * Must be used within SeedProvider and after client.init().
 *
 * @param dir - Directory name under the files root (e.g. 'files', 'images'). Default: 'files'.
 *
 * @example
 * ```tsx
 * const { files, isLoading, error, refetch } = useFiles('files')
 * // files: ['document.pdf', 'contract.docx']
 * ```
 */
export declare function useFiles(dir?: string): {
    files: string[];
    isLoading: boolean;
    error: Error | null;
    refetch: (options?: RefetchOptions) => Promise<QueryObserverResult<string[], Error>>;
};

export declare const useGlobalServiceStatus: () => {
    status: ClientManagerState;
    internalStatus: string;
};

export declare const useHasSavedSnapshots: () => boolean;

/**
 * Returns an up-to-date list of image filenames stored in the file system (OPFS in browser).
 * Automatically refetches when images are saved (file-saved) or after bulk downloads (fs.downloadAll.success).
 *
 * Must be used within SeedProvider and after client.init().
 *
 * @example
 * ```tsx
 * const { imageFiles, isLoading, error, refetch } = useImageFiles()
 * // imageFiles: ['photo.jpg', 'cover.png']
 * ```
 */
export declare function useImageFiles(): {
    imageFiles: string[];
    isLoading: boolean;
    error: Error | null;
    refetch: (options?: RefetchOptions) => Promise<QueryObserverResult<string[], Error>>;
};

export declare const useIsDbReady: () => boolean;

declare type UseItem = <T extends ModelValues<T>>(props: UseItemProps) => UseItemReturn<T>;

export declare const useItem: UseItem;

/**
 * Hook to get all ItemProperty instances for a specific item
 * Can be called in multiple ways:
 * 1. With seedLocalId: useItemProperties({ seedLocalId })
 * 2. With seedUid: useItemProperties({ seedUid })
 * 3. With itemId: useItemProperties(itemId)
 *
 * Uses useLiveQuery to watch for changes in the metadata table and automatically
 * updates the returned ItemProperty instances when changes occur.
 *
 * @overload@overload
 * @param props - Object with seedLocalId or seedUid
 * @returns Object with properties array, isLoading, and error
 *
 * @overload@overload
 * @param itemId - The item ID (seedLocalId or seedUid)
 * @returns Object with properties array, isLoading, and error
 */
export declare function useItemProperties(props: {
    seedLocalId?: string;
    seedUid?: string;
}): UseItemPropertiesReturn;

export declare function useItemProperties(itemId: string): UseItemPropertiesReturn;

declare type UseItemPropertiesReturn = {
    properties: IItemProperty[];
    isLoading: boolean;
    error: Error | null;
};

/**
 * Hook to get a specific ItemProperty instance
 * Can be called in multiple ways:
 * 1. With seedLocalId/seedUid and propertyName: useItemProperty({ seedLocalId, propertyName }) or useItemProperty({ seedUid, propertyName })
 * 2. With itemId and propertyName: useItemProperty(itemId, propertyName) or useItemProperty({ itemId, propertyName })
 *
 * @overload@overload
 * @param props - Object with seedLocalId or seedUid, and propertyName
 * @returns Object with property, isLoading, and error
 *
 * @overload@overload
 * @param props - Object with itemId and propertyName
 * @returns Object with property, isLoading, and error
 *
 * @overload@overload
 * @param itemId - The item ID (seedLocalId or seedUid)
 * @param propertyName - The name of the property
 * @returns Object with property, isLoading, and error
 */
export declare function useItemProperty(props: {
    seedLocalId?: string;
    seedUid?: string;
    propertyName: string;
}): UseItemPropertyReturn;

export declare function useItemProperty(props: {
    itemId?: string;
    propertyName: string;
}): UseItemPropertyReturn;

export declare function useItemProperty(itemId: string, propertyName: string): UseItemPropertyReturn;

declare type UseItemPropertyReturn = {
    property: IItemProperty | undefined;
    isLoading: boolean;
    error: Error | null;
};

declare type UseItemProps = {
    modelName: string;
    seedLocalId?: string;
    seedUid?: string;
};

declare type UseItemReturn<T extends ModelValues<T>> = {
    item: IItem<T> | undefined;
    isLoading: boolean;
    error: Error | null;
};

declare type UseItems = (props: UseItemsProps) => UseItemsReturn;

export declare const useItems: UseItems;

declare type UseItemsProps = {
    modelName?: string;
    deleted?: boolean;
    includeEas?: boolean;
    addressFilter?: 'owned' | 'watched' | 'all';
};

declare type UseItemsReturn = {
    items: IItem<any>[];
    isLoading: boolean;
    error: Error | null;
};

/**
 * Hook to execute a reactive query that emits new results whenever the underlying data changes.
 *
 * Supports two usage patterns:
 * 1. SQL tag function: useLiveQuery((sql) => sql`SELECT * FROM models`)
 * 2. Drizzle query builder: useLiveQuery(db.select().from(models))
 *
 * @param query - SQL query function or Drizzle query builder, or null/undefined to disable the query
 * @returns Array of query results, or undefined if not yet loaded
 *
 * @example
 * ```typescript
 * // Using SQL tag function
 * const models = useLiveQuery<ModelRow>(
 *   (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
 * )
 *
 * // Using Drizzle query builder
 * import { models } from '@seedprotocol/sdk'
 * import { eq } from 'drizzle-orm'
 *
 * const appDb = BaseDb.getAppDb()
 * const models = useLiveQuery<ModelRow>(
 *   appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
 * )
 * ```
 */
export declare function useLiveQuery<T>(query: ((sql: any) => any) | any | null | undefined): T[] | undefined;

/**
 * Hook to get a specific Model instance
 * Can be called in two ways:
 * 1. With schemaId and modelName: useModel(schemaId, modelName)
 * 2. With modelId: useModel(modelId)
 *
 * @param schemaIdOrModelId - The schema ID (schema file ID) OR the model ID (modelFileId)
 * @param modelName - The name of the model to retrieve (required if first param is schemaId)
 * @returns Object with model, isLoading, and error
 */
export declare const useModel: (schemaIdOrModelId: string | null | undefined, modelName?: string | null | undefined) => UseModelResult;

/**
 * Hook to get all ModelProperty instances for a specific model
 * Can be called in two ways:
 * 1. With schemaId and modelName: useModelProperties(schemaId, modelName)
 * 2. With modelId: useModelProperties(modelId)
 *
 * Uses useLiveQuery to watch for changes in the properties table and automatically
 * updates the returned ModelProperty instances when changes occur.
 *
 * @param schemaIdOrModelId - The schema ID (schema file ID) OR the model ID (modelFileId)
 * @param modelName - The name of the model to get properties from (required if first param is schemaId)
 * @returns Object with modelProperties array, isLoading, and error
 */
export declare const useModelProperties: (schemaIdOrModelId: string | null | undefined, modelName?: string | null | undefined) => UseModelPropertiesResult;

declare type UseModelPropertiesResult = {
    modelProperties: ModelProperty[];
    isLoading: boolean;
    error: Error | null;
};

/**
 * Hook to get a specific ModelProperty instance
 * Can be called in three ways:
 * 1. With propertyFileId: useModelProperty(propertyFileId)
 * 2. With modelFileId and propertyName: useModelProperty(modelFileId, propertyName)
 * 3. With schemaId, modelName, and propertyName: useModelProperty(schemaId, modelName, propertyName)
 *
 * @overload@overload
 * @param propertyFileId - The property file ID (schemaFileId)
 * @returns Object with modelProperty, isLoading, and error
 *
 * @overload@overload
 * @param modelFileId - The model file ID (modelFileId)
 * @param propertyName - The name of the property
 * @returns Object with modelProperty, isLoading, and error
 *
 * @overload@overload
 * @param schemaId - The schema ID (schema file ID)
 * @param modelName - The name of the model
 * @param propertyName - The name of the property
 * @returns Object with modelProperty, isLoading, and error
 */
export declare function useModelProperty(propertyFileId: string): {
    modelProperty: ModelProperty | undefined;
    isLoading: boolean;
    error: Error | null;
};

export declare function useModelProperty(modelFileId: string, propertyName: string): {
    modelProperty: ModelProperty | undefined;
    isLoading: boolean;
    error: Error | null;
};

export declare function useModelProperty(schemaId: string, modelName: string, propertyName: string): {
    modelProperty: ModelProperty | undefined;
    isLoading: boolean;
    error: Error | null;
};

declare type UseModelResult = {
    model: Model | undefined;
    isLoading: boolean;
    error: Error | null;
};

declare type UseModels = (schemaId: UseModelsParams) => UseModelsResult;

export declare const useModels: UseModels;

declare type UseModelsParams = string | null | undefined;

declare type UseModelsResult = {
    models: Model[];
    isLoading: boolean;
    error: Error | null;
};

export declare const usePersistedSnapshots: () => void;

export declare const usePublishItem: () => UsePublishItemReturn;

declare type UsePublishItemReturn = {
    publishItem: (item: Item<any> | undefined) => void;
    isLoading: boolean;
    error: Error | null;
    resetError: () => void;
};

/**
 * Hook to get a Schema class instance (with setters) that is reactive
 * This allows you to edit schema properties directly like: schema.name = 'New name'
 * The schema instance uses a Proxy to ensure React re-renders when properties change
 * @param schemaIdentifier - The name of the schema or the schema file ID
 *   - If a name is provided, retrieves the latest version with that name
 *   - If an ID is provided, retrieves the specific schema by ID
 * @returns Object with schema instance
 */
export declare const useSchema: (schemaIdentifier: string | null | undefined) => {
    schema: Schema | null;
    isLoading: boolean;
    error: Error | null;
};

export declare const useSchemas: () => {
    schemas: Schema[];
    isLoading: boolean;
    error: Error | null;
};

/**
 * Hook to get the internal Seed Protocol schema (SDK-only schema)
 * This schema is managed by the SDK and should not be edited by app developers
 * @returns Object with schema instance and schemaData (version, metadata, etc.)
 */
export declare const useSeedProtocolSchema: () => {
    schema: Schema | null;
    isLoading: boolean;
    error: Error | null;
};

export declare const useService: (service: ActorRef<any, any>) => {
    name: string;
    timeElapsed: number;
    value: string | undefined;
    percentComplete: number;
    uniqueKey: any;
};

export declare const useServices: () => {
    services: ActorRef<any, any, EventObject>[];
    percentComplete: number;
};

export { }

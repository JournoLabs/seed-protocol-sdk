import { IItem, IItemProperty } from '@/interfaces';
import { itemMachineSingle } from '@/Item/service/itemMachineSingle';
import { VersionsType } from '@/seedSchema';
import { CreatePropertyInstanceProps, ItemData, ItemFindProps, ModelSchema, ModelValues, NewItemProps, PropertyData } from '@/types';
import type { CreateWaitOptions } from '@/types';
import { BehaviorSubject } from 'rxjs';
import { ActorRefFrom, Subscription } from 'xstate';
export declare class Item<T extends ModelValues<ModelSchema>> implements IItem<T> {
    protected static instanceCache: Map<string, {
        instance: Item<any>;
        refCount: number;
    }>;
    protected _subscription: Subscription | undefined;
    protected readonly _storageTransactionId: string | undefined;
    protected _propertiesSubject: BehaviorSubject<Record<string, IItemProperty>>;
    protected readonly _service: ActorRefFrom<typeof itemMachineSingle>;
    constructor(initialValues: NewItemProps<T>);
    static create<T extends ModelValues<ModelSchema>>(props: Partial<ItemData> & {
        modelInstance?: import('@/Model/Model').Model;
    }, options?: CreateWaitOptions): Promise<Item<any>>;
    /**
     * Get Item instance by ID from cache
     * The ID can be either seedUid or seedLocalId
     * @param id - seedUid or seedLocalId
     * @returns Cached Item instance or null if not found
     */
    static getById(id: string): Item<any> | null;
    /**
     * Create Item instance by ID (queries database if not in cache)
     * The ID can be either seedUid or seedLocalId
     * @param id - seedUid or seedLocalId
     * @param modelName - Optional model name for querying
     * @returns Item instance or undefined if not found
     */
    static createById(id: string, modelName?: string): Promise<Item<any> | undefined>;
    static find({ modelName, seedLocalId, seedUid, waitForReady, readyTimeout, }: ItemFindProps & {
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<IItem<any> | undefined>;
    static all(modelName?: string, deleted?: boolean, options?: {
        waitForReady?: boolean;
        readyTimeout?: number;
        includeEas?: boolean;
        addressFilter?: 'owned' | 'watched' | 'all';
    }): Promise<Item<any>[]>;
    protected _createPropertyInstance(props: Partial<CreatePropertyInstanceProps>): void;
    /**
     * Defines a property accessor on this Item that delegates get/set to the
     * ItemProperty in context.propertyInstances at access time (so the correct
     * instance is used after loadOrCreateItemSuccess merges DB-backed instances).
     */
    protected _definePropertyAccessor(propertyName: string): void;
    static publish(item: IItem<any>): Promise<void>;
    subscribe: (callback: (itemProps: any) => void) => Subscription;
    getService: () => ActorRefFrom<typeof itemMachineSingle>;
    getEditedProperties: () => Promise<PropertyData[]>;
    publish: () => Promise<void>;
    unpublish: () => Promise<void>;
    getPublishUploads: (
        options?: import("../db/read/getPublishUploads").GetPublishUploadsOptions,
    ) => Promise<PublishUpload[]>;
    getPublishPayload: (
        uploadedTransactions: any[],
        options?: import("../db/read/getPublishPayload").GetPublishPayloadOptions,
    ) => Promise<{
        localId: string;
        seedIsRevocable: boolean;
        seedSchemaUid: string;
        seedUid: string;
        versionSchemaUid: string;
        versionUid: string;
        listOfAttestations: (Omit<import("@ethereum-attestation-service/eas-sdk").AttestationRequest, "data"> & {
            data: import("@ethereum-attestation-service/eas-sdk").AttestationRequestData[];
            _propertyName?: string;
            _schemaDef?: string;
            _unresolvedValue?: string;
        })[];
        propertiesToUpdate: any[];
    }[]>;
    persistSeedUid: (publisher?: string, attestationCreatedAtMs?: number) => Promise<void>;
    get serviceContext(): any;
    /**
     * Get snapshot context from the service
     * Used by the reactive proxy to read tracked properties
     */
    _getSnapshotContext(): any;
    get seedLocalId(): string;
    get seedUid(): string | undefined;
    get schemaUid(): string | undefined;
    get revokedAt(): number | undefined;
    get isRevoked(): boolean;
    get latestVersionUid(): VersionsType;
    get latestVersionLocalId(): string;
    get modelName(): string;
    /**
     * Returns model property names from the Model cache (for use in constructor when
     * property instances are not yet available). Returns [] if modelName is missing
     * or Model is not in cache. Pass schemaName when available so the correct model
     * is resolved (cache is keyed by schemaName:modelName).
     */
    protected _getModelPropertyNames(schemaName?: string): string[];
    /**
     * Helper method to get model schema keys for filtering properties
     * Since properties are loaded from metadata (which already corresponds to the model),
     * we can infer schema keys from the property instances themselves
     * This makes Item independent from Model
     */
    protected _getModelSchemaKeys(): string[];
    protected _getSchemaKeysFromPropertyInstances(propertyInstances: Map<string, IItemProperty> | undefined): string[];
    /**
     * Helper method to determine if a property key is a model-specific property
     * (as opposed to an internal/common property)
     *
     * Uses the same transformation as _getSchemaKeysFromPropertyInstances so that
     * Map keys (e.g. "authorId", "tagIds") are correctly matched to schema keys
     * (e.g. "author", "tags").
     */
    protected _isModelProperty(key: string, modelSchemaKeys: string[]): boolean;
    /**
     * Returns only properties that are defined in the Model's schema
     * (excludes internal/common properties)
     */
    get properties(): IItemProperty[];
    /**
     * Returns only internal/common properties that are shared across all Items
     * (e.g., seedLocalId, seedUid, createdAt, etc.)
     */
    get internalProperties(): Record<string, IItemProperty>;
    /**
     * Returns all properties (both model-specific and internal)
     * Useful for backward compatibility or debugging
     */
    get allProperties(): Record<string, IItemProperty>;
    get attestationCreatedAt(): number;
    get versionsCount(): number;
    get lastVersionPublishedAt(): number;
    get createdAt(): number | undefined;
    /**
     * Set up liveQuery subscription to watch for item and version changes in the database
     * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
     */
    private _setupLiveQuerySubscription;
    unload(): void;
    /**
     * Destroy the item: soft delete in DB, remove from caches, clean up subscriptions, stop service.
     */
    destroy(): Promise<void>;
}
//# sourceMappingURL=Item.d.ts.map
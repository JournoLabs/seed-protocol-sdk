import { ActorRefFrom, Subscription } from 'xstate';
import { BehaviorSubject, Subscriber } from 'rxjs';
import { Static } from '@sinclair/typebox';
import { IItemProperty } from '@/interfaces/IItemProperty';
import { CreatePropertyInstanceProps } from '@/types';
import { propertyMachine } from './service/propertyMachine';
import type { TProperty } from '@/Schema';
type ItemPropertyService = ActorRefFrom<typeof propertyMachine>;
type ItemPropertyFindProps = {
    propertyName: string;
    propertyLocalId?: string;
    seedLocalId?: string;
    seedUid?: string;
    /** When metadata has no modelType, callers (e.g. Item) can pass modelName so ItemProperty.create can succeed */
    modelName?: string;
};
export declare class ItemProperty<PropertyType> implements IItemProperty<PropertyType> {
    protected static instanceCache: Map<string, {
        instance: ItemProperty<any>;
        refCount: number;
    }>;
    protected readonly _service: ItemPropertyService;
    protected _subject: BehaviorSubject<any>;
    protected readonly _isRelation: boolean;
    protected readonly _isList: boolean;
    protected readonly _alias: string | undefined;
    protected _subscription: Subscription;
    protected _dataType: string | undefined;
    protected _schemaUid: string | undefined;
    constructor(initialValues: Partial<CreatePropertyInstanceProps>);
    /**
     * Set up liveQuery subscription to watch for metadata changes in the database
     * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
     */
    private _setupLiveQuerySubscription;
    /**
     * Set up liveQuery subscription to watch for property schema changes in the properties table.
     * When ModelProperty dataType (or other schema fields) changes in the database, ItemProperty
     * receives the update and refreshes its propertyRecordSchema.
     */
    private _setupPropertySchemaLiveQuery;
    static create(props: Partial<CreatePropertyInstanceProps>, options?: {
        waitForReady?: false;
    }): ItemProperty<any> | undefined;
    static create(props: Partial<CreatePropertyInstanceProps>, options?: {
        waitForReady?: true;
        readyTimeout?: number;
    }): Promise<ItemProperty<any> | undefined>;
    static find({ propertyName, seedLocalId, seedUid, modelName: modelNameOption, waitForReady, readyTimeout, }: ItemPropertyFindProps & {
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<ItemProperty<any> | undefined>;
    /**
     * Get all ItemProperty instances for an item.
     * Loads property data via getItemProperties, creates instances via create, optionally waits for idle.
     */
    static all(params: {
        seedLocalId?: string;
        seedUid?: string;
    }, options?: {
        waitForReady?: boolean;
        readyTimeout?: number;
    }): Promise<ItemProperty<any>[]>;
    find: typeof ItemProperty.find;
    static cacheKey(seedLocalIdOrUid: string, propertyName: string): string;
    /** Clears instance cache for an item (for test isolation when run in group). */
    static clearInstanceCacheForItem(seedLocalIdOrUid: string): void;
    getService(): import("xstate").ActorRef<import("xstate").MachineSnapshot<PropertyMachineContext, import("xstate").AnyEventObject, {
        [x: string]: import("xstate").ActorRefFromLogic<any> | undefined;
    }, "error" | "loading" | "idle" | "initializing" | "waitingForDb" | "hydratingFromDb" | "resolvingRelatedValue" | "resolvingRemoteStorage" | {
        saving: "analyzingInput" | "doneSaving" | "savingImage" | "savingFile" | "savingHtml" | "savingRelation" | "savingItemStorage";
    }, string, import("xstate").NonReducibleUnknown, import("xstate").MetaObject, {
        id: "itemProperty";
        states: {
            readonly idle: {};
            readonly waitingForDb: {};
            readonly loading: {};
            readonly error: {};
            readonly hydratingFromDb: {};
            readonly initializing: {};
            readonly resolvingRelatedValue: {};
            readonly resolvingRemoteStorage: {};
            readonly saving: {
                states: {
                    readonly analyzingInput: {};
                    readonly savingImage: {};
                    readonly savingFile: {};
                    readonly savingHtml: {};
                    readonly savingRelation: {};
                    readonly savingItemStorage: {};
                    readonly doneSaving: {};
                };
            };
        };
    }>, import("xstate").AnyEventObject, import("xstate").EventObject>;
    private _getSnapshot;
    private _getSnapshotContext;
    get localId(): any;
    get uid(): any;
    get seedLocalId(): any;
    get seedUid(): any;
    get schemaUid(): string | undefined;
    get propertyName(): string;
    get storagePropertyName(): string;
    get modelName(): any;
    get propertyDef(): Static<typeof TProperty> | undefined;
    get localStorageDir(): string | void;
    get refResolvedValue(): string | undefined;
    get localStoragePath(): string | void;
    get versionLocalId(): string | undefined;
    get status(): "error" | "loading" | "idle" | "initializing" | "waitingForDb" | "hydratingFromDb" | "resolvingRelatedValue" | "resolvingRemoteStorage" | {
        saving: "analyzingInput" | "doneSaving" | "savingImage" | "savingFile" | "savingHtml" | "savingRelation" | "savingItemStorage";
    };
    get alias(): string | undefined;
    get value(): any;
    set value(value: any);
    get published(): boolean;
    subscribe(callback: Partial<Subscriber<any>>): Subscription;
    save(): Promise<void>;
    unload(): void;
    /**
     * Destroy the item property: remove from caches, delete metadata from DB, remove from parent Item, stop service.
     */
    destroy(): Promise<void>;
}
export {};
//# sourceMappingURL=ItemProperty.d.ts.map
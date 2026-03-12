import { ActorRefFrom } from 'xstate';
import { SchemaFileFormat } from '@/types/import';
import { ValidationError } from '@/Schema/validation';
import { writeProcessMachine } from '@/services/write/writeProcessMachine';
export type SchemaMachineContext = {
    schemaName: string;
    $schema?: string;
    version?: number;
    metadata?: {
        name: string;
        createdAt: string;
        updatedAt: string;
    };
    models?: {
        [modelName: string]: {
            properties: {
                [propertyName: string]: any;
            };
        };
    };
    enums?: {
        [enumName: string]: any;
    };
    migrations?: Array<{
        version: number;
        timestamp: string;
        description: string;
        changes: any[];
    }>;
    _isDraft?: boolean;
    _isEdited?: boolean;
    _editedProperties?: Set<string>;
    _validationErrors?: ValidationError[];
    id?: string;
    _dbId?: number;
    _loadedAt?: number;
    _dbVersion?: number;
    _dbUpdatedAt?: number;
    _pendingModelAdditions?: Array<{
        models: {
            [modelName: string]: any;
        };
        timestamp: number;
    }>;
    _modelAdditionErrors?: Array<{
        error: Error;
        timestamp: number;
    }>;
    writeProcess?: ActorRefFrom<typeof writeProcessMachine> | null;
    _liveQueryModelIds?: string[];
    _modelIds?: string[];
    _propertyIds?: string[];
    _loadingStage?: string;
    _loadingError?: {
        stage: string;
        error: Error;
    };
    _schemaRecord?: any;
    _destroyInProgress?: boolean;
    _destroyError?: {
        message: string;
        name?: string;
    } | null;
};
export declare const schemaMachine: import("xstate").StateMachine<SchemaMachineContext, {
    [key: string]: any;
    type: "updateContext";
} | {
    type: "loadOrCreateSchema";
} | {
    type: "loadOrCreateSchemaSuccess";
    schema: SchemaFileFormat;
} | {
    type: "loadOrCreateSchemaError";
    error: Error;
} | {
    type: "markAsDraft";
    propertyKey: string;
} | {
    type: "clearDraft";
    _dbUpdatedAt?: number;
    _dbVersion?: number;
} | {
    type: "validateSchema";
} | {
    type: "validationSuccess";
    errors: ValidationError[];
} | {
    type: "validationError";
    errors: ValidationError[];
} | {
    type: "reloadFromDb";
} | {
    type: "addModels";
    models: {
        [modelName: string]: any;
    };
} | {
    type: "requestWrite";
    data: any;
} | {
    type: "schemaFound";
    schema: SchemaFileFormat;
    schemaRecord: any;
    modelIds?: string[];
    loadedAt?: number;
    dbVersion?: number;
    dbUpdatedAt?: number;
} | {
    type: "schemaNotFound";
} | {
    type: "schemaWritten";
    schemaRecord: any;
    schema: SchemaFileFormat;
} | {
    type: "schemaVerified";
    schemaId: number;
} | {
    type: "modelsWritten";
    modelIds: string[];
} | {
    type: "modelsVerified";
    modelIds: string[];
} | {
    type: "instancesCreated";
    count: number;
} | {
    type: "instancesVerified";
    count: number;
} | {
    type: "propertiesWritten";
    propertyIds: string[];
} | {
    type: "propertiesVerified";
    propertyIds: string[];
} | {
    type: "verificationFailed";
    stage: string;
    error: Error;
} | {
    type: "writeError";
    error: Error;
} | {
    type: "destroyStarted";
} | {
    type: "destroyDone";
} | {
    type: "destroyError";
    error: unknown;
} | {
    type: "clearDestroyError";
}, {
    [x: string]: import("xstate").ActorRefFromLogic<any> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<SchemaMachineContext>, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").StateMachine<import("./addModelsMachine").AddModelsMachineContext, {
        type: "validateModels";
    } | {
        type: "createModelInstances";
    } | {
        type: "collectModelFileIds";
    } | {
        type: "persistModelsToDb";
    } | {
        type: "progress";
        stage: "preparing" | "creatingInstances" | "collectingIds" | "persisting";
        currentModel?: string;
    } | {
        type: "error";
        error: Error;
        modelName?: string;
    }, {
        [x: string]: import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            newModels: {
                [modelName: string]: any;
            };
            existingModels: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            modelInstances: Map<string, SchemaFileFormat>;
        }, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
            modelFileIds: Map<string, string>;
        }, import("xstate").EventObject>> | undefined;
    }, {
        src: "createModelInstances";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>;
        id: string | undefined;
    } | {
        src: "validateModels";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            newModels: {
                [modelName: string]: any;
            };
            existingModels: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>;
        id: string | undefined;
    } | {
        src: "collectModelFileIds";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            modelInstances: Map<string, SchemaFileFormat>;
        }, import("xstate").EventObject>;
        id: string | undefined;
    } | {
        src: "persistModelsToDb";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
            modelFileIds: Map<string, string>;
        }, import("xstate").EventObject>;
        id: string | undefined;
    }, never, never, never, "error" | "preparing" | "creatingInstances" | "collectingIds" | "persisting" | "success", string, {
        schemaContext: SchemaMachineContext;
        models: {
            [modelName: string]: any;
        };
        existingModels: {
            [modelName: string]: any;
        };
    }, import("xstate").NonReducibleUnknown, import("xstate").EventObject, import("xstate").MetaObject, {
        id: "addModels";
        states: {
            readonly preparing: {};
            readonly creatingInstances: {};
            readonly collectingIds: {};
            readonly persisting: {};
            readonly success: {
                id: "success";
            };
            readonly error: {};
        };
    }>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/writeSchemaToDb").WriteSchemaToDbInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifySchemaInDb").VerifySchemaInDbInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/writeModelsToDb").WriteModelsToDbInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyModelsInDb").VerifyModelsInDbInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/createModelInstances").CreateModelInstancesInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyModelInstancesInCache").VerifyModelInstancesInCacheInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/writePropertiesToDb").WritePropertiesToDbInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyPropertiesInDb").VerifyPropertiesInDbInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/createPropertyInstances").CreatePropertyInstancesInput, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyPropertyInstancesInCache").VerifyPropertyInstancesInCacheInput, import("xstate").EventObject>> | undefined;
}, {
    src: "loadOrCreateSchema";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<SchemaMachineContext>, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "validateSchema";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<SchemaMachineContext>, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "addModelsMachine";
    logic: import("xstate").StateMachine<import("./addModelsMachine").AddModelsMachineContext, {
        type: "validateModels";
    } | {
        type: "createModelInstances";
    } | {
        type: "collectModelFileIds";
    } | {
        type: "persistModelsToDb";
    } | {
        type: "progress";
        stage: "preparing" | "creatingInstances" | "collectingIds" | "persisting";
        currentModel?: string;
    } | {
        type: "error";
        error: Error;
        modelName?: string;
    }, {
        [x: string]: import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            newModels: {
                [modelName: string]: any;
            };
            existingModels: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            modelInstances: Map<string, SchemaFileFormat>;
        }, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
            modelFileIds: Map<string, string>;
        }, import("xstate").EventObject>> | undefined;
    }, {
        src: "createModelInstances";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>;
        id: string | undefined;
    } | {
        src: "validateModels";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            newModels: {
                [modelName: string]: any;
            };
            existingModels: {
                [modelName: string]: any;
            };
        }, import("xstate").EventObject>;
        id: string | undefined;
    } | {
        src: "collectModelFileIds";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            modelInstances: Map<string, SchemaFileFormat>;
        }, import("xstate").EventObject>;
        id: string | undefined;
    } | {
        src: "persistModelsToDb";
        logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, {
            schemaContext: SchemaMachineContext;
            models: {
                [modelName: string]: any;
            };
            modelFileIds: Map<string, string>;
        }, import("xstate").EventObject>;
        id: string | undefined;
    }, never, never, never, "error" | "preparing" | "creatingInstances" | "collectingIds" | "persisting" | "success", string, {
        schemaContext: SchemaMachineContext;
        models: {
            [modelName: string]: any;
        };
        existingModels: {
            [modelName: string]: any;
        };
    }, import("xstate").NonReducibleUnknown, import("xstate").EventObject, import("xstate").MetaObject, {
        id: "addModels";
        states: {
            readonly preparing: {};
            readonly creatingInstances: {};
            readonly collectingIds: {};
            readonly persisting: {};
            readonly success: {
                id: "success";
            };
            readonly error: {};
        };
    }>;
    id: string | undefined;
} | {
    src: "writeProcessMachine";
    logic: any;
    id: string | undefined;
} | {
    src: "checkExistingSchema";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<SchemaMachineContext>, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "writeSchemaToDb";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/writeSchemaToDb").WriteSchemaToDbInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "verifySchemaInDb";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifySchemaInDb").VerifySchemaInDbInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "writeModelsToDb";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/writeModelsToDb").WriteModelsToDbInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "verifyModelsInDb";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyModelsInDb").VerifyModelsInDbInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "createModelInstances";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/createModelInstances").CreateModelInstancesInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "verifyModelInstancesInCache";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyModelInstancesInCache").VerifyModelInstancesInCacheInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "writePropertiesToDb";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/writePropertiesToDb").WritePropertiesToDbInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "verifyPropertiesInDb";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyPropertiesInDb").VerifyPropertiesInDbInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "createPropertyInstances";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/createPropertyInstances").CreatePropertyInstancesInput, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "verifyPropertyInstancesInCache";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, import("./actors/verifyPropertyInstancesInCache").VerifyPropertyInstancesInCacheInput, import("xstate").EventObject>;
    id: string | undefined;
}, never, {
    type: "isSchemaValid";
    params: unknown;
} | {
    type: "hasValidationErrors";
    params: unknown;
}, never, "error" | "idle" | "addingModels" | "validating" | {
    loading: "checkingExisting" | "writingSchema" | "verifyingSchema" | "writingModels" | "verifyingModels" | "creatingModelInstances" | "verifyingModelInstances" | "writingProperties" | "verifyingProperties" | "creatingPropertyInstances" | "verifyingPropertyInstances";
}, string, Pick<SchemaMachineContext, "schemaName">, import("xstate").NonReducibleUnknown, import("xstate").EventObject, import("xstate").MetaObject, {
    id: "schema";
    states: {
        readonly loading: {
            states: {
                readonly checkingExisting: {};
                readonly writingSchema: {};
                readonly verifyingSchema: {};
                readonly writingModels: {};
                readonly verifyingModels: {};
                readonly creatingModelInstances: {};
                readonly verifyingModelInstances: {};
                readonly writingProperties: {};
                readonly verifyingProperties: {};
                readonly creatingPropertyInstances: {};
                readonly verifyingPropertyInstances: {};
            };
        };
        readonly idle: {};
        readonly addingModels: {};
        readonly validating: {};
        readonly error: {};
    };
}>;
//# sourceMappingURL=schemaMachine.d.ts.map
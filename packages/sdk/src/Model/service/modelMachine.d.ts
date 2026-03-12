import { ActorRefFrom } from 'xstate';
import { ValidationError } from '@/Schema/validation';
import { writeProcessMachine } from '@/services/write/writeProcessMachine';
export type ModelMachineContext = {
    id?: string;
    _dbId?: number;
    modelName: string;
    schemaName: string;
    _isEdited?: boolean;
    _editedProperties?: Set<string>;
    _validationErrors?: ValidationError[];
    _originalValues?: {
        properties?: {
            [propertyName: string]: any;
        };
    };
    writeProcess?: ActorRefFrom<typeof writeProcessMachine> | null;
    _liveQueryPropertyIds?: string[];
    _pendingPropertyDefinitions?: {
        [propertyName: string]: any;
    };
    _modelFileId?: string;
    _loadedAt?: number;
    _dbVersion?: number;
    _dbUpdatedAt?: number;
    _idFromSchema?: boolean;
    _destroyInProgress?: boolean;
    _destroyError?: {
        message: string;
        name?: string;
    } | null;
};
export declare const modelMachine: import("xstate").StateMachine<ModelMachineContext, {
    [key: string]: any;
    type: "updateContext";
} | {
    type: "loadOrCreateModel";
} | {
    type: "loadOrCreateModelSuccess";
    model: Omit<ModelMachineContext, "modelName" | "schemaName" | "_isEdited" | "_editedProperties" | "_validationErrors" | "_loadedAt" | "_dbVersion" | "_dbUpdatedAt"> & Partial<Pick<ModelMachineContext, "_loadedAt" | "_dbVersion" | "_dbUpdatedAt">>;
} | {
    type: "loadOrCreateModelError";
    error: Error;
} | {
    type: "initializeOriginalValues";
    originalValues: Partial<ModelMachineContext>;
    isEdited?: boolean;
} | {
    type: "markAsDraft";
    propertyKey: string;
} | {
    type: "clearDraft";
} | {
    type: "validateModel";
} | {
    type: "validationSuccess";
    errors: ValidationError[];
} | {
    type: "validationError";
    errors: ValidationError[];
} | {
    type: "reloadFromDb";
} | {
    type: "requestWrite";
    data: any;
} | {
    type: "writeSuccess";
    output: any;
} | {
    type: "createModelPropertiesSuccess";
} | {
    type: "createModelPropertiesError";
    error: Error;
} | {
    type: "refreshProperties";
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
    [x: string]: import("xstate").ActorRefFromLogic<any> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<ModelMachineContext>, import("xstate").EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, any, import("xstate").EventObject>> | undefined;
}, {
    src: "writeProcessMachine";
    logic: any;
    id: string | undefined;
} | {
    src: "loadOrCreateModel";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<ModelMachineContext>, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "validateModel";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<ModelMachineContext>, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "createModelProperties";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, any, import("xstate").EventObject>;
    id: string | undefined;
}, {
    type: "assignValidationErrors";
    params: import("xstate").NonReducibleUnknown;
}, {
    type: "hasValidationErrors";
    params: unknown;
} | {
    type: "isModelValid";
    params: unknown;
}, never, "error" | "loading" | "idle" | "validating" | "creatingProperties", string, Pick<ModelMachineContext, "schemaName" | "modelName" | "id" | "_idFromSchema" | "_pendingPropertyDefinitions">, import("xstate").NonReducibleUnknown, import("xstate").EventObject, import("xstate").MetaObject, {
    id: "model";
    states: {
        readonly loading: {};
        readonly idle: {};
        readonly validating: {};
        readonly creatingProperties: {};
        readonly error: {};
    };
}>;
//# sourceMappingURL=modelMachine.d.ts.map
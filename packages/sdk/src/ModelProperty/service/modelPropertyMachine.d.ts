import { ActorRefFrom } from 'xstate';
import { Static } from '@sinclair/typebox';
import { TProperty } from '@/Schema';
import { ValidationError } from '@/Schema/validation';
import { writeProcessMachine } from '@/services/write/writeProcessMachine';
export type ModelPropertyMachineContext = Static<typeof TProperty> & {
    _originalValues?: Partial<Static<typeof TProperty>>;
    _isEdited?: boolean;
    _schemaName?: string;
    _validationErrors?: ValidationError[];
    writeProcess?: ActorRefFrom<typeof writeProcessMachine> | null;
    _propertyFileId?: string;
    _destroyInProgress?: boolean;
    _destroyError?: {
        message: string;
        name?: string;
    } | null;
};
export declare const modelPropertyMachine: import("xstate").StateMachine<any, {
    [key: string]: any;
    type: "updateContext";
} | {
    type: "initializeOriginalValues";
    originalValues: Partial<Static<typeof TProperty>>;
    schemaName?: string;
    isEdited?: boolean;
} | {
    type: "clearEdited";
} | {
    type: "setSchemaName";
    schemaName: string;
} | {
    type: "saveToSchema";
} | {
    type: "saveToSchemaSuccess";
} | {
    type: "saveToSchemaError";
    error: Error;
} | {
    type: "compareAndMarkDraftSuccess";
} | {
    type: "compareAndMarkDraftError";
} | {
    type: "validateProperty";
} | {
    type: "validationSuccess";
    errors: ValidationError[];
} | {
    type: "validationError";
    errors: ValidationError[];
} | {
    type: "requestWrite";
    data: any;
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
    [x: string]: import("xstate").ActorRefFromLogic<any> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<any>, import("xstate").EventObject>> | undefined;
}, {
    src: "writeProcessMachine";
    logic: any;
    id: string | undefined;
} | {
    src: "saveToSchema";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<any>, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "validateProperty";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<any>, import("xstate").EventObject>;
    id: string | undefined;
} | {
    src: "compareAndMarkDraft";
    logic: import("xstate").CallbackActorLogic<import("xstate").EventObject, FromCallbackInput<any>, import("xstate").EventObject>;
    id: string | undefined;
}, {
    type: "assignValidationErrors";
    params: import("xstate").NonReducibleUnknown;
}, {
    type: "hasValidationErrors";
    params: unknown;
} | {
    type: "isPropertyValid";
    params: unknown;
}, never, "idle" | "validating" | "compareAndMarkDraft" | {
    saveToSchema: "saving";
}, string, any, import("xstate").NonReducibleUnknown, import("xstate").EventObject, import("xstate").MetaObject, {
    id: "modelProperty";
    states: {
        readonly idle: {};
        readonly validating: {};
        readonly compareAndMarkDraft: {};
        readonly saveToSchema: {
            states: {
                readonly saving: {};
            };
        };
    };
}>;
//# sourceMappingURL=modelPropertyMachine.d.ts.map
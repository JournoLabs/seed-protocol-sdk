import type { EventObject } from 'xstate';
import { SchemaMachineContext } from './schemaMachine';
import { Model } from '@/Model/Model';
export type AddModelsMachineContext = {
    schemaContext: SchemaMachineContext;
    models: {
        [modelName: string]: any;
    };
    existingModels: {
        [modelName: string]: any;
    };
    modelInstances?: Map<string, Model>;
    modelFileIds?: Map<string, string>;
    errors?: Array<{
        modelName: string;
        error: Error;
    }>;
    addedModels?: {
        addedModels: any;
    };
    progress?: {
        stage: 'preparing' | 'creatingInstances' | 'collectingIds' | 'persisting';
        currentModel?: string;
        totalModels: number;
        completedModels: number;
    };
};
export declare const addModelsMachine: import("xstate").StateMachine<AddModelsMachineContext, {
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
    [x: string]: import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<EventObject, {
        schemaContext: SchemaMachineContext;
        models: {
            [modelName: string]: any;
        };
    }, EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<EventObject, {
        newModels: {
            [modelName: string]: any;
        };
        existingModels: {
            [modelName: string]: any;
        };
    }, EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<EventObject, {
        modelInstances: Map<string, Model>;
    }, EventObject>> | import("xstate").ActorRefFromLogic<import("xstate").CallbackActorLogic<EventObject, {
        schemaContext: SchemaMachineContext;
        models: {
            [modelName: string]: any;
        };
        modelFileIds: Map<string, string>;
    }, EventObject>> | undefined;
}, {
    src: "createModelInstances";
    logic: import("xstate").CallbackActorLogic<EventObject, {
        schemaContext: SchemaMachineContext;
        models: {
            [modelName: string]: any;
        };
    }, EventObject>;
    id: string | undefined;
} | {
    src: "validateModels";
    logic: import("xstate").CallbackActorLogic<EventObject, {
        newModels: {
            [modelName: string]: any;
        };
        existingModels: {
            [modelName: string]: any;
        };
    }, EventObject>;
    id: string | undefined;
} | {
    src: "collectModelFileIds";
    logic: import("xstate").CallbackActorLogic<EventObject, {
        modelInstances: Map<string, Model>;
    }, EventObject>;
    id: string | undefined;
} | {
    src: "persistModelsToDb";
    logic: import("xstate").CallbackActorLogic<EventObject, {
        schemaContext: SchemaMachineContext;
        models: {
            [modelName: string]: any;
        };
        modelFileIds: Map<string, string>;
    }, EventObject>;
    id: string | undefined;
}, never, never, never, "error" | "preparing" | "creatingInstances" | "collectingIds" | "persisting" | "success", string, {
    schemaContext: SchemaMachineContext;
    models: {
        [modelName: string]: any;
    };
    existingModels: {
        [modelName: string]: any;
    };
}, import("xstate").NonReducibleUnknown, EventObject, import("xstate").MetaObject, {
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
//# sourceMappingURL=addModelsMachine.d.ts.map
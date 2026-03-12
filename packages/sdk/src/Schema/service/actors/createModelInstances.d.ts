import { EventObject } from 'xstate';
export type CreateModelInstancesInput = {
    modelIds: string[];
    schemaName: string;
};
/**
 * Create Model instances for all model IDs to ensure they're cached
 * This ensures that Model.getById() in Schema.getContext() will find the instances
 */
export declare const createModelInstances: import("xstate").CallbackActorLogic<EventObject, CreateModelInstancesInput, EventObject>;
//# sourceMappingURL=createModelInstances.d.ts.map
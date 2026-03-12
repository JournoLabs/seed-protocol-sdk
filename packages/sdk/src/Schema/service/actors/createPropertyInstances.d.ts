import { EventObject } from 'xstate';
export type CreatePropertyInstancesInput = {
    propertyIds: string[];
    modelIds: string[];
};
/**
 * Create ModelProperty instances for all property IDs to ensure they're cached
 * Properties are typically created when Model instances are created, but this
 * ensures they're all available in the cache
 */
export declare const createPropertyInstances: import("xstate").CallbackActorLogic<EventObject, CreatePropertyInstancesInput, EventObject>;
//# sourceMappingURL=createPropertyInstances.d.ts.map
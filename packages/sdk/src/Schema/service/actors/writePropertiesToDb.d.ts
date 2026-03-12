import { EventObject } from 'xstate';
export type WritePropertiesToDbInput = {
    modelIds: string[];
};
/**
 * Properties are typically written to DB as part of writeModelsToDb
 * This actor verifies that properties exist and extracts their IDs
 */
export declare const writePropertiesToDb: import("xstate").CallbackActorLogic<EventObject, WritePropertiesToDbInput, EventObject>;
//# sourceMappingURL=writePropertiesToDb.d.ts.map
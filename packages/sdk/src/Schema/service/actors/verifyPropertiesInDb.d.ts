import { EventObject } from 'xstate';
export type VerifyPropertiesInDbInput = {
    modelIds?: number[];
    modelFileIds?: string[];
    expectedPropertyIds?: string[];
};
export declare const verifyPropertiesInDb: import("xstate").CallbackActorLogic<EventObject, VerifyPropertiesInDbInput, EventObject>;
//# sourceMappingURL=verifyPropertiesInDb.d.ts.map
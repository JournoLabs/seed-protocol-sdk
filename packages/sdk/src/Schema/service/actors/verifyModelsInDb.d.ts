import { EventObject } from 'xstate';
export type VerifyModelsInDbInput = {
    schemaId: number;
    expectedModelIds?: string[];
};
export declare const verifyModelsInDb: import("xstate").CallbackActorLogic<EventObject, VerifyModelsInDbInput, EventObject>;
//# sourceMappingURL=verifyModelsInDb.d.ts.map
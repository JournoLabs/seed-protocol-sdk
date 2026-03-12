import { EventObject } from 'xstate';
export type VerifySchemaInDbInput = {
    schemaFileId: string;
    expectedSchemaId?: number;
};
export declare const verifySchemaInDb: import("xstate").CallbackActorLogic<EventObject, VerifySchemaInDbInput, EventObject>;
//# sourceMappingURL=verifySchemaInDb.d.ts.map
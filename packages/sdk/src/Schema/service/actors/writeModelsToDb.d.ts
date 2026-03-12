import { EventObject } from 'xstate';
import { SchemaFileFormat } from '@/types/import';
export type WriteModelsToDbInput = {
    schema: SchemaFileFormat;
    schemaRecord: any;
    schemaName: string;
};
export declare const writeModelsToDb: import("xstate").CallbackActorLogic<EventObject, WriteModelsToDbInput, EventObject>;
//# sourceMappingURL=writeModelsToDb.d.ts.map
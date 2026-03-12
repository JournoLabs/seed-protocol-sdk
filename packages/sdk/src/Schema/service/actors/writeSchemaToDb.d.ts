import { EventObject } from 'xstate';
import { SchemaFileFormat } from '@/types/import';
export type WriteSchemaToDbInput = {
    schemaName: string;
    schemaFile?: SchemaFileFormat;
    existingDbSchema?: {
        version?: number;
    };
};
export declare const writeSchemaToDb: import("xstate").CallbackActorLogic<EventObject, WriteSchemaToDbInput, EventObject>;
//# sourceMappingURL=writeSchemaToDb.d.ts.map
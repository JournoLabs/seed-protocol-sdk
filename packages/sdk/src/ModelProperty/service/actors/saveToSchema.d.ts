import { EventObject } from 'xstate';
/**
 * Get schema name from model
 * This function finds which schema contains the given model
 * Exported so it can be reused by ModelProperty for setting schema name
 */
export declare function getSchemaNameFromModel(modelName: string): Promise<string | undefined>;
export declare const saveToSchema: import("xstate").CallbackActorLogic<EventObject, FromCallbackInput<any>, EventObject>;
//# sourceMappingURL=saveToSchema.d.ts.map
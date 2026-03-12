import { PropertyStates, PropertyValue } from './property';
import { Actor, AnyActorLogic } from 'xstate';
import { Static } from '@sinclair/typebox';
import { TModelSchema, TProperty } from '@/Schema';
import { Item } from '@/Item/Item';
import type { Model } from '@/Model/Model';
export type ModelDefinitions = {
    [modelName: string]: Model;
};
export type ModelStatus = (propName: string) => keyof PropertyStates;
export type ExcludedKeys = 'states' | 'status';
/**
 * @deprecated Use Model directly instead. This type is kept for backward compatibility during migration.
 */
export type ModelClassType = Model;
export type ModelValues<T extends Record<string, any>> = Item<any> & {
    schema: ModelSchema;
    ModelClass?: Model;
} & {
    [K in keyof T]: PropertyValue;
};
export type StatesMap<T> = Map<string, Actor<T extends AnyActorLogic ? T : never>>;
export type ModelSchema = Partial<Static<typeof TModelSchema>>;
export type ModelProperty = typeof TProperty;
//# sourceMappingURL=model.d.ts.map
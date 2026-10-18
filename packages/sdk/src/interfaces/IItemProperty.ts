import { ActorRefFrom, Subscription } from 'xstate';
import { BehaviorSubject } from 'rxjs';
import { Static } from '@sinclair/typebox';
import { TProperty } from '@/Schema';
import { ItemProperty } from '@/ItemProperty/ItemProperty';

export interface IItemProperty<PropertyType = any> {

  readonly localId: string;
  readonly uid: string;
  readonly seedLocalId: string;
  readonly seedUid: string;
  readonly schemaUid?: string;
  readonly propertyName: string;
  /** Internal DB/EAS metadata name (e.g. authorIdentityIds); use for storage lookups. */
  readonly storagePropertyName: string;
  readonly modelName: string;
  readonly propertyDef: Static<typeof TProperty> | undefined;
  readonly localStoragePath: string | void;
  readonly localStorageDir: string | void;
  readonly versionLocalId: string | undefined;
  readonly status: any;
  readonly alias: string | undefined;
  readonly refResolvedValue: string | undefined;
  value: any;
  readonly published: boolean;
  readonly saveValidationErrors: import('@/Schema/validation').ValidationError[];

  subscribe(callback: Partial<BehaviorSubject<any>>): Subscription;
  /** Shows `value` and saves it, even when it is already in context. See ItemProperty.setValue. */
  setValue(value: any, options?: { before?: import('@/types/property').PropertyValueSnapshot }): void;
  save(): Promise<void>;
  unload(): void;
  destroy(): Promise<void>;
  getService(): ActorRefFrom<any>;
  find(props: {
    propertyName: string;
    seedLocalId?: string;
    seedUid?: string;
    waitForReady?: boolean;
    readyTimeout?: number;
  }): Promise<ItemProperty<any> | undefined>;
} 
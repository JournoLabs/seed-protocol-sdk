import { ActorRefFrom, Subscription } from 'xstate';
import { BehaviorSubject } from 'rxjs';
import { Static } from '@sinclair/typebox';
import { TProperty } from '@/schema';
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty';

export interface IItemProperty<PropertyType> {

  readonly localId: string;
  readonly uid: string;
  readonly seedLocalId: string;
  readonly seedUid: string;
  readonly schemaUid: string;
  readonly propertyName: string;
  readonly modelName: string;
  readonly propertyDef: Static<typeof TProperty> | undefined;
  readonly localStoragePath: string | void;
  readonly localStorageDir: string | void;
  readonly versionLocalId: string | undefined;
  readonly status: any;
  readonly alias: string | undefined;
  value: any;
  readonly published: boolean;

  subscribe(callback: Partial<BehaviorSubject<any>>): Subscription;
  save(): Promise<void>;
  unload(): void;
  getService(): ActorRefFrom<any>;
  find(props: {
    propertyName: string;
    seedLocalId?: string;
    seedUid?: string;
  }): Promise<BaseItemProperty<any> | undefined>;
} 
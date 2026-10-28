import { ActorRefFrom, Subscription } from 'xstate';
import { BehaviorSubject } from 'rxjs';
import { Static } from '@sinclair/typebox';
import { TProperty } from '@/Schema';
import { ItemProperty } from '@/ItemProperty/ItemProperty';

export interface IItemProperty<_PropertyType = any> {

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
  /** loading / ready / error */
  readonly status: 'loading' | 'ready' | 'error';
  waitForReady(options?: { timeout?: number }): Promise<void>;
  readonly alias: string | undefined;
  readonly refResolvedValue: string | undefined;
  value: any;
  readonly published: boolean;
  readonly saveValidationErrors: import('@/Schema/validation').ValidationError[];

  subscribe(callback: Partial<BehaviorSubject<any>>): Subscription;
  /** Shows `value` and appends its write, even when it is already in context. See ItemProperty.setValue. */
  setValue(value: any): void;
  /** Shows `value` without writing it; the next setValue or assignment writes. */
  showValue(value: any): void;
  /** The unresolved conflict between the last local edit and a value sync wrote meanwhile; null when none. */
  readonly conflict: import('@/outbox/conflicts').PropertyConflict | null;
  resolveConflict(choice: 'local' | 'remote'): Promise<void>;
  /** Resolves once the latest write is stored; `timeoutMs` stops waiting (the write stays queued). See ItemProperty.save. */
  save(options?: { timeoutMs?: number }): Promise<void>;
  /** Clears the value; `retract` makes publish revoke it instead of attesting the empty value. See ItemProperty.clear. */
  clear(options?: { retract?: boolean }): Promise<void>;
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
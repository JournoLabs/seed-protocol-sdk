/**
 * The appliers for item ops (ADR 0019). Every tab registers them at init: the leader applies ops
 * that other tabs appended.
 */
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { outboxOpValue, registerOutboxApplier, startOutbox } from './outbox'

/**
 * A plain value (Text, Number, Boolean, Date, List, a Relation's seed id) for one item property,
 * as `updateItemPropertyValue` takes it: the value already in its stored string form, and the
 * schema uid already resolved (applying runs in a transaction and mustn't wait on EAS).
 */
export type SetPropertyValueOp = {
  newValue: string | null
  /** The property's metadata row the edit was made against, if it had one. */
  localId?: string | null
  versionLocalId?: string | null
  versionUid?: string | null
  modelName?: string | null
  schemaUid?: string | null
  dataType?: string
  refValueType?: string
}

/** The row a `set` op wrote (updateItemPropertyValue's result). */
export type SetPropertyValueResult = {
  localId: string
  uid: string | null
  schemaUid: string
} | null

let registered = false

/** Registers the item appliers and starts draining. Safe to call more than once. */
export function startItemOutbox(): void {
  if (!registered) {
    registered = true
    registerOutboxApplier('set', {
      apply: async (op, tx): Promise<SetPropertyValueResult> => {
        const value = outboxOpValue<SetPropertyValueOp>(op)!
        const result = await updateItemPropertyValue(
          { ...value, seedLocalId: op.seedLocalId, propertyName: op.propertyName ?? undefined } as never,
          { db: tx },
        )
        return result ?? null
      },
    })
  }
  startOutbox()
}

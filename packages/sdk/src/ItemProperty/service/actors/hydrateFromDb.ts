import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { normalizeDataType } from '@/helpers/property'
import { currentPropertyRow } from '@/db/read/currentPropertyRow'
import { resolveStorageDisplay, storedValueKind } from '@/storageValue/resolve'

const logger = debug('seedSdk:property:actors:hydrateFromDb')

/**
 * Re-reads a loaded property (the `rehydrateFromDb` event): its current row with the pending
 * outbox value over it (currentPropertyRow), its recorded conflict, and an Image, File or Html
 * file's display, fetched when it isn't on disk. An ItemStorage value's content is read by the
 * display subscriber.
 */
export const hydrateFromDb = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, EventObject>
>(({ sendBack, input: { context } }) => {
  const { seedUid, seedLocalId, propertyName, propertyRecordSchema, modelName } = context

  if (!propertyName) {
    throw new Error('propertyName is required')
  }

  const _hydrateFromDb = async () => {
    const normalizedDataType = normalizeDataType(propertyRecordSchema?.dataType)
    const row = await currentPropertyRow(
      { seedLocalId, seedUid },
      {
        propertyId: context.propertyId,
        propertyName,
        modelName,
        modelFileId: context.modelFileId,
        dataType: normalizedDataType,
        refValueType: normalizeDataType(propertyRecordSchema?.refValueType),
      },
    )
    if (!row) return

    const { getPropertyConflict } = await import('@/outbox/conflicts')
    const conflict = await getPropertyConflict(row.seedLocalId ?? seedLocalId, propertyName)

    // Only with a definition: without one, a row's refSeedType alone doesn't decide the display here
    const kind = propertyRecordSchema ? storedValueKind(propertyRecordSchema) : undefined
    let { refResolvedValue, localStorageDir } = row
    // A stored display value is a stale session URL for Image, File and Html (see resolveStorageDisplay)
    let refResolvedDisplayValue = kind ? undefined : row.refResolvedDisplayValue
    let renderValue: string | string[] | undefined = refResolvedDisplayValue ?? undefined
    if (row.pendingText !== undefined) {
      // A pending Html value: its file isn't written until its op is prepared
      renderValue = row.pendingText
    } else if (kind && kind !== 'itemStorage') {
      try {
        const display = await resolveStorageDisplay(kind, row, { fetch: true })
        refResolvedValue = display.ref.refResolvedValue
        localStorageDir = display.ref.localStorageDir
        if (display.renderValue !== undefined) {
          renderValue = display.renderValue
          if (kind !== 'html') refResolvedDisplayValue = display.renderValue
        }
      } catch (e) {
        logger(`[hydrateFromDb] ${kind} file resolution error`, e)
      }
    }

    const propertyValue =
      propertyRecordSchema && normalizedDataType === 'List' && typeof row.propertyValue === 'string'
        ? parseListPropertyValueFromStorage(row.propertyValue)
        : row.propertyValue

    sendBack({
      type: 'updateContext',
      localId: row.localId,
      uid: row.uid,
      propertyValue,
      seedLocalId: row.seedLocalId,
      seedUid: row.seedUid,
      versionLocalId: row.versionLocalId,
      versionUid: row.versionUid,
      schemaUid: row.schemaUid,
      refValueType: row.refValueType,
      localStorageDir,
      refResolvedValue,
      refResolvedDisplayValue,
      // Html shows its text; with no file found the context keeps what it showed
      ...(kind === 'html' && renderValue === undefined ? {} : { renderValue }),
      conflict,
      populatedFromDb: true,
    })
  }

  _hydrateFromDb().then(() => {
    sendBack({ type: 'hydrateFromDbSuccess' })
  })
})

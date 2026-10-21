import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { getItemPropertyData } from '@/db/read/getItemProperty'
import { getLatestVersionRow } from '@/db/read/getLatestVersionRow'
import { easName } from '@seedprotocol/eas'
import { type MetadataType } from '@/seedSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { generateId } from '@/helpers/generateId'
import type { ItemStorageValueResult } from '@/outbox/itemAppliers'
import { writeStorageValue } from './storageValue'
import { beginPropertyWrite, propertyWriteKey } from '@/helpers/propertyWriteTickets'

/**
 * Saves an ItemStorage value: the content goes to a staging file, and an outbox op (ADR 0019) moves
 * it into the item's file and points the property's local draft row at it (see
 * applyItemStorageValue for which row).
 */
export const saveItemStorage = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, SaveValueToDbEvent>
>(({ sendBack, input: { context, event } }) => {
  const {
    localId,
    seedLocalId,
    seedUid,
    propertyName,
    propertyRecordSchema,
    modelName,
  } = context

  if (!propertyRecordSchema) {
    throw new Error('Missing propertyRecordSchema')
  }

  let newValue: ItemPropertyValueType

  if (event) {
    newValue = event.newValue
  }

  // Do NOT skip when existingValue === newValue: the value setter sends updateContext before save,
  // so context.propertyValue is already updated by the time we run. Skipping would prevent the first persist.

  // Taken when the save starts: a newer save of the property makes this one drop its value
  const writeKey = propertyWriteKey(seedLocalId ?? seedUid, propertyName)
  const writeTicket = writeKey ? beginPropertyWrite(writeKey) : undefined

  const _saveItemStorage = async (): Promise<boolean> => {
    if (!propertyName) {
      throw new Error('propertyName is required')
    }
    // The item's local seed: the row's when the context only knows the row
    const knownRow = localId ? ((await getItemPropertyData({ localId })) as MetadataType | undefined) : undefined
    const draftSeedLocalId = seedLocalId ?? knownRow?.seedLocalId ?? undefined
    const draftSeedUid = seedUid ?? knownRow?.seedUid ?? undefined
    if (!draftSeedLocalId) {
      throw new Error(`No metadata row to save ${propertyName} to`)
    }
    const head = await getLatestVersionRow(draftSeedLocalId)

    // Staged until the op applies, then moved into the item's file (ADR 0019)
    const stagingDir = BaseFileManager.getFilesPath('staging')
    await BaseFileManager.createDirIfNotExists(stagingDir)
    const stagedPath = BaseFileManager.getFilesPath('staging', generateId())
    await BaseFileManager.saveFile(stagedPath, newValue as string | Blob | ArrayBuffer)

    const written = await writeStorageValue<ItemStorageValueResult>(
      { seedLocalId: draftSeedLocalId, seedUid: draftSeedUid, propertyName },
      {
        itemStorage: {
          stagedPath,
          seedUid: draftSeedUid,
          versionLocalId: head?.localId ?? knownRow?.versionLocalId ?? undefined,
          versionUid: head?.uid ?? knownRow?.versionUid ?? undefined,
          modelType: (modelName ? easName(modelName) : knownRow?.modelType) || undefined,
          propertyRecordSchema,
        },
      },
      writeTicket,
    )
    // A newer value superseded this one; its save sets the context
    if (written.skipped || !written.result) return true
    const { fileName, localStorageDir } = written.result

    sendBack({
      type: 'updateContext',
      renderValue: newValue,
      // Where the file is, right away: localStoragePath (and so publish uploads) must not wait for
      // the browser's metadata live query, which Node does not have at all.
      refResolvedValue: fileName,
      localStorageDir,
      // Point the property at the draft row when the edit moved off a published row, and drop the
      // published row's uid with it: patch Publish skips a property that has one.
      localId: written.result.localId,
      uid: written.result.uid ?? undefined,
    })

    return true
  }

  _saveItemStorage()
    .finally(() => writeTicket?.end())
    .then((success) => {
      if (success) {
        sendBack({ type: 'saveItemStorageSuccess' })
      }
    })
    .catch((error) => {
      sendBack({ type: 'saveItemStorageError', error })
    })
})

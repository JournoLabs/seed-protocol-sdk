import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { BaseDb } from '@/db/Db/BaseDb'
import { getItemPropertyData } from '@/db/read/getItemProperty'
import { getItemData } from '@/db/read/getItemData'
import { and, eq } from 'drizzle-orm'
import { metadata } from '@/seedSchema'
import { createMetadata } from '@/db/write/createMetadata'
import fs from '@zenfs/core'

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
    propertyValue: existingValue,
  } = context

  if (!propertyRecordSchema) {
    throw new Error('Missing propertyRecordSchema')
  }

  let newValue: ItemPropertyValueType

  if (event) {
    newValue = event.newValue
  }

  if (existingValue === newValue) {
    sendBack({ type: 'saveValueToDbSuccess' })
    return
  }

  const _saveItemStorage = async (): Promise<boolean> => {
    // Save value to file
    const appDb = BaseDb.getAppDb()
    let propertyData

    if (localId) {
      propertyData = await getItemPropertyData({
        localId,
      })
    }

    if (!localId && seedLocalId) {
      const itemData = await getItemData({
        seedLocalId,
      })
      if (itemData) {
        const whereClauses = [
          eq(metadata.propertyName, propertyName),
          eq(metadata.seedLocalId, seedLocalId),
        ]

        if (itemData.latestVersionLocalId) {
          whereClauses.push(
            eq(metadata.versionLocalId, itemData.latestVersionLocalId),
          )
        }

        const queryRows = await appDb
          .select()
          .from(metadata)
          .where(and(...whereClauses))

        if (queryRows && queryRows.length) {
          propertyData = queryRows[0]
        }

        if (!propertyData) {
          const propertyDataRows = await createMetadata(
            {
              propertyName,
              modelType: modelName.toLowerCase(),
              seedLocalId,
              seedUid,
              versionLocalId: itemData.latestVersionLocalId,
              versionUid: itemData.latestVersionUid,
              localStorageDir: propertyRecordSchema.localStorageDir,
              refValueType: 'file',
            },
            propertyRecordSchema,
          )

          propertyData = propertyDataRows[0]
        }

        // propertyData = {
        //   propertyName,
        //   seedLocalId,
        //   seedUid,
        //   versionLocalId: itemData.latestVersionLocalId,
        //   versionUid: itemData.latestVersionUid,
        //   schemaUid: itemData.schemaUid,
        // }
      }
    }

    const localStorageDir =
      propertyRecordSchema.localStorageDir || propertyData.localStorageDir
    const fileName =
      propertyData.refResolvedValue ||
      `${propertyData.seedUid || propertyData.seedLocalId}${propertyRecordSchema.filenameSuffix}`

    if (!localStorageDir || !fileName) {
      throw new Error(
        `Missing localStorageDir: ${localStorageDir} or fileName: ${fileName}`,
      )
    }

    const filePath = `/files/${localStorageDir}/${fileName}`
    try {
      await fs.promises.writeFile(filePath, newValue)
    } catch (error) {
      fs.writeFileSync(filePath, newValue)
    }

    await appDb
      .update(metadata)
      .set({
        refResolvedValue: fileName,
      })
      .where(eq(metadata.localId, propertyData.localId))

    sendBack({
      type: 'updateContext',
      renderValue: newValue,
    })

    return true
  }

  _saveItemStorage().then((success) => {
    if (success) {
      sendBack({ type: 'saveItemStorageSuccess' })
    }
  })
})

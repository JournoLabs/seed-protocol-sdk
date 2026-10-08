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
import { metadata, type MetadataType } from '@/seedSchema'
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'
import { createMetadata } from '@/db/write/createMetadata'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

/** A local edit: no attestation uid of its own and not derived from one. */
const isLocalDraft = (row: Pick<MetadataType, 'uid' | 'derivedFromUid'>): boolean =>
  !row.uid && row.derivedFromUid == null

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

  // Do NOT skip when existingValue === newValue: the value setter sends updateContext before save,
  // so context.propertyValue is already updated by the time we run. Skipping would prevent the first persist.

  const _saveItemStorage = async (): Promise<boolean> => {
    // Save value to file
    const appDb = BaseDb.getAppDb()
    let propertyData: MetadataType | undefined

    if (localId) {
      propertyData = (await getItemPropertyData({
        localId,
      })) as MetadataType | undefined
    }

    // A synced row, or one sync derived from a storage_transaction_id attestation (its file is that
    // transaction's content, `<txid><ext>`), is published content. An edit never goes into it or its
    // file: sync may replace or delete it, and the edit would lose its row. The edit goes into the
    // current local draft, or a new one when there is none or a published row is newer than it
    // (readers show the newest row, so an edit kept in an older draft would stay hidden).
    const knownRow = propertyData
    const draftSeedLocalId = seedLocalId ?? knownRow?.seedLocalId ?? undefined
    const draftSeedUid = seedUid ?? knownRow?.seedUid ?? undefined

    if (draftSeedLocalId) {
      if (!propertyName) {
        throw new Error('propertyName is required')
      }
      const itemData = await getItemData({
        seedLocalId: draftSeedLocalId,
      })
      const versionLocalId =
        itemData?.latestVersionLocalId ?? knownRow?.versionLocalId ?? undefined
      const versionUid = itemData?.latestVersionUid ?? knownRow?.versionUid ?? undefined

      const whereClauses = [
        eq(metadata.propertyName, propertyName),
        eq(metadata.seedLocalId, draftSeedLocalId),
      ]
      if (versionLocalId) {
        whereClauses.push(eq(metadata.versionLocalId, versionLocalId))
      }
      const queryRows: MetadataType[] = await appDb
        .select()
        .from(metadata)
        .where(and(...whereClauses))

      const latest = [...queryRows].sort(compareMetadataRowsLatestFirst)[0]
      propertyData = latest && isLocalDraft(latest) ? latest : undefined

      if (!propertyData && newValue) {
        const filename = `${draftSeedUid || draftSeedLocalId}${propertyRecordSchema.filenameSuffix}`
        const dir = propertyRecordSchema.localStorageDir?.replace(/^\//, '') || 'files'
        await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath(dir))
        const writeToPath = BaseFileManager.getFilesPath(dir, filename)
        await BaseFileManager.saveFile(writeToPath, newValue as string | Blob | ArrayBuffer)

        propertyData = await createMetadata(
          {
            propertyName,
            propertyValue: filename,
            modelType: (modelName ?? knownRow?.modelType ?? '').toLowerCase() || undefined,
            seedLocalId: draftSeedLocalId,
            seedUid: draftSeedUid,
            versionLocalId,
            versionUid,
            localStorageDir: propertyRecordSchema.localStorageDir,
            refValueType: 'file',
          },
          propertyRecordSchema,
        )
      }
    } else if (propertyData && !isLocalDraft(propertyData)) {
      propertyData = undefined
    }

    if (!propertyData) {
      throw new Error(`No metadata row to save ${propertyName} to`)
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

    const dir = localStorageDir.replace(/^\//, '')
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath(dir))
    const filePath = BaseFileManager.getFilesPath(dir, fileName)
    try {
      await BaseFileManager.saveFile(filePath, newValue as string | Blob | ArrayBuffer)
    } catch (error) {
      const fs = await BaseFileManager.getFs()
      fs.writeFileSync(filePath, newValue)
    }

    await appDb
      .update(metadata)
      .set({
        refResolvedValue: fileName,
      })
      .where(eq(metadata.localId, propertyData.localId!))

    sendBack({
      type: 'updateContext',
      renderValue: newValue,
      // Point the property at the draft row when the edit moved off a published row.
      ...(propertyData.localId !== localId && { localId: propertyData.localId }),
    })

    return true
  }

  _saveItemStorage()
    .then((success) => {
      if (success) {
        sendBack({ type: 'saveItemStorageSuccess' })
      }
    })
    .catch((error) => {
      sendBack({ type: 'saveItemStorageError', error })
    })
})

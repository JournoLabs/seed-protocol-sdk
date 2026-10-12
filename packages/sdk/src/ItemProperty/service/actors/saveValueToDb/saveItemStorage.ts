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
import { writeItemStorageFile } from '@/helpers/itemStorageFile'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'

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
        const { fileName: filename } = await writeItemStorageFile(
          {
            seedId: draftSeedUid || draftSeedLocalId,
            localStorageDir: propertyRecordSchema.localStorageDir,
            filenameSuffix: propertyRecordSchema.filenameSuffix,
          },
          newValue as string | Blob | ArrayBuffer,
        )

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

    // No storage.path: the `files` directory, as resolveItemStorageChildFile and download assume.
    const localStorageDir =
      propertyRecordSchema.localStorageDir || propertyData.localStorageDir || '/files'
    const seedId = propertyData.seedUid || propertyData.seedLocalId
    if (!propertyData.refResolvedValue && !seedId) {
      throw new Error(`Missing a seed id to name the ${propertyName} file after`)
    }

    const fileName =
      propertyData.refResolvedValue ||
      getItemStorageLocalFileName(seedId ?? '', propertyRecordSchema.filenameSuffix)
    try {
      await writeItemStorageFile(
        { seedId: seedId ?? '', localStorageDir, fileName },
        newValue as string | Blob | ArrayBuffer,
      )
    } catch (error) {
      const fs = await BaseFileManager.getFs()
      fs.writeFileSync(
        BaseFileManager.getFilesPath(getItemStorageSubdir(localStorageDir), fileName),
        newValue,
      )
    }

    // A legacy row (made before Item.create saved ItemStorage values) holds the old content itself
    // in propertyValue. The file is the content now: drop it, or a fresh load shows the old text
    // until the file is read. A row whose propertyValue is the file name keeps it.
    const clearsVerbatimValue =
      !propertyData.refResolvedValue &&
      propertyData.propertyValue != null &&
      propertyData.propertyValue !== '' &&
      propertyData.propertyValue !== fileName

    // The row says where the file is (read back by hydration, the browser's metadata live query
    // and publish); without localStorageDir the live query would clear it from the context.
    await appDb
      .update(metadata)
      .set({
        refResolvedValue: fileName,
        localStorageDir,
        ...(clearsVerbatimValue && { propertyValue: null }),
      })
      .where(eq(metadata.localId, propertyData.localId!))

    sendBack({
      type: 'updateContext',
      renderValue: newValue,
      // Where the file is, right away: localStoragePath (and so publish uploads) must not wait for
      // the browser's metadata live query, which Node does not have at all.
      refResolvedValue: fileName,
      localStorageDir,
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

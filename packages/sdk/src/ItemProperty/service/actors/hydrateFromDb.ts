import { EventObject, fromCallback } from 'xstate'
import { and, eq, or, sql } from 'drizzle-orm'
import debug from 'debug'
import { metadata } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { updateMetadata } from '@/db/write/updateMetadata'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'
import { BaseFileManager, getMetadataPropertyNamesForQuery } from '@/helpers'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { normalizeDataType } from '@/helpers/property'
import { downloadTransactionIdWithDedupe } from '@/events/files/download'
import {
  readHtmlBodyForStorageSeedPropertyValue,
  resolveHtmlStorageSeedLocalId,
} from '@/helpers/readHtmlBodyForStorageSeed'

// Dynamic import to break circular dependency: schema/index -> ... -> hydrateFromDb -> schema/index
// import { ModelPropertyDataTypes } from '@/schema'

const logger = debug('seedSdk:property:actors:hydrateFromDb')

export const hydrateFromDb = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, EventObject>
>(({ sendBack, input: { context } }) => {
  const {
    seedUid,
    seedLocalId,
    propertyName: propertyNameRaw,
    propertyRecordSchema,
    modelName,
  } = context

  if (!propertyNameRaw) {
    throw new Error('propertyName is required')
  }
  let propertyName = propertyNameRaw

  // Note: isRelation, isImage, isFile checks moved inside async function
  // to use dynamically imported ModelPropertyDataTypes

  const _hydrateFromDb = async () => {
    // Use dynamic import to break circular dependency
    const schemaMod = await import('../../../Schema')
    const { ModelPropertyDataTypes } = schemaMod
    
    const appDb = BaseDb.getAppDb()

    const whereClauses = []

    // Re-check types with dynamically imported ModelPropertyDataTypes
    // Use normalizeDataType for case-insensitive comparison (schema may use "image" vs "Image")
    const normalizedDataType = normalizeDataType(propertyRecordSchema?.dataType)
    const normalizedRefValueType = normalizeDataType(propertyRecordSchema?.refValueType)

    const isRelationDynamic =
      propertyRecordSchema &&
      propertyRecordSchema.ref &&
      normalizedDataType === ModelPropertyDataTypes.Relation

    const isImageDynamic =
      propertyRecordSchema &&
      (normalizedDataType === ModelPropertyDataTypes.Image ||
        normalizedRefValueType === ModelPropertyDataTypes.Image)

    const isFileDynamic =
      propertyRecordSchema &&
      normalizedDataType === ModelPropertyDataTypes.File

    const isHtmlDynamic =
      propertyRecordSchema &&
      normalizedDataType === ModelPropertyDataTypes.Html

    // Html/Image/File/Relation store metadata with Id suffix (e.g. htmlId); query both variants
    const propertyNames = getMetadataPropertyNamesForQuery(
      propertyName,
      normalizedDataType,
      normalizedRefValueType
    )
    whereClauses.push(
      propertyNames.length > 1
        ? or(...propertyNames.map((n) => eq(metadata.propertyName, n)))
        : eq(metadata.propertyName, propertyNames[0])
    )

    // Draft rows often have only seed_local_id populated; on-chain rows may have uid.
    // Requiring both with AND misses valid metadata when only one column is set.
    if (seedUid && seedLocalId) {
      whereClauses.push(
        or(
          eq(metadata.seedLocalId, seedLocalId),
          eq(metadata.seedUid, seedUid),
        ) as any,
      )
    } else if (seedUid) {
      whereClauses.push(eq(metadata.seedUid, seedUid))
    } else if (seedLocalId) {
      whereClauses.push(eq(metadata.seedLocalId, seedLocalId))
    }

    const rows = await appDb
      .select()
      .from(metadata)
      .where(and(...whereClauses))
      .orderBy(sql.raw('COALESCE(attestation_created_at, created_at) DESC'))

    if (!rows || !rows.length) {
      return
    }

    const firstRow = rows[0]

    const {
      localId,
      uid,
      propertyName: propertyNameFromDb,
      propertyValue: propertyValueFromDb,
      seedLocalId: seedLocalIdFromDb,
      seedUid: seedUidFromDb,
      schemaUid: schemaUidFromDb,
      versionLocalId: versionLocalIdFromDb,
      versionUid: versionUidFromDb,
      refValueType,
    } = firstRow

    let { refResolvedDisplayValue, refResolvedValue, localStorageDir } = firstRow

    let propertyValueProcessed: string | string[] | undefined | null =
      propertyValueFromDb
    let renderValue: string | string[] | undefined = refResolvedDisplayValue ?? undefined


    // Image: always resolve display value from file (blob URLs in DB are invalid after reload)
    if (isImageDynamic) {
      let dir = localStorageDir
      if (!dir && isImageDynamic) {
        dir = 'images'
      }
      dir = dir!.replace(/^\//, '')

      if (
        propertyValueFromDb &&
        propertyValueFromDb.length === 66
      ) {
        // Here the storageTransactionId is stored on a different record and
        // we want to add it as the refResolvedValue
        const storageTransactionQuery = await appDb
          .select({
            propertyValue: metadata.propertyValue,
          })
          .from(metadata)
          .where(
            and(
              eq(metadata.seedUid, propertyValueFromDb),
              or(
                eq(metadata.propertyName, 'storageTransactionId'),
                eq(metadata.propertyName, 'transactionId'),
              ),
            ),
          )

        if (storageTransactionQuery && storageTransactionQuery.length > 0) {
          const row = storageTransactionQuery[0]
          refResolvedValue = row.propertyValue
          await updateMetadata({
            localId,
            refResolvedValue,
            localStorageDir: '/images',
          })
        }
      }

      const resolveMatchingFilePath = async (dir: string, needle: string): Promise<string | undefined> => {
        const dirPath = BaseFileManager.getFilesPath(dir)
        const dirExists = await BaseFileManager.pathExists(dirPath)
        if (!dirExists) return undefined
        const fs = await BaseFileManager.getFs()
        const path = BaseFileManager.getPathModule()
        const files = await fs.promises.readdir(dirPath)
        const matchingFiles = files.filter((file: string) => {
          return path.basename(file).includes(needle)
        })
        if (!matchingFiles?.length) return undefined
        return BaseFileManager.getFilesPath(dir, matchingFiles[0])
      }

      if (refResolvedValue) {
        try {
          let filePath = await resolveMatchingFilePath(dir, refResolvedValue)
          if (!filePath) {
            await downloadTransactionIdWithDedupe(refResolvedValue)
            filePath = await resolveMatchingFilePath(dir, refResolvedValue)
          }

          localStorageDir = `/${dir}`
          if (filePath) {
            const file = await BaseFileManager.readFile(filePath)
            refResolvedDisplayValue = URL.createObjectURL(file)
            renderValue = refResolvedDisplayValue
            // Do not persist blob URL - it is session-scoped
          }
        } catch (e) {
          logger('[hydrateFromDb] Image file resolution error', e)
        }
      }
    }

    if (isFileDynamic && refResolvedValue) {
      try {
        const dir = (localStorageDir ?? '/files').replace(/^\//, '')
        const resolveMatchingFilePath = async (needle: string): Promise<string | undefined> => {
          const dirPath = BaseFileManager.getFilesPath(dir)
          const dirExists = await BaseFileManager.pathExists(dirPath)
          if (!dirExists) return undefined
          const fs = await BaseFileManager.getFs()
          const path = BaseFileManager.getPathModule()
          const files = await fs.promises.readdir(dirPath)
          const matchingFiles = files.filter((file: string) =>
            path.basename(file).includes(needle)
          )
          if (!matchingFiles?.length) return undefined
          return BaseFileManager.getFilesPath(dir, matchingFiles[0])
        }

        let filePath = await resolveMatchingFilePath(refResolvedValue)
        if (!filePath) {
          await downloadTransactionIdWithDedupe(refResolvedValue)
          filePath = await resolveMatchingFilePath(refResolvedValue)
        }
        if (filePath) {
          localStorageDir = `/${dir}`
          renderValue = await BaseFileManager.readFileAsString(filePath)
        }
      } catch (e) {
        logger('[hydrateFromDb] File resolution error', e)
      }
    }

    if (
      propertyRecordSchema &&
      normalizedDataType === ModelPropertyDataTypes.List &&
      typeof propertyValueFromDb === 'string'
    ) {
      propertyValueProcessed = parseListPropertyValueFromStorage(propertyValueFromDb)
    }

    sendBack({
      type: 'updateContext',
      localId,
      uid,
      propertyValue: propertyValueProcessed,
      seedLocalId: seedLocalIdFromDb,
      seedUid: seedUidFromDb,
      versionLocalId: versionLocalIdFromDb,
      versionUid: versionUidFromDb,
      schemaUid: schemaUidFromDb,
      refValueType,
      localStorageDir,
      refResolvedValue,
      refResolvedDisplayValue,
      renderValue,
      populatedFromDb: true,
    })

    if (
      propertyRecordSchema &&
      propertyRecordSchema.storageType &&
      propertyRecordSchema.storageType === 'ItemStorage'
    ) {
      const itemMod = await import(`@/Item/Item`)
      const { Item } = itemMod
      const item = await Item.find({
        seedLocalId: seedLocalId ?? undefined,
        modelName,
      })
      if (item) {
        const dir = localStorageDir?.replace(/^\//, '') || 'files'
        const filePath = BaseFileManager.getFilesPath(dir, refResolvedValue)
        const exists = await BaseFileManager.pathExists(filePath)

        if (!exists) {
          return
        }

        const renderValue = await BaseFileManager.readFileAsString(filePath)
        const property = item.properties.find(p => p.propertyName === propertyName)
        if (property) {
          property.getService().send({ type: 'updateContext', renderValue })
        }
        return
      }
    }

    // Html: read file content for renderValue (blob URLs from DB are invalid after reload).
    // When propertyValue is the Html storage seed uid, resolve localId and read `html/{localId}.html`.
    if (isHtmlDynamic) {
      const htmlLocalStorageDir =
        refResolvedValue && !localStorageDir ? '/html' : localStorageDir ?? '/html'
      let htmlContent: string | undefined
      let outRef = refResolvedValue
      let outDir = htmlLocalStorageDir
      if (refResolvedValue && htmlLocalStorageDir) {
        const dir = htmlLocalStorageDir.replace(/^\//, '')
        const filePath = BaseFileManager.getFilesPath(dir, refResolvedValue)
        let exists = await BaseFileManager.pathExists(filePath)
        if (!exists) {
          await BaseFileManager.waitForFileWithContent(filePath, 100, 5000).catch(() => {})
          exists = await BaseFileManager.pathExists(filePath)
        }
        if (exists) {
          htmlContent = await BaseFileManager.readFileAsString(filePath)
        }
      }
      if (!htmlContent && propertyValueFromDb) {
        htmlContent = await readHtmlBodyForStorageSeedPropertyValue(propertyValueFromDb)
        const lid = await resolveHtmlStorageSeedLocalId(String(propertyValueFromDb))
        if (lid) {
          outRef = `${lid}.html`
          outDir = '/html'
        }
      }
      if (htmlContent) {
        sendBack({
          type: 'updateContext',
          localId,
          uid,
          propertyValue: propertyValueProcessed,
          seedLocalId: seedLocalIdFromDb,
          seedUid: seedUidFromDb,
          versionLocalId: versionLocalIdFromDb,
          versionUid: versionUidFromDb,
          schemaUid: schemaUidFromDb,
          refValueType,
          localStorageDir: outDir,
          refResolvedValue: outRef ?? refResolvedValue,
          refResolvedDisplayValue,
          renderValue: htmlContent,
          populatedFromDb: true,
        })
        return
      }
    }
  }

  _hydrateFromDb().then(() => {
    sendBack({ type: 'hydrateFromDbSuccess' })
  })
})

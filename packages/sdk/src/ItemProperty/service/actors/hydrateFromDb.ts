import { EventObject, fromCallback } from 'xstate'
import { and, eq, or, sql } from 'drizzle-orm'
import debug from 'debug'
import { metadata } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { updateMetadata } from '@/db/write/updateMetadata'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'
import { BaseFileManager, getMetadataPropertyNamesForQuery } from '@/helpers'
import { normalizeDataType } from '@/helpers/property'
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

    if (seedUid) {
      whereClauses.push(eq(metadata.seedUid, seedUid))
    }

    if (seedLocalId) {
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

      if (refResolvedValue) {
        try {
          const dirPath = BaseFileManager.getFilesPath(dir)
          const dirExists = await BaseFileManager.pathExists(dirPath)
          if (dirExists) {
            const fs = await BaseFileManager.getFs()
            const path = BaseFileManager.getPathModule()
            const files = await fs.promises.readdir(dirPath)
            const matchingFiles = files.filter((file: string) => {
              return path.basename(file).includes(refResolvedValue!)
            })
            let fileExists = false
            let filename
            let filePath
            if (matchingFiles && matchingFiles.length > 0) {
              fileExists = true
              filename = matchingFiles[0]
              filePath = BaseFileManager.getFilesPath(dir, filename)
            }
            localStorageDir = `/${dir}`
            if (fileExists && filename && filePath) {
              const file = await BaseFileManager.readFile(filePath)
              refResolvedDisplayValue = URL.createObjectURL(file)
              // Do not persist blob URL - it is session-scoped
            }
          }
        } catch (e) {
          logger('[hydrateFromDb] Image file resolution error', e)
        }
      }
    }

    if (
      propertyRecordSchema &&
      propertyRecordSchema.dataType === ModelPropertyDataTypes.List &&
      propertyRecordSchema.ref &&
      typeof propertyValueFromDb === 'string'
    ) {
      propertyValueProcessed = propertyValueFromDb.split(',')
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
      renderValue: refResolvedDisplayValue,
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

    // Html: read file content for renderValue (blob URLs from DB are invalid after reload)
    // Fallback: when localStorageDir is null (e.g. EAS sync, legacy records) use '/html'
    const htmlLocalStorageDir = isHtmlDynamic && refResolvedValue && !localStorageDir ? '/html' : localStorageDir
    // #region agent log
    if (isHtmlDynamic) {
      fetch('http://127.0.0.1:7242/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'413b74'},body:JSON.stringify({sessionId:'413b74',location:'hydrateFromDb.ts:htmlCheck',message:'Html hydrate path check',data:{refResolvedValue,localStorageDir,htmlLocalStorageDir,willReadFile:!!(refResolvedValue&&htmlLocalStorageDir)},timestamp:Date.now(),hypothesisId:'hydrate'})}).catch(()=>{});
    }
    // #endregion
    if (isHtmlDynamic && refResolvedValue && htmlLocalStorageDir) {
      const dir = htmlLocalStorageDir.replace(/^\//, '')
      const filePath = BaseFileManager.getFilesPath(dir, refResolvedValue)
      const exists = await BaseFileManager.pathExists(filePath)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'413b74'},body:JSON.stringify({sessionId:'413b74',location:'hydrateFromDb.ts:html',message:'Html hydrate file read',data:{refResolvedValue,localStorageDir,filePath,exists,propertyValueFromDb},timestamp:Date.now(),hypothesisId:'hydrate'})}).catch(()=>{});
      // #endregion
      if (exists) {
        const htmlContent = await BaseFileManager.readFileAsString(filePath)
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
          localStorageDir: htmlLocalStorageDir,
          refResolvedValue,
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

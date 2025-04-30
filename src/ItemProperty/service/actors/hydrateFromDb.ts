import { EventObject, fromCallback } from 'xstate'
import { and, eq, or, sql } from 'drizzle-orm'
import debug from 'debug'
import { metadata } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { updateMetadata } from '@/db/write/updateMetadata'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'
import { BaseFileManager } from '@/helpers'

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

  let propertyName = propertyNameRaw

  const isRelation =
    propertyRecordSchema &&
    propertyRecordSchema.ref &&
    propertyRecordSchema.dataType === 'Relation'

  const isImage =
    propertyRecordSchema &&
    propertyRecordSchema.dataType === 'Image'

  const isFile =
    propertyRecordSchema &&
    propertyRecordSchema.dataType === 'File'

  if (
    (
      isRelation || 
      isImage ||
      isFile
    ) &&
    !propertyNameRaw.endsWith('Id')
  ) {
    propertyName = propertyNameRaw + 'Id'
  }

  if (
    propertyRecordSchema &&
    propertyRecordSchema.ref &&
    propertyRecordSchema.dataType === 'List' &&
    !propertyNameRaw.endsWith('Ids')
  ) {
    propertyName = propertyNameRaw + 'Ids'
  }

  const _hydrateFromDb = async () => {
    const appDb = BaseDb.getAppDb()

    const whereClauses = []

    if (isRelation || isImage || isFile) {
      let missingPropertyNameVariant
      if (propertyName.endsWith('Id')) {
        missingPropertyNameVariant = propertyName.slice(0, -2)
      }
      if (!propertyName.endsWith('Id')) {
        missingPropertyNameVariant = propertyName + 'Id'
      }
      if (missingPropertyNameVariant) {
        whereClauses.push(
          or(
            eq(metadata.propertyName, propertyName),
            eq(metadata.propertyName, missingPropertyNameVariant),
          ),
        )
      }
      if (!missingPropertyNameVariant) {
        whereClauses.push(eq(metadata.propertyName, propertyName))
      }
    } else {
      whereClauses.push(eq(metadata.propertyName, propertyName))
    }

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


    if (isImage) {
      let shouldReadFromFile = true

      if (
        refResolvedValue &&
        refResolvedDisplayValue &&
        refResolvedDisplayValue.includes('http')
      ) {
        try {
          const response = await fetch(refResolvedDisplayValue, {
            method: 'HEAD',
          }).catch((error) => {
            // No-op
            shouldReadFromFile = true
          })

          if (!response || !response.ok) {
            shouldReadFromFile = true
          }

          // Check if the status is in the 200-299 range
          if (response && response.ok) {
            shouldReadFromFile = false
          }
        } catch (error) {
          shouldReadFromFile = true
        }
      }

      if (shouldReadFromFile) {
        let dir = localStorageDir
        if (
          !dir &&
          isImage
        ) {
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

        const dirPath = `/files/${dir}`
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
          filePath = `/files/${dir}/${filename}`
        }
        localStorageDir = `/${dir}`
        if (fileExists && filename && filePath) {
          const file = await BaseFileManager.readFile(filePath)
          refResolvedDisplayValue = URL.createObjectURL(file)
          await updateMetadata({
            localId,
            refResolvedValue: filename,
            refResolvedDisplayValue: refResolvedDisplayValue,
            localStorageDir,
          })
        }

      }
    }

    if (
      propertyRecordSchema &&
      propertyRecordSchema.dataType === 'List' &&
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
      const { BaseItem } = await import(`@/Item/BaseItem`)
      const item = await BaseItem.find({
        seedLocalId,
        modelName,
      })
      if (item) {
        const filePath = `/files/${localStorageDir}/${refResolvedValue}`
        const exists = await BaseFileManager.pathExists(filePath)

        if (!exists) {
          return
        }

        const renderValue = await BaseFileManager.readFileAsString(filePath)
        const property = item.properties[propertyName]
        property.getService().send({ type: 'updateContext', renderValue })
        return
      }
    }
  }

  _hydrateFromDb().then(() => {
    sendBack({ type: 'hydrateFromDbSuccess' })
  })
})

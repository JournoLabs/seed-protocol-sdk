import { EventObject, fromCallback } from 'xstate'
import { and, eq, or, sql } from 'drizzle-orm'
import debug from 'debug'
import { fs } from '@zenfs/core'
import { metadata } from 'src/shared/seedSchema'
import { getAppDb } from '@/browser/db/sqlWasmClient'
import { updateMetadata } from '@/browser/db/write/updateMetadata'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'
import path from 'path'

const logger = debug('app:property:actors:hydrateFromDb')

export const hydrateFromDb = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, EventObject>
>(({ sendBack, input: { context } }) => {
  const {
    seedUid,
    seedLocalId,
    propertyName: propertyNameRaw,
    propertyValue,
    propertyRecordSchema,
    modelName,
  } = context

  let propertyName = propertyNameRaw

  if (
    propertyRecordSchema &&
    propertyRecordSchema.ref &&
    propertyRecordSchema.dataType === 'Relation' &&
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
    const appDb = getAppDb()

    const isRelation =
      propertyRecordSchema &&
      propertyRecordSchema.ref &&
      propertyRecordSchema.dataType === 'Relation'

    const whereClauses = []

    if (isRelation) {
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
      localStorageDir,
    } = firstRow

    let { refResolvedDisplayValue, refResolvedValue } = firstRow

    let propertyValueProcessed: string | string[] | undefined | null =
      propertyValueFromDb

    if (propertyName && !propertyNameFromDb) {
      logger(
        `Property name from code is ${propertyName} but has not value in db ${propertyNameFromDb} for Property.${localId}`,
      )
    }

    if (
      propertyName &&
      propertyNameFromDb &&
      !propertyNameFromDb.includes(propertyName) &&
      !propertyName.includes(propertyNameFromDb) &&
      propertyNameFromDb !== propertyName
    ) {
      logger(
        `Property name from db ${propertyNameFromDb} does not match property name ${propertyName} for Property.${localId}`,
      )
    }

    if (propertyValue && propertyValueFromDb !== propertyValue) {
      logger(
        `Property value from db ${propertyValueFromDb} does not match property value ${propertyValue} for Property.${localId}`,
      )
    }

    if (seedLocalIdFromDb !== seedLocalId) {
      logger(
        `Seed local id from db ${seedLocalIdFromDb} does not match seed local id ${seedLocalId} for Property.${localId}`,
      )
    }

    if (seedUidFromDb !== seedUid) {
      logger(
        `Seed uid from db ${seedUidFromDb} does not match seed uid ${seedUid} for Property.${localId}`,
      )
    }

    if (
      propertyRecordSchema &&
      propertyRecordSchema.refValueType === 'ImageSrc'
    ) {
      let shouldReadFromFile = true

      if (
        refResolvedValue &&
        refResolvedDisplayValue &&
        refResolvedDisplayValue.includes('http')
      ) {
        try {
          const response = await fetch(refResolvedDisplayValue, {
            method: 'HEAD',
          })

          // Check if the status is in the 200-299 range
          if (response.ok) {
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
          propertyRecordSchema &&
          propertyRecordSchema.refValueType === 'ImageSrc'
        ) {
          dir = 'images'
        }

        dir = dir!.replace(/^\//, '')

        if (
          !refResolvedValue &&
          propertyValueFromDb &&
          propertyValueFromDb.length === 66
        ) {
          const storageTransactionQuery = await appDb
            .select({
              propertyValue: metadata.propertyValue,
            })
            .from(metadata)
            .where(
              and(
                eq(metadata.seedUid, propertyValueFromDb),
                eq(metadata.propertyName, 'storageTransactionId'),
              ),
            )

          if (storageTransactionQuery && storageTransactionQuery.length > 0) {
            const row = storageTransactionQuery[0]
            refResolvedValue = row.propertyValue
            console.log('storageTransactionId', refResolvedValue)
            await updateMetadata({
              localId,
              refResolvedValue,
              localStorageDir: '/images',
            })
          }
        }

        const dirPath = `/files/${dir}`
        const files = await fs.promises.readdir(dirPath)
        const matchingFiles = files.filter((file) => {
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
        if (fileExists && filename && filePath) {
          const fileContents = await fs.promises.readFile(filePath)
          const fileHandler = new File([fileContents], filename)
          refResolvedDisplayValue = URL.createObjectURL(fileHandler)
          await updateMetadata({
            localId,
            refResolvedValue: filename,
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
      const { Item } = await import(`@/browser/item`)
      const item = await Item.find({
        seedLocalId,
        modelName,
      })
      if (item) {
        const filePath = `/files/${localStorageDir}/${refResolvedValue}`
        const exists = await fs.promises.exists(filePath)

        if (!exists) {
          return
        }

        const renderValue = await fs.promises.readFile(filePath, 'utf8')
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

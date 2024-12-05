import { EventObject, fromCallback } from 'xstate'
import { propertyMachine } from '../propertyMachine'
import { and, eq, or, sql } from 'drizzle-orm'
import { escapeSqliteString } from '@/shared/helpers/db'
import debug from 'debug'
import { fs } from '@zenfs/core'
import { metadata } from 'src/shared/seedSchema'
import { getAppDb } from '@/browser/db/sqlWasmClient'

const logger = debug('app:property:actors:hydrateFromDb')

export const hydrateFromDb = fromCallback<EventObject, typeof propertyMachine>(
  ({ sendBack, input: { context } }) => {
    const {
      seedUid,
      seedLocalId,
      propertyName: propertyNameRaw,
      propertyValue,
      propertyRecordSchema,
      itemModelName,
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
      const db = getAppDb()

      let hydrateQuery
      let safeValue = propertyValue
      let propertyValueQueryString = `property_value `
      let propertyNameQueryString = `property_name = '${propertyName}'`
      let propertyNameQuery = eq(metadata.propertyName, propertyName)

      if (safeValue && typeof propertyValue === 'string') {
        safeValue = escapeSqliteString(propertyValue)
        propertyValueQueryString += `= '${safeValue}'`
      }

      if (!safeValue) {
        propertyValueQueryString += 'IS NULL'
      }

      if (typeof propertyValue === 'number') {
        propertyValueQueryString += `= ${propertyValue}`
      }

      if (
        propertyRecordSchema &&
        propertyRecordSchema.ref &&
        propertyRecordSchema.dataType === 'Relation'
      ) {
        let missingPropertyNameVariant
        if (propertyName.endsWith('Id')) {
          missingPropertyNameVariant = propertyName.slice(0, -2)
        }
        if (!propertyName.endsWith('Id')) {
          missingPropertyNameVariant = propertyName + 'Id'
        }
        propertyNameQuery = or(
          eq(metadata.propertyName, propertyName),
          eq(metadata.propertyName, missingPropertyNameVariant),
        )
      }

      const selectFromStatement = db.select().from(metadata)

      if (seedUid && !seedLocalId) {
        hydrateQuery = selectFromStatement.where(
          and(eq(metadata.seedUid, seedUid), propertyNameQuery),
        )
      }

      if (seedUid && seedLocalId) {
        hydrateQuery = selectFromStatement.where(
          and(
            eq(metadata.seedLocalId, seedLocalId),
            eq(metadata.seedUid, seedUid),
            propertyNameQuery,
          ),
        )
      }

      if (!seedUid && seedLocalId) {
        hydrateQuery = selectFromStatement.where(
          and(eq(metadata.seedLocalId, seedLocalId), propertyNameQuery),
        )
      }

      if (!hydrateQuery) {
        return
      }

      const rows = await hydrateQuery.orderBy(
        sql.raw('COALESCE(attestation_created_at, created_at) DESC'),
      )

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
        refResolvedValue,
        localStorageDir,
      } = firstRow

      let { refResolvedDisplayValue } = firstRow

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
        refResolvedValue &&
        refResolvedDisplayValue &&
        refResolvedDisplayValue.includes('http')
      ) {
        let urlNeedsToBeRefreshed = false

        try {
          const response = await fetch(refResolvedDisplayValue, {
            method: 'HEAD',
          })

          // Check if the status is in the 200-299 range
          if (!response.ok) {
            urlNeedsToBeRefreshed = true
          }
        } catch (error) {
          urlNeedsToBeRefreshed = true
        }

        if (urlNeedsToBeRefreshed) {
          const filePath = `/files/${localStorageDir}/${refResolvedValue}`
          const fileExists = await fs.promises.exists(filePath)
          if (fileExists) {
            const fileContents = await fs.promises.readFile(filePath)
            const fileHandler = new File([fileContents], refResolvedValue)
            refResolvedDisplayValue = URL.createObjectURL(fileHandler)
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
        resolvedValue: refResolvedValue,
        resolvedDisplayValue: refResolvedDisplayValue,
        renderValue: refResolvedDisplayValue,
      })

      if (
        propertyRecordSchema &&
        propertyRecordSchema.storageType &&
        propertyRecordSchema.storageType === 'ItemStorage'
      ) {
        const { Item } = await import(`@/browser/item`)
        const item = await Item.find({
          seedLocalId,
          modelName: itemModelName,
        })
        if (item) {
          const filePath = `/files/${localStorageDir}/${refResolvedValue}`
          const exists = await fs.promises.exists(filePath)

          if (!exists) {
            return
          }

          const renderValue = await fs.promises.readFile(filePath, 'utf8')
          const property = item.properties[propertyName]
          property.getService().send({ type: 'updateRenderValue', renderValue })
          return
        }
      }
    }

    _hydrateFromDb().then(() => {
      sendBack({ type: 'hydrateFromDbSuccess' })
    })
  },
)

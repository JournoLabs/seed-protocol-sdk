import { Attestation } from '@/browser/gql/graphql'
import { sql } from 'drizzle-orm'
import { generateId } from '@/shared/helpers'
import { escapeSqliteString } from '@/shared/helpers/db'
import { camelCase } from 'lodash-es'

import { getVersionsForVersionUids } from '@/browser/db/read/getVersionsForVersionUids'
import debug from 'debug'
import { getAppDb } from '@/browser/db/sqlWasmClient'

const logger = debug('app:property:save')

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]

const seedUidToLocalId = new Map<string, string>()
const seedUidToModelType = new Map<string, string>()

const versionUidToLocalId = new Map<string, string>()
const versionUidToSeedUid = new Map<string, string>()

const propertyUidToLocalId = new Map<string, string>()

export const savePropertiesToDb = async (properties: Attestation[]) => {
  const appDb = getAppDb()

  const propertyUids = properties.map((property) => property.id)
  const versionUids = properties.map((property) => property.refUID)

  const existingRecordsQuery = await appDb.run(
    sql.raw(
      `SELECT uid, local_id
       FROM metadata
       WHERE uid IN ('${propertyUids.join("','")}');`,
    ),
  )

  const existingRecordsUids = new Set<string>()

  if (
    existingRecordsQuery &&
    existingRecordsQuery.rows &&
    existingRecordsQuery.rows.length > 0
  ) {
    for (const row of existingRecordsQuery.rows) {
      existingRecordsUids.add(row[0])
      propertyUidToLocalId.set(row[0], row[1])
    }
  }

  const newProperties = properties.filter(
    (property) => !existingRecordsUids.has(property.id),
  )

  if (newProperties.length === 0) {
    return { propertyUids }
  }

  let insertPropertiesQuery = `INSERT INTO metadata (local_id, uid, schema_uid, property_name, property_value,
                                                     eas_data_type, version_uid, version_local_id, seed_uid,
                                                     seed_local_id, model_type, created_at, attestation_created_at,
                                                     attestation_raw)
  VALUES `

  for (let i = 0; i < newProperties.length; i++) {
    const property = newProperties[i]
    const propertyLocalId = generateId()
    const metadata = JSON.parse(property.decodedDataJson)[0].value

    let propertyNameSnake = metadata.name

    if (!propertyNameSnake) {
      propertyNameSnake = metadata.name
    }

    if (!propertyNameSnake) {
      logger(
        '[item/events] [syncDbWithEas] no propertyName found for property: ',
        property,
      )
      return
    }

    let isRelation = false
    let refValueType = 'single'
    let refResolvedValue
    let refResolvedDisplayValue

    if (
      (propertyNameSnake.endsWith('_id') ||
        propertyNameSnake.endsWith('_ids')) &&
      propertyNameSnake !== 'storage_transaction_id' &&
      propertyNameSnake !== 'storage_provider_transaction_id'
    ) {
      isRelation = true
      let isList = false

      if (Array.isArray(metadata.value)) {
        isList = true
        refValueType = 'list'

        // const relatedValuesQuery = await appDb.run(
        //   sql.raw(
        //     `SELECT s.uid, MAX(v.attestation_created_at) as last_published_at
        //      FROM seeds s
        //               JOIN versions v ON s.local_id = v.seed_local_id
        //               JOIN metadata m ON v.local_id = m.version_local_id
        //      WHERE s.uid IN ('${metadata.value.join("','")}')
        //        AND m.property_name = 'storage_transation_id';`,
        //   ),
        // )
        //
        // if (
        //   relatedValuesQuery &&
        //   relatedValuesQuery.rows &&
        //   relatedValuesQuery.rows.length > 0
        // ) {
        //   for (const row of relatedValuesQuery.rows) {
        //     // relatedSeedUids.add(row[0])
        //   }
        // }
      }

      if (!isList) {
        if (relationValuesToExclude.includes(metadata.value)) {
          continue
        }
      }
    }

    const versionsData = await getVersionsForVersionUids(versionUids)

    for (const version of versionsData) {
      const { seedUid, seedLocalId, uid, localId } = version
      versionUidToLocalId.set(uid, localId)
      versionUidToSeedUid.set(uid, seedUid)
      seedUidToLocalId.set(seedUid, seedLocalId)
    }

    let propertyValue = metadata.value

    if (typeof propertyValue !== 'string') {
      propertyValue = JSON.stringify(propertyValue)
    }

    const propertyName = camelCase(propertyNameSnake)
    propertyValue = escapeSqliteString(propertyValue)
    const easDataType = metadata.type
    const versionUid = property.refUID
    const versionLocalId = versionUidToLocalId.get(versionUid)
    const attestationCreatedAt = property.timeCreated * 1000
    const attestationRaw = escapeSqliteString(JSON.stringify(property))
    const seedUid = versionUidToSeedUid.get(versionUid)
    const seedLocalId = seedUidToLocalId.get(seedUid!)
    const modelType = seedUidToModelType.get(seedUid!)

    const valuesString = `('${propertyLocalId}', '${property.id}', '${property.schemaId}', '${propertyName}', '${propertyValue}', '${easDataType}', '${versionUid}', '${versionLocalId}', '${seedUid}', '${seedLocalId}', '${modelType}',
                 ${Date.now()}, ${attestationCreatedAt}, '${attestationRaw}')`

    if (i < newProperties.length - 1) {
      insertPropertiesQuery += valuesString + ', '
    }

    if (i === newProperties.length - 1) {
      insertPropertiesQuery += valuesString + ';'
    }

    propertyUidToLocalId.set(property.id, propertyLocalId)
  }

  if (insertPropertiesQuery.endsWith('VALUES ')) {
    return { propertyUids }
  }

  if (insertPropertiesQuery.endsWith(', ')) {
    insertPropertiesQuery = insertPropertiesQuery.slice(0, -2) + ';'
  }

  await appDb.run(sql.raw(insertPropertiesQuery))

  return { propertyUids }
}

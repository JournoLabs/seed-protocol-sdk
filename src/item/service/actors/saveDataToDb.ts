import { EventObject, fromCallback } from 'xstate'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import { sql } from 'drizzle-orm'
import { escapeSqliteString } from '@/helpers/db'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'

const relatedSnakeCaseToCamelCase = (snakeCase: string): string => {
  let camelCasePropertyName = snakeCase

  camelCasePropertyName = camelCasePropertyName.replace(/_(id|ids)$/, '')

  return camelCasePropertyName
    .toLowerCase()
    .replace(/[-_][a-z]/g, (group) => group.slice(-1).toUpperCase())
}

export const saveDataToDb = fromCallback<EventObject, typeof itemMachineSingle>(
  ({ sendBack, input: { context } }) => {
    const {
      modelName,
      modelTableName,
      versionUid,
      versionLocalId,
      seedLocalId,
      propertiesBySchemaUid,
    } = context

    const _saveDataToDb = async (): Promise<void> => {
      const appDb = BaseDb.getAppDb()

      // Write fetched data from EAS to the database
      await appDb.run(
        sql.raw(
          `INSERT INTO ${modelTableName} (version_local_id, seed_local_id, version_uid, created_at)
           VALUES ('${versionLocalId}', '${seedLocalId}', '${versionUid}', ${new Date().getTime()});`,
        ),
      )

      const existingItemQuery = await appDb.run(
        sql.raw(
          `SELECT id, version_local_id, version_uid, seed_local_id, created_at
           FROM ${modelTableName}
           WHERE version_local_id = '${versionLocalId}';`,
        ),
      )

      let itemDbId

      if (
        existingItemQuery &&
        existingItemQuery.rows &&
        existingItemQuery.rows.length > 0
      ) {
        itemDbId = existingItemQuery.rows[0][0]
      }

      if (typeof itemDbId === 'undefined') {
        console.error(
          '[singleItemActors] [saveDataToDb] itemDbId not found in rows: ',
          existingItemQuery.rows,
        )
        return
      }

      for (const [schemaUid, properties] of Object.entries(
        propertiesBySchemaUid,
      )) {
        for (const property of properties) {
          const json = JSON.parse(property.decodedDataJson)
          const attestationValue = json[0].value
          let propertyValue = attestationValue.value

          if (typeof propertyValue === 'string') {
            propertyValue = escapeSqliteString(propertyValue)
          }

          const camelCasePropertyName = relatedSnakeCaseToCamelCase(
            attestationValue.name,
          )

          let attestationCreatedAt = property.timeCreated * 1000

          await appDb.run(
            sql.raw(
              `INSERT INTO metadata (uid,
                                     local_id,
                                     property_name,
                                     property_value,
                                     model_type,
                                     schema_uid,
                                     version_uid,
                                     eas_data_type,
                                     created_at,
                                     attestation_created_at)
               VALUES ('${property.id}', '${generateId()}', '${attestationValue.name}', '${propertyValue}',
                       '${modelTableName}', '${schemaUid}',
                       '${versionUid}',
                       '${attestationValue.type}',
                       ${new Date().getTime()}, ${attestationCreatedAt}, ${itemDbId})
               ON CONFLICT DO NOTHING;`,
            ),
          )

          // sendBack({
          //   type: 'updateValue',
          //   propertyName: camelCasePropertyName,
          //   propertyValue,
          //   source: 'eas',
          // })
        }
      }
      // const propertiesQuery = (await appDb.run(
      //   sql.raw(
      //     `SELECT property_name, property_value, schema_uid
      //      FROM metadata
      //      WHERE version_uid = '${versionUid}'
      //      ORDER BY created_at DESC;`,
      //   ),
      // )) as { rows: Array<[string, string]> }

      // propertiesQuery.rows?.forEach((row) => {
      //   const propertyName = relatedSnakeCaseToCamelCase(row[0] as string)
      //   let propertyValue = row[1] as string
      //   const schemaUid = row[2] as string
      //   if (isJSONString(propertyValue)) {
      //     propertyValue = JSON.parse(propertyValue)
      //   }
      //   sendBack({
      //     type: 'updateValue',
      //     propertyName,
      //     propertyValue,
      //     schemaUid,
      //     source: 'db',
      //   })
      // })

      return
    }

    _saveDataToDb().then(() => {
      sendBack({ type: 'saveDataToDbSuccess' })
    })
  },
)

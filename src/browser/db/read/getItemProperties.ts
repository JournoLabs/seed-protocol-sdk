import { PropertyData } from '@/types'
import { getAppDb } from '@/browser/db/sqlWasmClient'
import { metadata, seeds, versions } from '@/shared/seedSchema'
import {
  and,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
  or,
  SQL,
} from 'drizzle-orm'

type GetPropertiesForSeedProps = {
  seedLocalId?: string
  seedUid?: string
  edited?: boolean
}

type GetItemProperties = (
  props: GetPropertiesForSeedProps,
) => Promise<PropertyData[]>

export const getItemProperties: GetItemProperties = async ({
  seedLocalId,
  seedUid,
  edited,
}) => {
  const appDb = getAppDb()

  const whereClauses: SQL[] = [isNotNull(metadata.propertyName)]

  const uidWhereClause: SQL = seedUid
    ? eq(seeds.uid, seedUid)
    : isNull(seeds.uid)
  const localWhereClause: SQL = seedLocalId
    ? eq(seeds.localId, seedLocalId)
    : isNull(seeds.localId)

  whereClauses.push(or(localWhereClause, uidWhereClause) as SQL)
  whereClauses.push(isNotNull(metadata.propertyName))
  whereClauses.push(isNotNull(metadata.easDataType))

  if (typeof edited !== 'undefined') {
    if (edited) {
      whereClauses.push(isNull(metadata.uid))
    }
    if (!edited) {
      whereClauses.push(isNotNull(metadata.uid))
    }
  }

  // if (!seedLocalId || !seedUid) {
  //   const seedRows = await appDb
  //     .select({
  //       localId: seeds.localId,
  //       uid: seeds.uid,
  //     })
  //     .from(seeds)
  //     .where(or(localWhereClause, uidWhereClause))
  //
  //   if (seedRows && seedRows.length > 0) {
  //     seedUid = seedRows[0].uid as string
  //     seedLocalId = seedRows[0].localId as string
  //   }
  // }

  const metadataColumns = getTableColumns(metadata)

  const propertiesData = await appDb
    .select({
      ...metadataColumns,
    })
    .from(seeds)
    .leftJoin(metadata, eq(metadata.seedLocalId, seeds.localId))
    .leftJoin(versions, eq(versions.localId, seeds.localId))
    .where(and(...whereClauses))
    .groupBy(metadata.propertyName)

  return propertiesData
}

// const localIdWhere = seedLocalId
//   ? `s.local_id = '${seedLocalId}'`
//   : 's.local_id IS NULL'
// const uidWhere = seedUid ? `s.uid = '${seedUid}'` : 's.uid IS NULL'
//
// const queryStatement = `WITH LatestMetadata as (SELECT m.property_name,
//                                                        m.property_value,
//                                                        m.version_local_id,
//                                                        MAX(m.attestation_created_at),
//                                                        m.uid,
//                                                        m.seed_local_id,
//                                                        seed_uid
//                                                 FROM metadata m
//                                                          JOIN seeds s ON s.local_id = m.seed_local_id
//                                                 GROUP BY m.property_name),
//
//                              LatestVersion as (SELECT v.local_id,
//                                                       MAX(v.attestation_created_at) as attestation_created_at,
//                                                       v.uid,
//                                                       v.seed_local_id,
//                                                       v.seed_uid
//                                                FROM versions v
//                                                         JOIN seeds s ON s.local_id = v.seed_local_id
//                                                GROUP BY s.local_id)
//
//
//                         SELECT s.local_id,
//                                s.uid,
//                                s.schema_uid,
//                                m.property_name,
//                                m.property_value,
//                                COUNT(v.local_id) as versions_count,
//                                m.model_type,
//                                lv.attestation_created_at,
//                                m.local_id,
//                                m.uid,
//                                MAX(m.attestation_created_at),
//                                m.ref_seed_type,
//                                m.ref_value_type,
//                                m.seed_local_id,
//                                m.seed_uid,
//                                m.created_at,
//                                m.updated_at,
//                                m.version_uid
//                         FROM seeds s
//                                  JOIN LatestMetadata lm ON s.local_id = m.seed_local_id
//                                  JOIN LatestVersion lv ON lv.seed_local_id = m.seed_local_id
//                                  JOIN metadata m ON m.property_name = lm.property_name OR lm.property_value = s.uid
//                                  JOIN versions v ON s.local_id = v.seed_local_id
//                         WHERE ${localIdWhere}
//                            OR ${uidWhere}
//                         GROUP BY m.property_name;
// `
//
// const { rows } = await runQueryForStatement(queryStatement)
//
// const propertiesDataOld: PropertyData[] = []
//
// for (const row of rows) {
//   propertiesDataOld.push({
//     localId: row[0],
//     uid: row[1],
//     schemaUid: row[2],
//     propertyName: row[3],
//     propertyValue: row[4],
//     versionsCount: row[5],
//     itemModelName: row[6],
//     attestationCreatedAt: row[7],
//     metadataLocalId: row[8],
//     metadataUid: row[9],
//     metadataAttestationCreatedAt: row[10],
//     refSeedType: row[11],
//     refValueType: row[12],
//     seedLocalId: row[13],
//     seedUid: row[14],
//     createdAt: row[15],
//     updatedAt: row[16],
//     versionUid: row[17],
//   })
// }
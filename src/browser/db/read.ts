import { PropertyData } from '@/types'
import { startCase } from 'lodash-es'
import { metadata, MetadataType } from '@/shared/seedSchema'
import { and, eq, max, sql } from 'drizzle-orm'
import { getAppDb, runQueryForStatement } from '@/browser/db/sqlWasmClient'

export const getPropertyData = async (
  propertyName: string,
  seedLocalId?: string,
  seedUid?: string,
): Promise<PropertyData | undefined> => {
  const appDb = getAppDb()

  const queryBase = appDb.select().from(metadata)

  if (seedLocalId) {
    queryBase.where(
      and(
        eq(metadata.propertyName, propertyName),
        eq(metadata.seedLocalId, seedLocalId),
      ),
    )
  }

  if (seedUid) {
    queryBase.where(
      and(
        eq(metadata.propertyName, propertyName),
        eq(metadata.seedUid, seedUid),
      ),
    )
  }

  const rows = (await queryBase.orderBy(
    sql.raw(`COALESCE(attestation_created_at, created_at) DESC`),
  )) as MetadataType[]

  if (!rows || rows.length === 0) {
    return
  }

  const row = rows[0]

  return {
    ...row,
    itemModelName: startCase(row.modelType),
  }
}

const seedUidToStorageTransactionId = new Map<string, string>()

type GetStorageTransactionIdResults = {
  storageTransactionId: string
}[]

export const getStorageTransactionIdForSeedUid = async (
  seedUid: string,
): Promise<string | undefined> => {
  if (seedUidToStorageTransactionId.has(seedUid)) {
    return seedUidToStorageTransactionId.get(seedUid)
  }

  const appDb = getAppDb()

  const results = (await appDb
    .select({
      storageTransactionId: metadata.propertyValue,
    })
    .from(metadata)
    .where(
      and(
        eq(metadata.seedUid, seedUid),
        eq(metadata.propertyName, 'storageTransactionId'),
      ),
    )) as GetStorageTransactionIdResults

  if (!results || results.length === 0) {
    return
  }

  seedUidToStorageTransactionId.set(seedUid, results[0].storageTransactionId)
  return results[0].storageTransactionId
}

export const getRelationValueData = async (
  propertyValue: any,
): Promise<MetadataType | undefined> => {
  const appDb = getAppDb()

  const rows = (await appDb
    .select({
      propertyValue: metadata.propertyValue,
      attestationCreatedAt: max(metadata.attestationCreatedAt),
      refResolvedDisplayValue: metadata.refResolvedDisplayValue,
      refResolvedValue: metadata.refResolvedValue,
      refSeedType: metadata.refSeedType,
      easDataType: metadata.easDataType,
    })
    .from(metadata)
    .where(eq(metadata.propertyValue, propertyValue))) as MetadataType[]

  if (!rows || rows.length === 0) {
    return
  }

  return rows[0]
}

type GetExistingItemProps = {
  seedLocalId: string
  seedUid: string
}

type GetExistingItemReturn = {
  seedLocalId: string
  seedUid: string
  createdAt: string
}

type GetExistingItem = (
  props: GetExistingItemProps,
) => Promise<GetExistingItemReturn | undefined>

export const getExistingItem: GetExistingItem = async ({
  seedLocalId,
  seedUid,
}) => {
  const existingItemStatement = `SELECT local_id, uid, created_at
                                 FROM seeds
                                 WHERE (uid IS NOT NULL
                                     AND uid != ''
                                     AND uid != 'undefined'
                                     AND uid != 'null'
                                     AND uid != 'false'
                                     AND uid != '0'
                                     AND uid != 0
                                     AND uid = '${seedUid}'
                                     )
                                    OR (
                                     local_id IS NOT NULL
                                         AND local_id != ''
                                         AND local_id != 'undefined'
                                         AND local_id != 'null'
                                         AND local_id != 'false'
                                         AND local_id != '0'
                                         AND local_id != 0
                                         AND local_id = '${seedLocalId}'
                                     );
  `

  const { rows } = await runQueryForStatement(existingItemStatement)

  let existingItem

  if (rows && rows.length > 0) {
    // We know the zero index is versionLocalId because we specifically asked for it first
    // in the SELECT statement above. Same with the rest of the indexes.
    let matchingRow = rows.find((row) => row[1] === seedUid)

    if (!matchingRow) {
      matchingRow = rows.find((row) => row[0] === seedLocalId)
    }

    if (matchingRow) {
      existingItem = {
        seedLocalId: matchingRow[0],
        seedUid: matchingRow[1],
        createdAt: matchingRow[2],
      }
    }
  }

  return existingItem
}

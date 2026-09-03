import {
  getSeedsBySchemaName,
  EasClient,
  withExcludeRevokedFilter,
  GET_SEEDS,
} from '@seedprotocol/eas'
import { initializeQueryPlatform } from './bootstrap.js'
import { assembleSeeds } from './assembleSeeds.js'
import type {
  AssembleOptions,
  AttestationLike,
  QueryBySchemaOptions,
  QueryBySchemaResult,
  SeedRecord,
} from './types.js'

export async function queryBySchema(
  schemaName: string,
  options?: QueryBySchemaOptions,
): Promise<QueryBySchemaResult> {
  await initializeQueryPlatform()
  const limit = options?.limit ?? 100
  const skip = options?.skip ?? 0
  const seeds = (await getSeedsBySchemaName(schemaName, limit, skip)) as AttestationLike[]
  const items = await assembleSeeds(schemaName, seeds, options)
  return { items, limit, skip }
}

export async function getSeed(
  seedUid: string,
  options?: AssembleOptions,
): Promise<SeedRecord | null> {
  await initializeQueryPlatform()
  if (!seedUid || typeof seedUid !== 'string' || seedUid.trim() === '') {
    return null
  }

  const easClient = EasClient.getEasClient()
  const { itemSeeds } = await easClient.request(GET_SEEDS, {
    where: withExcludeRevokedFilter({
      id: { equals: seedUid.trim() },
    }),
    take: 1,
    skip: 0,
  })

  const seed = (itemSeeds ?? [])[0] as AttestationLike | undefined
  if (!seed) return null

  const schemaName = seed.schema?.schemaNames?.[0]?.name
  if (!schemaName) return null

  const records = await assembleSeeds(schemaName, [seed], options)
  return records[0] ?? null
}

/**
 * Query seeds of a schema created within a calendar month (local timezone bounds).
 */
export async function queryBySchemaForMonth(
  schemaName: string,
  year: number,
  month: number,
  options?: AssembleOptions,
): Promise<SeedRecord[]> {
  await initializeQueryPlatform()
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59)
  const startTs = Math.floor(startDate.getTime() / 1000)
  const endTs = Math.floor(endDate.getTime() / 1000) + 1

  const where = withExcludeRevokedFilter({
    AND: [
      {
        schema: {
          is: {
            schemaNames: {
              some: {
                name: { equals: schemaName },
              },
            },
          },
        },
      },
      {
        timeCreated: { gte: startTs, lt: endTs },
      },
    ],
  })

  const easClient = EasClient.getEasClient()
  const { itemSeeds } = await easClient.request(GET_SEEDS, {
    where,
    take: 1000,
    skip: 0,
  })

  const seeds = (itemSeeds ?? []) as AttestationLike[]
  return assembleSeeds(schemaName, seeds, options)
}

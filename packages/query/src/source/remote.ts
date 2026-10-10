import {
  getSeedsBySchemaName,
  getSeedsByUidsFromEas,
  getAttestationChangesSince,
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  EasClient,
  withExcludeRevokedFilter,
  GET_SEEDS_LEAN,
} from '@seedprotocol/eas'
import type { AttestationLike } from '../types.js'
import type { QueryDataSource } from './types.js'

function monthBoundsUnix(year: number, month: number): { startTs: number; endTs: number } {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59)
  const startTs = Math.floor(startDate.getTime() / 1000)
  const endTs = Math.floor(endDate.getTime() / 1000) + 1
  return { startTs, endTs }
}

/**
 * Default remote data source: EAS GraphQL (+ callers hydrate via Arweave).
 */
export function createRemoteQueryDataSource(): QueryDataSource {
  return {
    kind: 'remote',

    async getSeedByUid(seedUid: string): Promise<AttestationLike | null> {
      const [seed] = await getSeedsByUidsFromEas({ uids: [seedUid] })
      return (seed as AttestationLike | undefined) ?? null
    },

    async listSeedsBySchemaName(
      schemaName: string,
      opts: { limit: number; skip: number },
    ): Promise<AttestationLike[]> {
      return (await getSeedsBySchemaName(
        schemaName,
        opts.limit,
        opts.skip,
      )) as AttestationLike[]
    },

    async listSeedsByUidPrefix(
      schemaName: string,
      uidPrefix: string,
      opts: { limit: number; skip: number },
    ): Promise<AttestationLike[]> {
      return (await getSeedsBySchemaName(schemaName, opts.limit, opts.skip, {
        uidPrefix,
      })) as AttestationLike[]
    },

    async listSeedsBySchemaNameForMonth(
      schemaName: string,
      year: number,
      month: number,
    ): Promise<AttestationLike[]> {
      const { startTs, endTs } = monthBoundsUnix(year, month)
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
      const { itemSeeds } = await easClient.request(GET_SEEDS_LEAN, {
        where,
        take: 1000,
        skip: 0,
      })
      // Every seed matched `schemaName`; the lean query doesn't select it.
      return (itemSeeds ?? []).map((seed) => ({
        ...seed,
        schema: { schemaNames: [{ name: schemaName }] },
      })) as AttestationLike[]
    },

    async getVersionsForSeed(seedUid: string): Promise<AttestationLike[]> {
      return (await getItemVersionsFromEas({
        seedUids: [seedUid],
      })) as AttestationLike[]
    },

    async getVersionsForSeeds(
      seedUids: string[],
      opts?: { includeRevoked?: boolean },
    ): Promise<AttestationLike[]> {
      if (seedUids.length === 0) return []
      // The query fields include `revoked`, so revoked versions come back marked.
      return (await getItemVersionsFromEas({
        seedUids,
        excludeRevoked: !opts?.includeRevoked,
      })) as AttestationLike[]
    },

    async getPropertiesForVersionUids(
      versionUids: string[],
    ): Promise<AttestationLike[]> {
      if (versionUids.length === 0) return []
      return (await getItemPropertiesFromEas({
        versionUids,
      })) as AttestationLike[]
    },

    async getSeedsByUids(uids: string[]): Promise<AttestationLike[]> {
      if (uids.length === 0) return []
      return (await getSeedsByUidsFromEas({ uids })) as AttestationLike[]
    },

    async listChangesSince(opts) {
      return getAttestationChangesSince(opts)
    },
  }
}

let remoteSingleton: QueryDataSource | null = null

export function getRemoteQueryDataSource(): QueryDataSource {
  if (!remoteSingleton) {
    remoteSingleton = createRemoteQueryDataSource()
  }
  return remoteSingleton
}

/** Tests only. */
export function resetRemoteQueryDataSource(): void {
  remoteSingleton = null
}

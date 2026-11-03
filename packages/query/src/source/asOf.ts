import {
  getItemPropertiesFromEas,
  getItemVersionsFromEas,
  getSeedsByUidsFromEas,
  type Attestation,
} from '@seedprotocol/eas'
import { revokedBy } from '../seedAtTime.js'
import type { AttestationLike } from '../types.js'
import type { QueryDataSource } from './types.js'

/**
 * EAS as it stood at `asOf` (unix seconds): attestations made later are left out, and `revoked`
 * means revoked by `asOf`, as in readSeedAtTime. Only the reads getSeedAttestations makes.
 */
export function createAsOfQueryDataSource(asOf: number): QueryDataSource {
  const atTime = (attestations: Attestation[]): AttestationLike[] =>
    attestations
      .filter((a) => a.timeCreated <= asOf)
      .map((a) => ({ ...a, revoked: revokedBy(a, asOf) }) as AttestationLike)
  const unsupported = async (): Promise<never> => {
    throw new Error('A time-pinned read supports seeds by uid only')
  }

  return {
    kind: 'remote',
    getSeedByUid: async (uid) => atTime(await getSeedsByUidsFromEas({ uids: [uid], excludeRevoked: false }))[0] ?? null,
    getSeedsByUids: async (uids) =>
      uids.length === 0 ? [] : atTime(await getSeedsByUidsFromEas({ uids, excludeRevoked: false })),
    getVersionsForSeed: async (uid) =>
      atTime(await getItemVersionsFromEas({ seedUids: [uid], excludeRevoked: false })).filter((v) => !v.revoked),
    async getVersionsForSeeds(seedUids, opts) {
      if (seedUids.length === 0) return []
      const versions = atTime(await getItemVersionsFromEas({ seedUids, excludeRevoked: false }))
      return opts?.includeRevoked ? versions : versions.filter((v) => !v.revoked)
    },
    // Revoked by `asOf` are left out: assembly picks the newest live one per property, so a
    // retraction gives no value, as in readSeedAtTime.
    getPropertiesForVersionUids: async (versionUids) =>
      versionUids.length === 0
        ? []
        : atTime(await getItemPropertiesFromEas({ versionUids, excludeRevoked: false })).filter((p) => !p.revoked),
    listSeedsBySchemaName: unsupported,
    listSeedsBySchemaNameForMonth: unsupported,
  }
}

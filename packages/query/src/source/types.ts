import type { AttestationLike } from '../types.js'

/**
 * Pluggable backend for Seed / Version / property attestation reads.
 * Remote uses EAS GraphQL; local (SDK) maps SQLite rows into the same shape.
 */
export type QueryDataSource = {
  readonly kind: 'remote' | 'local'

  getSeedByUid(seedUid: string): Promise<AttestationLike | null>

  listSeedsBySchemaName(
    schemaName: string,
    opts: { limit: number; skip: number },
  ): Promise<AttestationLike[]>

  listSeedsBySchemaNameForMonth(
    schemaName: string,
    year: number,
    month: number,
  ): Promise<AttestationLike[]>

  getVersionsForSeed(seedUid: string): Promise<AttestationLike[]>

  getVersionsForSeeds(seedUids: string[]): Promise<AttestationLike[]>

  getPropertiesForVersionUids(versionUids: string[]): Promise<AttestationLike[]>

  getSeedsByUids(uids: string[]): Promise<AttestationLike[]>

  /**
   * Optional: read html/image bodies from local files instead of Arweave gateway.
   * Return null to fall back to remote hydrate.
   */
  readStorageBody?(ref: {
    propertyName: string
    value: unknown
    localPathHint?: string
  }): Promise<string | null>
}

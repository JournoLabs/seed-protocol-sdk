import {
  keepAttestationsFromRefAttester,
  pickLatestPropertyAttestationsByRefAndSchema,
} from '@seedprotocol/eas'
import {
  applyChangelogFilters,
  buildFlatSnapshotFromProperties,
  diffPropertyAttestations,
  diffVersionSnapshots,
  type VersionSnapshot,
} from './changelog.js'
import { getRemoteQueryDataSource } from './source/remote.js'
import type { QueryDataSource } from './source/types.js'
import type {
  AttestationLike,
  ChangelogEntry,
  ChangelogOptions,
  GetSeedOptions,
} from './types.js'

export type AssembleSeedChangelogResult = {
  /** The newest live Version, or `''` when the seed has none. */
  latestVersionUid: string
  /** Every live Version the changelog was built from, oldest first, before `since` and `limit`. */
  versionUids: string[]
  changelog: ChangelogEntry[]
}

/**
 * Build a changelog for one seed from all Versions + property attestations.
 * Snapshots are flat (no relation expand / hydrate).
 */
export async function assembleSeedChangelog(
  seedUid: string,
  options?: Pick<GetSeedOptions, 'changelog'>,
  dataSource: QueryDataSource = getRemoteQueryDataSource(),
): Promise<AssembleSeedChangelogResult> {
  const [seed, versions] = await Promise.all([
    dataSource.getSeedByUid(seedUid),
    dataSource.getVersionsForSeed(seedUid),
  ])
  const seedLike = seed ?? { id: seedUid, refUID: '', schemaId: '', timeCreated: 0, decodedDataJson: '' }
  const changelogs = await assembleSeedChangelogs([seedLike], versions, options, dataSource)
  return changelogs.get(seedLike.id.toLowerCase())!
}

/**
 * Changelogs for many seeds from their Versions (as read, revoked ones included or not) and one
 * request for the properties of every live Version. Keyed by lowercase seed UID, one entry per
 * seed in `seeds`.
 */
export async function assembleSeedChangelogs(
  seeds: readonly AttestationLike[],
  versions: readonly AttestationLike[],
  options: Pick<GetSeedOptions, 'changelog'> | undefined,
  dataSource: QueryDataSource,
): Promise<Map<string, AssembleSeedChangelogResult>> {
  const changelogOpts: ChangelogOptions = options?.changelog ?? {}
  const granularity = changelogOpts.granularity ?? 'version'

  // Anyone can attest with any refUID: only the seed's attester's versions, and each version's
  // attester's properties, count.
  const seedUids = new Set(seeds.map((seed) => seed.id.toLowerCase()))
  const liveVersions = keepAttestationsFromRefAttester(
    versions.filter((v) => !v.revoked && seedUids.has(v.refUID.toLowerCase())),
    seeds,
  )
  const versionsBySeed = new Map<string, AttestationLike[]>()
  for (const version of [...liveVersions].sort((a, b) => a.timeCreated - b.timeCreated)) {
    const key = version.refUID.toLowerCase()
    versionsBySeed.set(key, [...(versionsBySeed.get(key) ?? []), version])
  }

  const properties =
    liveVersions.length === 0
      ? []
      : keepAttestationsFromRefAttester(
          await dataSource.getPropertiesForVersionUids(liveVersions.map((v) => v.id)),
          liveVersions,
        )
  const propertiesByVersion = new Map<string, AttestationLike[]>()
  for (const prop of properties) {
    propertiesByVersion.set(prop.refUID, [...(propertiesByVersion.get(prop.refUID) ?? []), prop])
  }

  const result = new Map<string, AssembleSeedChangelogResult>()
  for (const seed of seeds) {
    const key = seed.id.toLowerCase()
    const sortedVersions = versionsBySeed.get(key) ?? []
    if (sortedVersions.length === 0) {
      result.set(key, { latestVersionUid: '', versionUids: [], changelog: [] })
      continue
    }
    const modelName = seed.schema?.schemaNames?.[0]?.name
    const rawProperties = sortedVersions.flatMap((v) => propertiesByVersion.get(v.id) ?? [])

    let changelog: ChangelogEntry[]
    if (granularity === 'property') {
      changelog = diffPropertyAttestations(rawProperties, modelName)
    } else {
      const snapshots: VersionSnapshot[] = sortedVersions.map((version) => ({
        versionUid: version.id,
        at: version.timeCreated,
        data: buildFlatSnapshotFromProperties(
          pickLatestPropertyAttestationsByRefAndSchema(propertiesByVersion.get(version.id) ?? []) as AttestationLike[],
          modelName,
        ),
      }))
      changelog = diffVersionSnapshots(snapshots)
    }

    result.set(key, {
      latestVersionUid: sortedVersions[sortedVersions.length - 1]!.id,
      versionUids: sortedVersions.map((v) => v.id),
      changelog: applyChangelogFilters(changelog, changelogOpts),
    })
  }
  return result
}

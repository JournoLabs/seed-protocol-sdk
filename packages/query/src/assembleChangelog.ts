import { pickLatestPropertyAttestationsByRefAndSchema } from '@seedprotocol/eas'
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
  latestVersionUid: string
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
  const changelogOpts: ChangelogOptions = options?.changelog ?? {}
  const granularity = changelogOpts.granularity ?? 'version'

  const itemVersions = await dataSource.getVersionsForSeed(seedUid)

  const sortedVersions = [...itemVersions].sort(
    (a, b) => a.timeCreated - b.timeCreated,
  )

  if (sortedVersions.length === 0) {
    return { latestVersionUid: '', changelog: [] }
  }

  const latestVersionUid = sortedVersions[sortedVersions.length - 1]!.id
  const versionUids = sortedVersions.map((v) => v.id)

  const rawProperties =
    await dataSource.getPropertiesForVersionUids(versionUids)

  let changelog: ChangelogEntry[]

  if (granularity === 'property') {
    changelog = diffPropertyAttestations(rawProperties)
  } else {
    const byVersion = new Map<string, AttestationLike[]>()
    for (const prop of rawProperties) {
      const list = byVersion.get(prop.refUID) ?? []
      list.push(prop)
      byVersion.set(prop.refUID, list)
    }

    const snapshots: VersionSnapshot[] = []
    for (const version of sortedVersions) {
      const propsForVersion = byVersion.get(version.id) ?? []
      const canonical = pickLatestPropertyAttestationsByRefAndSchema(
        propsForVersion,
      ) as AttestationLike[]
      snapshots.push({
        versionUid: version.id,
        at: version.timeCreated,
        data: buildFlatSnapshotFromProperties(canonical),
      })
    }
    changelog = diffVersionSnapshots(snapshots)
  }

  return {
    latestVersionUid,
    changelog: applyChangelogFilters(changelog, changelogOpts),
  }
}

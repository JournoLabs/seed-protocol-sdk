import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds } from '@/seedSchema'
import { eq, or } from 'drizzle-orm'
import type { IItem } from '@/interfaces'
import { isValidEasAttestationUid } from '@/helpers/easUid'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'

export type SeedPublishState = {
  /** `onchain` when any local row carries a valid EAS attestation UID for this seed. */
  status: 'draft' | 'onchain'
  seedAttestationUid: string | null
  versionAttestationUid: string | null
  /** Prefer seed UID for EAS Scan; else version or a metadata property attestation UID. */
  explorerUid: string | null
  /** Best-effort max attestation time (ms) from seed, version, or metadata rows. */
  lastAttestedAtMs: number | null
}

function resolveSeedIds(
  arg: { seedLocalId?: string; seedUid?: string } | IItem<any>,
): { seedLocalId?: string; seedUid?: string } {
  if (arg && typeof arg === 'object' && 'seedLocalId' in arg) {
    const item = arg as IItem<any>
    return {
      seedLocalId: item.seedLocalId,
      seedUid: item.seedUid,
    }
  }
  return arg as { seedLocalId?: string; seedUid?: string }
}

function maxMs(a: number | null | undefined, b: number | null | undefined): number | null {
  const x = a ?? null
  const y = b ?? null
  if (x == null) return y
  if (y == null) return x
  return Math.max(x, y)
}

/**
 * Whether the seed has **any** on-chain anchor in local SQLite: valid EAS UID on the seed row,
 * on the newest **published** version row (`getLatestPublishedVersionRow`), or on **any** metadata row.
 * Not the same as “no unpublished edits”; see `getPublishPendingDiff` for per-property head rows.
 */
export async function getSeedPublishState(
  arg: { seedLocalId?: string; seedUid?: string } | IItem<any>,
): Promise<SeedPublishState> {
  const { seedLocalId, seedUid } = resolveSeedIds(arg)
  const appDb = BaseDb.getAppDb()
  const empty: SeedPublishState = {
    status: 'draft',
    seedAttestationUid: null,
    versionAttestationUid: null,
    explorerUid: null,
    lastAttestedAtMs: null,
  }
  if (!appDb || (!seedLocalId && !seedUid)) {
    return empty
  }

  const seedWhere =
    seedLocalId && seedUid
      ? or(eq(seeds.localId, seedLocalId), eq(seeds.uid, seedUid))
      : seedLocalId
        ? eq(seeds.localId, seedLocalId)
        : eq(seeds.uid, seedUid!)

  const seedRows = await appDb.select().from(seeds).where(seedWhere).limit(1)
  const seedRow = seedRows[0]

  const seedAttestationUid =
    seedRow?.uid && isValidEasAttestationUid(seedRow.uid) ? seedRow.uid : null
  let lastAttestedAtMs: number | null = seedRow?.attestationCreatedAt ?? null

  const resolvedSeedLocalId = seedRow?.localId ?? seedLocalId

  let versionAttestationUid: string | null = null
  if (resolvedSeedLocalId) {
    const v = await getLatestPublishedVersionRow(resolvedSeedLocalId)
    if (v?.uid) {
      versionAttestationUid = v.uid
      lastAttestedAtMs = maxMs(lastAttestedAtMs, v.attestationCreatedAt ?? undefined)
    }
  }

  const metaWhere =
    seedLocalId && seedUid
      ? or(eq(metadata.seedLocalId, seedLocalId), eq(metadata.seedUid, seedUid))
      : seedLocalId
        ? eq(metadata.seedLocalId, seedLocalId)
        : eq(metadata.seedUid, seedUid!)

  const metaRows = await appDb.select().from(metadata).where(metaWhere)
  let metadataExplorerUid: string | null = null
  for (const row of metaRows) {
    if (!isValidEasAttestationUid(row.uid)) continue
    if (!metadataExplorerUid) metadataExplorerUid = row.uid!
    const t = row.attestationCreatedAt ?? row.createdAt
    lastAttestedAtMs = maxMs(lastAttestedAtMs, t ?? undefined)
  }

  const hasOnchain = !!(seedAttestationUid || versionAttestationUid || metadataExplorerUid)
  const explorerUid =
    seedAttestationUid ?? versionAttestationUid ?? metadataExplorerUid

  return {
    status: hasOnchain ? 'onchain' : 'draft',
    seedAttestationUid,
    versionAttestationUid,
    explorerUid,
    lastAttestedAtMs,
  }
}

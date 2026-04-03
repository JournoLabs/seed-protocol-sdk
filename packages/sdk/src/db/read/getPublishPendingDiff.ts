import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, versions } from '@/seedSchema'
import type { MetadataType } from '@/seedSchema/MetadataSchema'
import { desc, eq, or } from 'drizzle-orm'
import type { IItem } from '@/interfaces'

export type PublishPendingPropertyDiff = {
  propertyName: string
  currentValue: string | null
  /** Value from the most recent row that had an on-chain attestation uid, if any */
  previousPublishedValue: string | null
  /** True when the latest row for this property has no `uid` (not yet attested) */
  pending: boolean
}

export type GetPublishPendingDiffResult = {
  /** Properties whose latest metadata row is unpublished (no `uid`) */
  pendingProperties: PublishPendingPropertyDiff[]
  lastPublishedVersionUid: string | null
  lastVersionPublishedAt: number | null
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

/**
 * Lists properties with unpublished local edits (latest metadata row has no `uid`).
 * Compares to the previous row with a `uid` for the same `property_name` when present.
 * Use for pre-publish summaries and “what changed” UI.
 */
export async function getPublishPendingDiff(
  arg: { seedLocalId?: string; seedUid?: string } | IItem<any>,
): Promise<GetPublishPendingDiffResult> {
  const { seedLocalId, seedUid } = resolveSeedIds(arg)
  const appDb = BaseDb.getAppDb()
  const empty: GetPublishPendingDiffResult = {
    pendingProperties: [],
    lastPublishedVersionUid: null,
    lastVersionPublishedAt: null,
  }
  if (!appDb || (!seedLocalId && !seedUid)) {
    return empty
  }

  const whereClause =
    seedLocalId && seedUid
      ? or(eq(metadata.seedLocalId, seedLocalId), eq(metadata.seedUid, seedUid))
      : seedLocalId
        ? eq(metadata.seedLocalId, seedLocalId)
        : eq(metadata.seedUid, seedUid!)

  const rows = (await appDb.select().from(metadata).where(whereClause)) as MetadataType[]

  const byProp = new Map<string, MetadataType[]>()
  for (const row of rows) {
    const name = row.propertyName ?? ''
    if (!name) continue
    const list = byProp.get(name) ?? []
    list.push(row)
    byProp.set(name, list)
  }

  for (const list of byProp.values()) {
    list.sort(
      (a, b) =>
        (b.attestationCreatedAt ?? b.createdAt ?? 0) - (a.attestationCreatedAt ?? a.createdAt ?? 0),
    )
  }

  const pendingProperties: PublishPendingPropertyDiff[] = []
  for (const [propertyName, list] of byProp) {
    const latest = list[0]
    if (!latest) continue
    const hasUid = !!latest.uid && String(latest.uid).trim() !== ''
    if (!hasUid) {
      const prevWithUid = list.find((r) => r.uid && String(r.uid).trim() !== '')
      pendingProperties.push({
        propertyName,
        currentValue: latest.propertyValue ?? null,
        previousPublishedValue: prevWithUid?.propertyValue ?? null,
        pending: true,
      })
    }
  }

  pendingProperties.sort((a, b) => a.propertyName.localeCompare(b.propertyName))

  let lastPublishedVersionUid: string | null = null
  let lastVersionPublishedAt: number | null = null

  if (seedLocalId) {
    const vRows = await appDb
      .select({
        uid: versions.uid,
        attestationCreatedAt: versions.attestationCreatedAt,
      })
      .from(versions)
      .where(eq(versions.seedLocalId, seedLocalId))
      .orderBy(desc(versions.createdAt))
      .limit(1)
    const vr = vRows[0]
    if (vr?.uid && String(vr.uid).trim() !== '') {
      lastPublishedVersionUid = vr.uid
    }
    if (vr?.attestationCreatedAt != null) {
      lastVersionPublishedAt = vr.attestationCreatedAt
    }
  }

  return {
    pendingProperties,
    lastPublishedVersionUid,
    lastVersionPublishedAt,
  }
}

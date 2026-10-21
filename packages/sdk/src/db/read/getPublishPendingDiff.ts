import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import type { MetadataType } from '@/seedSchema/MetadataSchema'
import { eq, or } from 'drizzle-orm'
import type { IItem } from '@/interfaces'
import { isPublishedMetadataRow as isPublished } from '@/helpers/isPublishedMetadataRow'
import { compareMetadataRowsLatestFirst, metadataPropertyGroupKeys } from '@/helpers/compareMetadataRowsLatestFirst'
import { readMetadataPropertiesById } from '@/db/read/metadataProperty'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'

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
 * Per property: the **latest** metadata row (by `attestationCreatedAt` / `createdAt`) lacks a valid
 * EAS attestation `uid` — local edit or missing post-publish UID backfill. Rows sync derived for
 * ItemStorage properties (`derivedFromUid` set) count as published. **Not** equivalent to
 * draft vs onchain for the whole seed; use `getSeedPublishState` for that.
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

  // One group per property: by property_id (decision D4), rows without one by stored name. A
  // property is reported under its storage name, the name its new rows are written under.
  const groupKey = metadataPropertyGroupKeys(rows)
  const byProp = new Map<string, MetadataType[]>()
  for (const row of rows) {
    if (!row.propertyName) continue
    const key = groupKey(row)
    const list = byProp.get(key) ?? []
    list.push(row)
    byProp.set(key, list)
  }

  for (const list of byProp.values()) {
    list.sort(compareMetadataRowsLatestFirst)
  }

  const propertiesById = await readMetadataPropertiesById(
    appDb,
    rows.map((row) => row.propertyId),
  )
  const pendingProperties: PublishPendingPropertyDiff[] = []
  for (const list of byProp.values()) {
    const latest = list[0]
    if (!latest) continue
    if (!isPublished(latest)) {
      const prevWithUid = list.find(isPublished)
      const groupId = list.find((row) => row.propertyId != null)?.propertyId
      const property = groupId != null ? propertiesById.get(groupId) : undefined
      pendingProperties.push({
        propertyName: property?.storageName ?? latest.propertyName!,
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
    const published = await getLatestPublishedVersionRow(seedLocalId)
    if (published) {
      lastPublishedVersionUid = published.uid
      if (published.attestationCreatedAt != null) {
        lastVersionPublishedAt = published.attestationCreatedAt
      }
    }
  }

  return {
    pendingProperties,
    lastPublishedVersionUid,
    lastVersionPublishedAt,
  }
}

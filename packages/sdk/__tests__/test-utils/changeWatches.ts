import { activeChangeWatches, type EntityChangeTable } from '@/browser/db/changeFeed'

/**
 * Change-feed watches (ADR 0020) currently registered for a seed's rows in `table`, and for
 * metadata, optionally for one property name. Loaded Items and ItemProperties register these in
 * the browser instead of holding liveQueries.
 */
export function countChangeWatches({
  seedLocalId,
  table,
  propertyName,
}: {
  seedLocalId: string
  table: EntityChangeTable
  propertyName?: string
}): number {
  return activeChangeWatches().filter(
    (w) =>
      w.seedLocalId === seedLocalId &&
      w.tables.includes(table) &&
      (propertyName === undefined || !!w.propertyNames?.includes(propertyName)),
  ).length
}

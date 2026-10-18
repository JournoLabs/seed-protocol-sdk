import { and, inArray, isNotNull } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { getItemStorageSubdir } from '@/helpers/storageDir'

/** Rows per query: well under SQLite's bound-parameter limit. */
const CHUNK_SIZE = 400

/**
 * Where the download worker saves each child of a composite upload, by transaction id then child
 * (property) name: a path relative to the files root.
 *
 * The paths come from the ItemStorage rows sync derives from a `storage_transaction_id`
 * attestation (see `createMetadataRecordsForStorageTransactionId`): property value = the
 * transaction id, `refResolvedValue` = `<txId><extension>`, `localStorageDir` = the model's storage
 * directory. Those rows are what hydration reads, so a child saved here is found as that property's
 * file. Transactions with no such rows are left out; the worker then falls back to the legacy
 * html / json layout.
 */
export const getCompositeChildPaths = async (
  transactionIds: string[],
): Promise<Record<string, Record<string, string>>> => {
  const out: Record<string, Record<string, string>> = {}
  const appDb = BaseDb.getAppDb()
  if (!appDb || transactionIds.length === 0) return out

  for (let i = 0; i < transactionIds.length; i += CHUNK_SIZE) {
    const chunk = transactionIds.slice(i, i + CHUNK_SIZE)
    const rows = await appDb
      .select({
        transactionId: metadata.propertyValue,
        propertyName: metadata.propertyName,
        refResolvedValue: metadata.refResolvedValue,
        localStorageDir: metadata.localStorageDir,
      })
      .from(metadata)
      .where(
        and(
          isNotNull(metadata.derivedFromUid),
          isNotNull(metadata.refResolvedValue),
          inArray(metadata.propertyValue, chunk),
        ),
      )

    for (const row of rows) {
      const { transactionId, propertyName, refResolvedValue } = row
      if (!transactionId || !propertyName || !refResolvedValue) continue
      // A file name, never a path: anything else is not where the SDK would look.
      if (refResolvedValue.includes('/') || refResolvedValue.includes('\\')) continue
      const byName = (out[transactionId] ??= {})
      byName[propertyName] ??= `${getItemStorageSubdir(row.localStorageDir)}/${refResolvedValue}`
    }
  }

  return out
}

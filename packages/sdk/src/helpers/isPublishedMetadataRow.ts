import { isValidEasAttestationUid } from '@/helpers/easUid'

/**
 * A metadata row holds published content when it has a valid EAS attestation uid, or when sync
 * derived it from one (ItemStorage rows from a storage_transaction_id attestation: no uid of their
 * own, `derivedFromUid` set). Anything else is a local edit (or a row awaiting its uid backfill).
 */
export const isPublishedMetadataRow = (row: {
  uid?: string | null
  derivedFromUid?: string | null
}): boolean => isValidEasAttestationUid(row.uid) || row.derivedFromUid != null

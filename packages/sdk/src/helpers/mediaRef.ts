import {
  BaseArweaveClient,
  classifyMediaRef,
  type ResolveMediaRefOptions,
  type ResolveMediaRefResult,
} from '@seedprotocol/arweave'
import { BaseDb } from '@/db/Db/BaseDb'
import { getStorageTransactionIdForSeedUid } from '@/db/read/getStorageTransactionIdForSeedUid'
import { convertTxIdToImage } from './localImageBlobUrl'

/** Classification and feed-field helpers live in `@seedprotocol/arweave`; resolving needs the local DB and files. */

async function resolveTxId(txId: string): Promise<ResolveMediaRefResult> {
  const local = await convertTxIdToImage(txId)
  if (local) {
    return { status: 'ready', href: local, source: 'localBlob' }
  }
  return {
    status: 'ready',
    href: BaseArweaveClient.getRawUrl(txId),
    source: 'gateway',
  }
}

/**
 * Resolve a classified media reference to a display URL (https/blob/data), using local files when present.
 * A `localBlob` result's href is a new blob: URL per call: the caller revokes it
 * (`URL.revokeObjectURL`) when it stops displaying it, as `useResolvedMediaRef` does.
 */
export async function resolveMediaRef(
  raw: string,
  options?: ResolveMediaRefOptions,
): Promise<ResolveMediaRefResult> {
  const classification = classifyMediaRef(raw, options)

  switch (classification.kind) {
    case 'empty':
      return { status: 'empty' }
    case 'url':
      return {
        status: 'ready',
        href: classification.href,
        source: 'direct',
      }
    case 'nonMediaUrl':
      return {
        status: 'unresolved',
        reason: 'non_media_url',
        classification,
      }
    case 'seedLocalId':
      return {
        status: 'unresolved',
        reason: 'seed_local_id_not_portable',
        classification,
      }
    case 'unknown':
      return {
        status: 'unresolved',
        reason: 'unknown_ref',
        classification,
      }
    case 'arweaveTxId':
      return resolveTxId(classification.txId)
    case 'seedUid': {
      const appDb = BaseDb.getAppDb()
      if (!appDb) {
        return {
          status: 'unresolved',
          reason: 'seed_uid_requires_app_db',
          classification,
        }
      }
      const storageTransactionId = await getStorageTransactionIdForSeedUid(classification.uid)
      if (!storageTransactionId) {
        return {
          status: 'unresolved',
          reason: 'seed_uid_no_storage_transaction',
          classification,
        }
      }
      return resolveTxId(storageTransactionId)
    }
    default:
      return {
        status: 'unresolved',
        reason: 'unknown_ref',
        classification,
      }
  }
}

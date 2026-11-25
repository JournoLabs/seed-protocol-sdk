import { findRecordedPublishParts } from '@seedprotocol/sdk'
import debug from 'debug'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getPublishConfig } from '~/config'
import { attributeMultiPublishReceipt, partAttestationUids, type MultiPublishRequestLike } from './multiPublishReceipt'

const logger = debug('seedProtocol:services:publish:actors:earlierPartUids')

type RecordedPartRow = Awaited<ReturnType<typeof findRecordedPublishParts>>[number]

/** Fields a stored request holds as bigints, which an attempt row keeps as decimal strings. */
const BIGINT_REQUEST_FIELDS = new Set(['expirationTime', 'value', 'elementIndex'])

/**
 * The uids one recorded part attested: those its row stored, else (a row recorded before
 * `attestation_uids` existed) those read from the part's receipt by `tx_hash`, matched to the
 * requests the row kept. Empty when neither is available.
 */
async function recordedPartUids(row: RecordedPartRow): Promise<string[]> {
  if (row.attestationUids) return JSON.parse(row.attestationUids) as string[]
  if (!row.txHash) return []
  try {
    const receipt = await waitForPublishReceipt(row.txHash as `0x${string}`)
    const requests = JSON.parse(row.requests, (key, v) =>
      BIGINT_REQUEST_FIELDS.has(key) && typeof v === 'string' ? BigInt(v) : v,
    ) as MultiPublishRequestLike[]
    const attributed = attributeMultiPublishReceipt({
      receipt,
      requests,
      easContractAddress: getPublishConfig().easContractAddress,
      attester: row.attester,
    })
    return partAttestationUids(requests, attributed)
  } catch (err) {
    logger('reading the uids of part %s from its receipt failed: %O', row.id, err)
    return []
  }
}

/**
 * The uids of the parts of run `publishRunId` that were recorded before this try, oldest first, so
 * `onPublished` lists every part of a split publish and not only the ones the finishing try sent.
 * `thisTry` names this try's own attempts, which the caller reads from the receipts it holds.
 */
export async function earlierPartUids(publishRunId: string | undefined, thisTry: ReadonlySet<string>): Promise<string[]> {
  if (!publishRunId) return []
  const rows = await findRecordedPublishParts(publishRunId)
  const uids: string[] = []
  for (const row of rows) {
    if (thisTry.has(row.id)) continue
    uids.push(...(await recordedPartUids(row)))
  }
  return uids
}

import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { fetchArweaveRawTextAcrossGateways } from '@seedprotocol/arweave'

/** Published storage seeds use `0x` + 64 hex; `saveHtml` still writes `html/{localId}.html`. */
const SEED_UID_HEX_RE = /^0x[a-fA-F0-9]{64}$/

/** Arweave L1 transaction ids are 43 URL-safe base64 characters. */
const ARWEAVE_TX_ID_IN_STRING_RE = /[a-z0-9_-]{43}/i

function extractArweaveTransactionId(raw: string): string {
  const t = raw.trim()
  const embedded = t.match(ARWEAVE_TX_ID_IN_STRING_RE)
  if (embedded && /^[a-z0-9_-]{43}$/i.test(embedded[0])) {
    return embedded[0]
  }
  return t
}

/**
 * GET /raw/{txId} on each read gateway, preferred ones ({@link setPreferredArweaveReadBaseUrls})
 * first. Avoids arweave.js /tx/.../offset which often 404s on arweave.net while another gateway
 * (e.g. ar.seedprotocol.io, or the one the item was just uploaded through) still serves the data.
 */
async function fetchHtmlViaRawAcrossGateways(txId: string): Promise<string | undefined> {
  const id = extractArweaveTransactionId(txId)
  if (!id || SEED_UID_HEX_RE.test(id)) return undefined
  return fetchArweaveRawTextAcrossGateways(id)
}

/**
 * Resolve the Html storage seed's `local_id` used for the `{localId}.html` file name.
 * `propertyValue` on the parent Html property is either that local id or the seed uid after publish.
 */
export async function resolveHtmlStorageSeedLocalId(
  propertyValue: string | null | undefined,
): Promise<string | undefined> {
  const pv = String(propertyValue ?? '').trim()
  if (!pv) return undefined
  if (SEED_UID_HEX_RE.test(pv)) {
    const { findSeedRow } = await import('../db/read/findSeedRow')
    return (await findSeedRow({ uid: pv }))?.localId ?? undefined
  }
  return pv
}

/**
 * When the local draft file is gone (new device, OPFS cleared, etc.), load HTML from the
 * Html storage seed's published Arweave transaction id: a read gateway's `/raw`, then the Arweave
 * client, then a download into `html/` (named after the seed or the transaction).
 */
async function readHtmlBodyFromChildStorageArweave(seedLocalId: string): Promise<string | undefined> {
  const { storageSeedTransactionId } = await import('@/storageValue/resolve')
  const txId = await storageSeedTransactionId({ seedLocalId })
  if (!txId || SEED_UID_HEX_RE.test(txId)) return undefined

  const rawHtml = await fetchHtmlViaRawAcrossGateways(txId)
  if (rawHtml) return rawHtml

  try {
    const { BaseArweaveClient } = await import('@seedprotocol/arweave')
    const data = await BaseArweaveClient.getTransactionData(extractArweaveTransactionId(txId), {
      string: true,
    })
    if (typeof data === 'string' && data.length > 0) return data
  } catch {
    /* offline / bad tx id */
  }

  try {
    const { downloadTransactionIdWithDedupe } = await import('../events/files/download')
    await downloadTransactionIdWithDedupe(txId)
    const { findFileInDir } = await import('@/storageValue/findFile')
    const filePath = await findFileInDir('html', [`${seedLocalId}.html`, extractArweaveTransactionId(txId)])
    if (filePath) return BaseFileManager.readFileAsString(filePath)
  } catch {
    /* OPFS unsupported or download failed */
  }
  return undefined
}

/** Read saved HTML body for a parent Html property whose `propertyValue` points at the Html storage seed. */
export async function readHtmlBodyForStorageSeedPropertyValue(
  propertyValue: string | null | undefined,
): Promise<string | undefined> {
  const pv = String(propertyValue ?? '').trim()
  if (!pv) return undefined
  const localId = await resolveHtmlStorageSeedLocalId(propertyValue)
  const fp = localId ? BaseFileManager.getFilesPath('html', `${localId}.html`) : ''
  let fileExists = fp ? await BaseFileManager.pathExists(fp) : false
  // OPFS: file can appear shortly after create/download; avoid false "missing" before hitting Arweave.
  if (!fileExists && fp) {
    await BaseFileManager.waitForFileWithContent(fp, 100, 5000).catch(() => {})
    fileExists = await BaseFileManager.pathExists(fp)
  }
  let body = fileExists && fp ? await BaseFileManager.readFileAsString(fp) : undefined

  if (!body && localId) {
    body = await readHtmlBodyFromChildStorageArweave(localId)
  }

  return body
}

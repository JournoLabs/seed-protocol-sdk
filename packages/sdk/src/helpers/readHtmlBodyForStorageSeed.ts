import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import {
  getDefaultArweaveReadGatewayHostsOrdered,
  mergePrimaryHostWithDefaults,
} from '@/helpers/constants'

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
 * GET /raw/{txId} on each configured gateway. Avoids arweave.js /tx/.../offset which often 404s on
 * arweave.net while another gateway (e.g. ar.seedprotocol.io) still serves the data.
 */
async function fetchHtmlViaRawAcrossGateways(txId: string): Promise<string | undefined> {
  const id = extractArweaveTransactionId(txId)
  if (!id || SEED_UID_HEX_RE.test(id)) return undefined

  try {
    const { ensureReadGatewaySelected } = await import(
      '@/helpers/ArweaveClient/selectReadGateway'
    )
    await ensureReadGatewaySelected().catch(() => {})
  } catch {
    /* optional */
  }

  const { BaseArweaveClient } = await import('@/helpers/ArweaveClient/BaseArweaveClient')
  const protocol = BaseArweaveClient.getProtocol()
  const hosts = mergePrimaryHostWithDefaults(
    BaseArweaveClient.getHost(),
    getDefaultArweaveReadGatewayHostsOrdered(),
  )

  for (const host of hosts) {
    const h = host.trim().replace(/\/$/, '')
    if (!h) continue
    const url = `${protocol}://${h}/raw/${encodeURIComponent(id)}`
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'omit' })
      if (!res.ok) continue
      const text = await res.text()
      if (typeof text === 'string' && text.length > 0) {
        return text
      }
    } catch {
      /* next gateway */
    }
  }
  return undefined
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
    const { getSeedData } = await import('../db/read/getSeedData')
    return (await getSeedData({ seedUid: pv }))?.localId ?? undefined
  }
  return pv
}

/**
 * When the local draft file is gone (new device, OPFS cleared, etc.), load HTML from the
 * Html storage seed's published Arweave transaction id on that child seed.
 */
async function readHtmlBodyFromChildStorageArweave(seedLocalId: string): Promise<{
  body?: string
  txIdLen: number
  gatewayStringLen: number
}> {
  const { getPropertyData } = await import('../db/read/getPropertyData')
  const pickTx = async (name: string): Promise<string | undefined> => {
    const row = await getPropertyData({ propertyName: name, seedLocalId })
    const v = row?.propertyValue != null ? String(row.propertyValue).trim() : ''
    return v || undefined
  }
  const txId =
    (await pickTx('storageTransactionId')) ??
    (await pickTx('transactionId')) ??
    (await pickTx('storage_transaction_id'))
  if (!txId || SEED_UID_HEX_RE.test(txId)) {
    return { txIdLen: 0, gatewayStringLen: 0 }
  }

  const rawHtml = await fetchHtmlViaRawAcrossGateways(txId)
  if (rawHtml && rawHtml.length > 0) {
    return { body: rawHtml, txIdLen: txId.length, gatewayStringLen: rawHtml.length }
  }

  try {
    const { BaseArweaveClient } = await import('@/helpers/ArweaveClient/BaseArweaveClient')
    const data = await BaseArweaveClient.getTransactionData(extractArweaveTransactionId(txId), {
      string: true,
    })
    if (typeof data === 'string' && data.length > 0) {
      return { body: data, txIdLen: txId.length, gatewayStringLen: data.length }
    }
  } catch {
    /* offline / bad tx id */
  }

  try {
    const { downloadTransactionIdWithDedupe } = await import('../events/files/download')
    await downloadTransactionIdWithDedupe(txId)
    const retryFp = BaseFileManager.getFilesPath('html', `${seedLocalId}.html`)
    if (await BaseFileManager.pathExists(retryFp)) {
      const s = await BaseFileManager.readFileAsString(retryFp)
      return { body: s, txIdLen: txId.length, gatewayStringLen: 0 }
    }
    const dirPath = BaseFileManager.getFilesPath('html')
    if (await BaseFileManager.pathExists(dirPath)) {
      const fs = await BaseFileManager.getFs()
      const pathMod = BaseFileManager.getPathModule()
      const files = await fs.promises.readdir(dirPath)
      const needle = txId.replace(/\.[^/.]+$/, '')
      const match = files.find(
        (f: string) =>
          f.includes(seedLocalId) || f.includes(needle) || (needle.length >= 20 && f.includes(needle.slice(0, 20))),
      )
      if (match) {
        const s = await BaseFileManager.readFileAsString(pathMod.join(dirPath, match))
        return { body: s, txIdLen: txId.length, gatewayStringLen: 0 }
      }
    }
  } catch {
    /* OPFS unsupported or download failed */
  }

  return { txIdLen: txId.length, gatewayStringLen: 0 }
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
    const ar = await readHtmlBodyFromChildStorageArweave(localId)
    body = ar.body
  }

  return body
}

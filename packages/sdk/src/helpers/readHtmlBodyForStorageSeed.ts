import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import {
  isEncryptedArweaveContent,
  readArweaveRawAcrossGateways,
  type ArweaveRawReadAttempt,
} from '@seedprotocol/arweave'

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

/** Transaction ids already warned about, so re-renders of the same post don't repeat the line. */
const warnedMissingBodies = new Set<string>()

function describeAttempt({ baseUrl, outcome }: ArweaveRawReadAttempt): string {
  if (outcome === 'network') return `${baseUrl} network error`
  if (outcome === 'empty') return `${baseUrl} empty body`
  if (outcome === 'unreadable') return `${baseUrl} unreadable body`
  return `${baseUrl} ${outcome}`
}

function warnBodyNotFound(txId: string, attempts: ArweaveRawReadAttempt[]): void {
  if (warnedMissingBodies.has(txId)) return
  warnedMissingBodies.add(txId)
  const tried = attempts.length > 0 ? attempts.map(describeAttempt).join(', ') : 'no gateway configured'
  console.warn(`[seed] Html body for ${txId} not found on any gateway: ${tried}`)
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
 * Html storage seed's published Arweave transaction id: a file already downloaded into `html/`
 * under that id, else `/raw` on each read gateway once ({@link readArweaveRawAcrossGateways}).
 * When no gateway serves it, one `console.warn` names each gateway and what it answered.
 */
async function readHtmlBodyFromChildStorageArweave(seedLocalId: string): Promise<string | undefined> {
  const { storageSeedTransactionId } = await import('@/storageValue/resolve')
  const txId = await storageSeedTransactionId({ seedLocalId })
  if (!txId || SEED_UID_HEX_RE.test(txId)) return undefined

  // An id a configured blob source reads (e.g. `ipfs://<cid>`) is fetched from that source only.
  const { resolveBlobSource, fetchBlobBytes } = await import('@/storageValue/blobSources')
  const sourced = resolveBlobSource(txId)
  if (sourced) {
    const fetched = await fetchBlobBytes(sourced)
    if (!fetched) return undefined
    const { transformArweaveContent } = await import('@seedprotocol/arweave')
    const { bytes } = await transformArweaveContent({ bytes: fetched }, { transactionId: txId })
    return isEncryptedArweaveContent(bytes) ? undefined : new TextDecoder('utf-8').decode(bytes)
  }

  const id = extractArweaveTransactionId(txId)
  if (!id) return undefined

  // A bulk or earlier download names the file after the transaction, not the seed.
  try {
    const { findFileInDir } = await import('@/storageValue/findFile')
    const filePath = await findFileInDir('html', [id])
    if (filePath) {
      const saved = await BaseFileManager.readFileAsString(filePath)
      if (saved) return saved
    }
  } catch {
    /* no file storage */
  }

  // Every gateway's `/raw` is the whole search: arweave-js `getData` can't read a bundled data item
  // (the node API doesn't index them) and the download worker would ask the same gateways again.
  const { bytes, attempts } = await readArweaveRawAcrossGateways(id)
  if (!bytes) {
    warnBodyNotFound(id, attempts)
    return undefined
  }
  // An envelope no read transform opened was found, so it isn't a miss: no warning.
  if (isEncryptedArweaveContent(bytes)) return undefined
  return new TextDecoder().decode(bytes) || undefined
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

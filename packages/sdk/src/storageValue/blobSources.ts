/**
 * Where a storage id's bytes can be fetched from, for ids that are not Arweave transaction ids
 * (ADR 0026, "Blob store reads"). A `storage_transaction_id` written by a configured publish
 * `BlobStore` (e.g. `ipfs://<cid>`) is read through the source that recognizes it; anything no
 * source claims is treated as an Arweave transaction id, read from the Arweave gateways as before.
 *
 * The file download worker runs from a string and cannot be handed a source, so the page resolves
 * each id to a key and a URL list before posting to it.
 */
export interface BlobSource {
  /** Names the source in logs, e.g. `'ipfs'`. */
  readonly id: string
  /**
   * The local key for a storage id this source reads, or undefined when it is not one of this
   * source's ids. The key names the downloaded file (`images/<key>`, `files/<key>.<ext>`), so it
   * holds no `.`, `/`, `\` or `:`. Must accept its own keys: `key(key(id)) === key(id)`.
   */
  key(storageId: string): string | undefined
  /** URLs to fetch a key's bytes from, tried in order. */
  urls(key: string): string[]
  /**
   * Hex SHA-256 the bytes must match, when the id itself fixes it (a raw-codec CID does). Without
   * one, downloads from this source are saved unverified.
   */
  sha256?(key: string): string | undefined
}

let sources: readonly BlobSource[] = []

/** Replace the configured sources (`SeedConfig.blobSources` sets them at init). */
export function setBlobSources(next: readonly BlobSource[]): void {
  sources = [...next]
}

const UNSAFE_KEY_RE = /[./\\:]/

type ResolvedBlob = { source: BlobSource; key: string }

/**
 * The configured source that reads `storageId`, with its key; undefined for an Arweave id or
 * anything no source claims. A key with characters that cannot name a file is ignored.
 */
export function resolveBlobSource(storageId: string | null | undefined): ResolvedBlob | undefined {
  const raw = storageId?.trim()
  if (!raw) return undefined
  for (const source of sources) {
    const key = source.key(raw)
    if (key && !UNSAFE_KEY_RE.test(key)) return { source, key }
  }
  return undefined
}

/**
 * The name a stored id's downloaded file goes by: a configured source's key, else the id as it is
 * (an Arweave transaction id names its file directly).
 */
export function blobFileKey(storageId: string): string {
  return resolveBlobSource(storageId)?.key ?? storageId
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * The bytes at a source's URLs, tried in order: the first non-empty 2xx body, and with
 * `source.sha256` only one whose SHA-256 matches. Undefined when no URL served one.
 */
export async function fetchBlobBytes({ source, key }: ResolvedBlob): Promise<Uint8Array | undefined> {
  const expected = source.sha256?.(key)?.trim().toLowerCase()
  for (const url of source.urls(key)) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength === 0) continue
      if (expected && toHex(await globalThis.crypto.subtle.digest('SHA-256', buffer)) !== expected) continue
      return new Uint8Array(buffer)
    } catch {
      /* next URL */
    }
  }
  return undefined
}

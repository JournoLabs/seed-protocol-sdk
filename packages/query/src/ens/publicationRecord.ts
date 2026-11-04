/** ENSIP-5 text record key naming the Seed publication behind an ENS name. */
export const SEED_PUBLICATION_TEXT_KEY = 'io.seedprotocol.publication'

/** The `io.seedprotocol.publication` text record, parsed. */
export type SeedPublicationRecord = {
  /** Schema name the publication's Seeds are listed under (`queryBySchema`'s first argument). */
  schemaName: string
  /** Attester of the publication's Seeds, lower case. Absent: the name's ETH address. */
  publisher?: `0x${string}`
  /** A feed URL for readers that don't query EAS. */
  feedUrl?: string
  /** Chain the Seeds are attested on. */
  chainId?: number
}

/**
 * Parses the `io.seedprotocol.publication` text record: a JSON object with `schema` (required),
 * and optional `publisher` (20-byte hex address), `feed` (absolute URL) and `chainId` (positive
 * integer). Other keys are ignored. Throws a `TypeError` naming the first field that is wrong.
 *
 * @example
 * {"schema":"Blog","publisher":"0x1234…","feed":"https://alice.example/feed.xml","chainId":10}
 */
export function parseSeedPublicationRecord(text: string): SeedPublicationRecord {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new TypeError(`${SEED_PUBLICATION_TEXT_KEY} is not JSON`)
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new TypeError(`${SEED_PUBLICATION_TEXT_KEY} is not a JSON object`)
  }
  const raw = json as Record<string, unknown>

  if (typeof raw.schema !== 'string' || raw.schema.trim() === '') {
    throw new TypeError(`${SEED_PUBLICATION_TEXT_KEY} needs a "schema" string`)
  }
  const record: SeedPublicationRecord = { schemaName: raw.schema.trim() }

  if (raw.publisher !== undefined) {
    if (typeof raw.publisher !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(raw.publisher)) {
      throw new TypeError(`${SEED_PUBLICATION_TEXT_KEY} "publisher" is not a 20-byte hex address`)
    }
    record.publisher = raw.publisher.toLowerCase() as `0x${string}`
  }
  if (raw.feed !== undefined) {
    if (typeof raw.feed !== 'string' || !URL.canParse(raw.feed)) {
      throw new TypeError(`${SEED_PUBLICATION_TEXT_KEY} "feed" is not an absolute URL`)
    }
    record.feedUrl = raw.feed
  }
  if (raw.chainId !== undefined) {
    if (typeof raw.chainId !== 'number' || !Number.isSafeInteger(raw.chainId) || raw.chainId <= 0) {
      throw new TypeError(`${SEED_PUBLICATION_TEXT_KEY} "chainId" is not a positive integer`)
    }
    record.chainId = raw.chainId
  }
  return record
}

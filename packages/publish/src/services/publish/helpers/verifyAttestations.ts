import { getItemPropertiesFromEas } from '@seedprotocol/sdk'
import { AttestationVerificationError } from '../../../errors'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:verifyAttestations')

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

const BYTES32_LEN = 64
const toHex32 = (v: unknown): string => {
  if (v == null) return '0x' + '0'.repeat(BYTES32_LEN)
  if (typeof v === 'string') {
    const raw = v.startsWith('0x') ? v.slice(2) : v
    const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(BYTES32_LEN, '0').slice(-BYTES32_LEN)
    return '0x' + hex
  }
  return '0x' + '0'.repeat(BYTES32_LEN)
}

/** Delay between verification retries. EAS indexing can lag; longer delay improves success rate. */
const VERIFY_DELAY_MS = 5000
/** Max retries before giving up. EAS indexing can take 10–30+ seconds in high load. */
const VERIFY_MAX_ATTEMPTS = 6

type NormalizedRequest = {
  localId: string
  versionUid: string
  listOfAttestations: Array<{ schema: string }>
}

type VerifyAttestationsInput = {
  normalizedRequests: NormalizedRequest[]
  item: { seedLocalId: string }
}

/** Test seams: the indexer query and the retry timing. */
type VerifyAttestationsOptions = {
  getProperties?: (args: { versionUids: string[] }) => Promise<{ schemaId?: string }[]>
  delayMs?: number
  maxAttempts?: number
}

/**
 * Verifies that property/metadata attestations created during publish exist on EAS.
 * The indexer can lag the chain, so a failed query or a result missing expected schemas is
 * retried every `delayMs` up to `maxAttempts` times. Throws AttestationVerificationError if
 * schemas are still missing after the last attempt, or the last query error if every query threw.
 */
export async function verifyAttestations(
  { normalizedRequests, item }: VerifyAttestationsInput,
  {
    getProperties = getItemPropertiesFromEas,
    delayMs = VERIFY_DELAY_MS,
    maxAttempts = VERIFY_MAX_ATTEMPTS,
  }: VerifyAttestationsOptions = {},
): Promise<void> {
  const seedLocalId = item.seedLocalId

  for (const request of normalizedRequests) {
    if (request.listOfAttestations.length === 0) continue
    if (request.versionUid === ZERO_BYTES32) continue

    const expectedSchemas = request.listOfAttestations.map((a) =>
      toHex32(a.schema).toLowerCase(),
    )

    let foundSchemas: string[] = []
    let missing: string[] = expectedSchemas
    let queried = false
    let lastError: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await new Promise((r) => setTimeout(r, delayMs))
      }
      try {
        const easProperties = await getProperties({ versionUids: [request.versionUid] })
        queried = true
        foundSchemas = easProperties
          .map((p) => (p.schemaId ? toHex32(p.schemaId).toLowerCase() : ''))
          .filter(Boolean)
        const foundSet = new Set(foundSchemas)
        missing = expectedSchemas.filter((s) => !foundSet.has(s))
        if (missing.length === 0) break
        logger(
          'verifyAttestations attempt %d: %d of %d schemas not indexed yet',
          attempt,
          missing.length,
          expectedSchemas.length,
        )
      } catch (err) {
        lastError = err
        logger('verifyAttestations attempt %d failed:', attempt, err)
      }
    }

    if (!queried) {
      logger('verifyAttestations: giving up after %d attempts', maxAttempts)
      throw lastError
    }

    if (missing.length > 0) {
      throw new AttestationVerificationError(
        `Publish verification failed: Seed and Version attestations were created, but ` +
          `property/metadata attestations are missing or incomplete. ` +
          `Expected ${expectedSchemas.length} property attestations for schema(s) ${expectedSchemas.join(', ')}; ` +
          `found ${foundSchemas.length}. ` +
          `Use PublishManager.retryAttestations('${seedLocalId}') to retry.`,
        seedLocalId,
        expectedSchemas,
        foundSchemas,
        'METADATA_PROPERTIES_MISSING',
      )
    }
  }
}

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

const VERIFY_DELAY_MS = 2000
const VERIFY_MAX_ATTEMPTS = 3

type NormalizedRequest = {
  localId: string
  versionUid: string
  listOfAttestations: Array<{ schema: string }>
}

type VerifyAttestationsInput = {
  normalizedRequests: NormalizedRequest[]
  item: { seedLocalId: string }
}

/**
 * Verifies that property/metadata attestations created during publish exist on EAS.
 * Throws AttestationVerificationError if any expected attestations are missing.
 */
export async function verifyAttestations({
  normalizedRequests,
  item,
}: VerifyAttestationsInput): Promise<void> {
  const seedLocalId = item.seedLocalId

  for (const request of normalizedRequests) {
    if (request.listOfAttestations.length === 0) continue
    if (request.versionUid === ZERO_BYTES32) continue

    const expectedSchemas = request.listOfAttestations.map((a) =>
      toHex32(a.schema).toLowerCase(),
    )
    const expectedSet = new Set(expectedSchemas)

    let easProperties: { schemaId?: string }[] = []
    let lastError: unknown

    for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS))
        }
        easProperties = await getItemPropertiesFromEas({
          versionUids: [request.versionUid],
        })
        break
      } catch (err) {
        lastError = err
        logger('verifyAttestations attempt %d failed:', attempt, err)
        if (attempt === VERIFY_MAX_ATTEMPTS) {
          logger('verifyAttestations: giving up after %d attempts', VERIFY_MAX_ATTEMPTS)
          throw lastError
        }
      }
    }

    const foundSchemas = easProperties
      .map((p) => (p.schemaId ? toHex32(p.schemaId).toLowerCase() : ''))
      .filter(Boolean)
    const foundSet = new Set(foundSchemas)

    const missing = expectedSchemas.filter((s) => !foundSet.has(s))
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

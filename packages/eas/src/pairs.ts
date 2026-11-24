import { checksumAddresses } from './utils.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { timedFetchQuery } from './easTiming.js'
import { INCLUSION_SCHEMA_UID, STAFF_SCHEMA_UID } from './constants.js'
import { GET_PAIR_HALVES } from './queries.js'

/** A half of an Inclusion or Staff pair as EAS lists it. Addresses and uids are lowercase. */
export type PairHalfAttestation = {
  id: string
  schemaId: string
  attester: string
  recipient: string
  refUID: string
  decodedDataJson: string
  timeCreated: number
  revoked: boolean
  /** Unix seconds; 0 when not revoked. */
  revocationTime: number
}

/** The data of an Inclusion half ({@link INCLUSION_SCHEMA_DEF}). `version` is zero on an author half. */
export type InclusionHalfData = { publication: string; post: string; version: string }

/** The data of a Staff half ({@link STAFF_SCHEMA_DEF}). */
export type StaffHalfData = { publication: string; identity: string }

/** Addresses per `in` filter, so a request body stays small. */
const ADDRESSES_PER_REQUEST = 200

const BYTES32 = /^0x[0-9a-f]{64}$/

/**
 * Halves of the pair schemas `schemaUids` (Inclusion, Staff) by one of `attesters` or with one of
 * `recipients` as their recipient, revoked ones included, newest first. With both lists, a half
 * matching either is returned. A half's recipient is only an index (anyone can set any
 * recipient), so callers still check who attested each half. Values that aren't addresses are
 * ignored; with none left, no request is made.
 */
export const getPairHalvesFromEas = async ({
  schemaUids,
  attesters = [],
  recipients = [],
}: {
  schemaUids: readonly string[]
  attesters?: readonly string[]
  recipients?: readonly string[]
}): Promise<PairHalfAttestation[]> => {
  const byAttester = [...new Set(checksumAddresses([...attesters]))].sort()
  const byRecipient = [...new Set(checksumAddresses([...recipients]))].sort()
  const schemas = [...new Set(schemaUids.map((uid) => uid.toLowerCase()))].sort()
  if (schemas.length === 0) return []

  // One request per chunk, matching either list.
  const filters: Record<string, unknown>[] = []
  for (let i = 0; i < Math.max(byAttester.length, byRecipient.length); i += ADDRESSES_PER_REQUEST) {
    const either: Record<string, unknown>[] = []
    const attesterChunk = byAttester.slice(i, i + ADDRESSES_PER_REQUEST)
    const recipientChunk = byRecipient.slice(i, i + ADDRESSES_PER_REQUEST)
    if (attesterChunk.length > 0) either.push({ attester: { in: attesterChunk } })
    if (recipientChunk.length > 0) either.push({ recipient: { in: recipientChunk } })
    filters.push(either.length === 1 ? either[0]! : { OR: either })
  }
  if (filters.length === 0) return []

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  const responses = await Promise.all(
    filters.map(
      (filter) =>
        timedFetchQuery(queryClient, {
          queryKey: ['getPairHalvesFromEas', schemas, filter],
          queryFn: async () =>
            easClient.request(GET_PAIR_HALVES, { where: { AND: [{ schemaId: { in: schemas } }, filter] } }),
        }) as Promise<{ halves: PairHalfAttestation[] }>,
    ),
  )

  const byId = new Map<string, PairHalfAttestation>()
  for (const { halves } of responses) {
    for (const half of halves ?? []) {
      const id = half.id.toLowerCase()
      byId.set(id, {
        ...half,
        id,
        schemaId: half.schemaId.toLowerCase(),
        attester: half.attester.toLowerCase(),
        recipient: half.recipient.toLowerCase(),
        refUID: half.refUID.toLowerCase(),
        revocationTime: Number(half.revocationTime ?? 0),
      })
    }
  }
  return [...byId.values()].sort((a, b) => b.timeCreated - a.timeCreated || (a.id < b.id ? 1 : -1))
}

/** Named bytes32 fields of EAS `decodedDataJson`, lowercase; null if one is missing or not bytes32. */
function decodeBytes32Fields<K extends string>(decodedDataJson: string, names: readonly K[]): Record<K, string> | null {
  let fields: unknown
  try {
    fields = JSON.parse(decodedDataJson)
  } catch {
    return null
  }
  if (!Array.isArray(fields)) return null
  const out = {} as Record<K, string>
  for (const name of names) {
    const field = fields.find((f) => (f as { name?: unknown })?.name === name) as
      | { value?: { value?: unknown } }
      | undefined
    const value = field?.value?.value
    if (typeof value !== 'string' || !BYTES32.test(value.toLowerCase())) return null
    out[name] = value.toLowerCase()
  }
  return out
}

/** The fields of an Inclusion half, or null when its data isn't an Inclusion's. */
export function decodeInclusionHalf(half: Pick<PairHalfAttestation, 'schemaId' | 'decodedDataJson'>): InclusionHalfData | null {
  if (half.schemaId.toLowerCase() !== INCLUSION_SCHEMA_UID) return null
  return decodeBytes32Fields(half.decodedDataJson, ['publication', 'post', 'version'] as const)
}

/** The fields of a Staff half, or null when its data isn't a Staff half's. */
export function decodeStaffHalf(half: Pick<PairHalfAttestation, 'schemaId' | 'decodedDataJson'>): StaffHalfData | null {
  if (half.schemaId.toLowerCase() !== STAFF_SCHEMA_UID) return null
  return decodeBytes32Fields(half.decodedDataJson, ['publication', 'identity'] as const)
}

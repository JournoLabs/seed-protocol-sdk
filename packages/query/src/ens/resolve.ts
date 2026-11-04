import {
  BaseError,
  ContractFunctionRevertedError,
  decodeFunctionResult,
  encodeFunctionData,
  getChainContractAddress,
  toHex,
  type Address,
  type Chain,
  type Client,
  type Transport,
} from 'viem'
import { readContract } from 'viem/actions'
import { getEnsAddress, getEnsName, getEnsText, namehash, normalize, packetToBytes } from 'viem/ens'
import { decodeContenthash, type EnsContenthash } from './contenthash.js'
import { parseSeedPublicationRecord, SEED_PUBLICATION_TEXT_KEY } from './publicationRecord.js'

/** A viem client on the chain that holds the ENS registry (mainnet, or Sepolia for test names). */
export type EnsClient = Client<Transport, Chain | undefined>

export type EnsReadOptions = {
  /** CCIP-Read batch gateways. Default: viem's (resolved in the client). */
  gatewayUrls?: string[]
  /** Universal Resolver to call. Default: the client chain's `ensUniversalResolver`. */
  universalResolverAddress?: Address
}

export type SeedPublication = {
  /** The name, normalized (UTS-46). */
  name: string
  schemaName: string
  /** The record's `publisher`, else the name's ETH address; lower case. */
  publisher: `0x${string}`
  feedUrl?: string
  chainId?: number
  /** The name's decoded contenthash, `null` when it has none. */
  contenthash: EnsContenthash | null
}

// viem's own Universal Resolver ABI isn't exported. These match `universalResolverResolveAbi`
// in viem/constants/abis, with only the errors that mean "no record".
const universalResolverAbi = [
  { type: 'error', name: 'ResolverNotFound', inputs: [{ name: 'name', type: 'bytes' }] },
  {
    type: 'error',
    name: 'ResolverNotContract',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'resolver', type: 'address' },
    ],
  },
  { type: 'error', name: 'ResolverError', inputs: [{ name: 'errorData', type: 'bytes' }] },
  { type: 'error', name: 'UnsupportedResolverProfile', inputs: [{ name: 'selector', type: 'bytes4' }] },
  {
    type: 'error',
    name: 'HttpError',
    inputs: [
      { name: 'status', type: 'uint16' },
      { name: 'message', type: 'string' },
    ],
  },
  {
    type: 'function',
    name: 'resolveWithGateways',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'data', type: 'bytes' },
      { name: 'gateways', type: 'string[]' },
    ],
    outputs: [
      { name: '', type: 'bytes' },
      { name: 'address', type: 'address' },
    ],
  },
] as const

const contenthashResolverAbi = [
  {
    type: 'function',
    name: 'contenthash',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const

/** viem resolves this gateway in the client, batching CCIP-Read lookups (viem's default). */
const LOCAL_BATCH_GATEWAY = 'x-batch-gateway:true'

const NO_RECORD_ERRORS = new Set([
  'ResolverNotFound',
  'ResolverNotContract',
  'ResolverError',
  'UnsupportedResolverProfile',
  'HttpError',
])

/**
 * The name's contenthash (EIP-1577), decoded; `null` when the name has no resolver, its resolver
 * has no contenthash, or the record is empty. Resolves through the Universal Resolver, so ENSIP-10
 * wildcard names and CCIP-Read (offchain) resolvers work. The name is normalized first.
 * Throws a `TypeError` when the record holds a codec `decodeContenthash` doesn't read.
 */
export async function getEnsContenthash(
  client: EnsClient,
  { name, ...options }: { name: string } & EnsReadOptions,
): Promise<EnsContenthash | null> {
  const normalized = normalize(name)
  const address =
    options.universalResolverAddress ??
    (() => {
      if (!client.chain) throw new Error('ENS client has no chain; pass universalResolverAddress')
      return getChainContractAddress({ chain: client.chain, contract: 'ensUniversalResolver' })
    })()

  let data: `0x${string}`
  try {
    [data] = await readContract(client, {
      address,
      abi: universalResolverAbi,
      functionName: 'resolveWithGateways',
      args: [
        toHex(packetToBytes(normalized)),
        encodeFunctionData({ abi: contenthashResolverAbi, functionName: 'contenthash', args: [namehash(normalized)] }),
        options.gatewayUrls ?? [LOCAL_BATCH_GATEWAY],
      ],
    })
  } catch (err) {
    if (isNoRecordError(err)) return null
    throw err
  }
  if (data === '0x') return null
  const contenthash = decodeFunctionResult({ abi: contenthashResolverAbi, functionName: 'contenthash', data })
  return decodeContenthash(contenthash)
}

/**
 * Reads the Seed publication an ENS name points at: its `io.seedprotocol.publication` text record
 * (see `parseSeedPublicationRecord`) and its contenthash. Returns `null` when the name has no such
 * record. Without a `publisher` in the record, the name's ETH address is the publisher; with
 * neither, it throws. A record that doesn't parse throws a `TypeError`.
 *
 * List its Seeds with `queryBySchema(pub.schemaName, { attesters: [pub.publisher] })`.
 */
export async function getSeedPublication(
  client: EnsClient,
  { name, ...options }: { name: string } & EnsReadOptions,
): Promise<SeedPublication | null> {
  const normalized = normalize(name)
  const [text, contenthash] = await Promise.all([
    getEnsText(client, { name: normalized, key: SEED_PUBLICATION_TEXT_KEY, ...options }),
    getEnsContenthash(client, { name: normalized, ...options }),
  ])
  if (text === null) return null

  const record = parseSeedPublicationRecord(text)
  const publisher =
    record.publisher ??
    ((await getEnsAddress(client, { name: normalized, ...options }))?.toLowerCase() as `0x${string}` | undefined)
  if (!publisher) {
    throw new Error(`${normalized} has a ${SEED_PUBLICATION_TEXT_KEY} record with no publisher and no ETH address`)
  }

  const publication: SeedPublication = { name: normalized, schemaName: record.schemaName, publisher, contenthash }
  if (record.feedUrl !== undefined) publication.feedUrl = record.feedUrl
  if (record.chainId !== undefined) publication.chainId = record.chainId
  return publication
}

/**
 * Primary ENS names for addresses, for showing attesters. The Universal Resolver checks that each
 * name resolves back to its address. Keys are the addresses lower case; an address with no primary name maps to `null`.
 * Duplicates and case variants are looked up once. Entries that aren't 20-byte hex are skipped.
 */
export async function getEnsNames(
  client: EnsClient,
  addresses: readonly string[],
  options: EnsReadOptions = {},
): Promise<Map<string, string | null>> {
  const unique = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))]
  const names = await Promise.all(
    unique.map((address) => getEnsName(client, { address: address as Address, ...options })),
  )
  return new Map(unique.map((address, i) => [address, names[i] ?? null]))
}

function isNoRecordError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false
  const cause = err.walk((e) => e instanceof ContractFunctionRevertedError)
  return cause instanceof ContractFunctionRevertedError && NO_RECORD_ERRORS.has(cause.data?.errorName ?? '')
}

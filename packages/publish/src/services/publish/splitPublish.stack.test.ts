import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import { Wallet } from 'ethers'
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimismSepolia } from 'viem/chains'
import { startAaStack, type AaStack } from '../../../test-utils/aaStack/aaStack'
import { initPublish, type PublishConfig } from '../../config'
import { easAbi } from '../../helpers/abi/eas'
import { schemaRegistryAbi } from '../../helpers/abi/schemaRegistry'
import { createManagedAccountTxSender } from '../../helpers/adapters/managedAccountTxSender'
import { type MultiPublishRequest } from '../../helpers/contracts'
import { publishGasCeiling } from '../../helpers/publishGas'
import { fitPublishPart, localPrefixLength, partRequests, publishUnits } from '../../helpers/publishParts'
import { fromEthersWallet, type PublishWallet } from '../../helpers/seedSigner'
import { resolveMultiPublishSender } from './actors/createAttestations'

// A split publish (ADR 0036) against the real OP Sepolia contracts on a replayed fork: the
// ManagedAccount's three-phase multiPublish, EAS and the schema registry. Keys, the clock and
// block timestamps are fixed so the fork reads only recorded state: viem takes each UserOp's nonce
// key from Date.now(), and an attestation's uid, so the EAS storage slot it is written to,
// includes its block's time.

const EAS = '0x4200000000000000000000000000000000000021' as Address
const SCHEMA_REGISTRY = '0x4200000000000000000000000000000000000020' as Address
const ZERO = `0x${'0'.repeat(64)}` as Hex
const keyFor = (label: string) => keccak256(toHex(`seed split publish stack ${label}`))

const SCHEMAS = {
  authorSeed: 'bytes32 seedSplitStackAuthor',
  postSeed: 'bytes32 seedSplitStackPost',
  version: 'uint8 seedSplitStackVersion',
  name: 'string seedSplitStackName',
  authors: 'bytes32[] seedSplitStackAuthors',
} as const
const uidOfSchema = (schema: string) => keccak256(encodePacked(['string', 'address', 'bool'], [schema, zeroAddress, true]))
const SCHEMA = Object.fromEntries(Object.entries(SCHEMAS).map(([k, s]) => [k, uidOfSchema(s)])) as Record<
  keyof typeof SCHEMAS,
  Hex
>

const entry = (data: Hex) => ({ recipient: zeroAddress, expirationTime: 0n, revocable: true, refUID: ZERO, data, value: 0n })
const listOf = (words: Hex[]) => encodeAbiParameters([{ type: 'bytes32[]' }], [words])
const wordOf = (localId: string) => stringToHex(localId, { size: 32 })

const authorRequest = (localId: string, postLocalId: string, elementIndex: number): MultiPublishRequest => ({
  localId,
  seedUid: ZERO,
  seedSchemaUid: SCHEMA.authorSeed,
  versionUid: ZERO,
  versionSchemaUid: SCHEMA.version,
  seedIsRevocable: true,
  listOfAttestations: [
    { schema: SCHEMA.name, _easType: 'string', data: [entry(encodeAbiParameters([{ type: 'string' }], [`Author ${localId}`]))] },
  ],
  propertiesToUpdate: [{ publishLocalId: postLocalId, propertySchemaUid: SCHEMA.authors, listElement: true, elementIndex }],
})

/** A Post whose `authors` list holds each entry of `authors`: a draft's local id, or a published seed uid. */
const postRequest = (localId: string, authors: Hex[]): MultiPublishRequest => ({
  localId,
  seedUid: ZERO,
  seedSchemaUid: SCHEMA.postSeed,
  versionUid: ZERO,
  versionSchemaUid: SCHEMA.version,
  seedIsRevocable: true,
  listOfAttestations: [{ schema: SCHEMA.authors, _easType: 'bytes32[]', data: [entry(listOf(authors))] }],
  propertiesToUpdate: [],
})

/** Draft authors and the Post that lists them, as getPublishPayload builds a first publish. */
const draftGraph = (prefix: string, authorCount: number): MultiPublishRequest[] => {
  const post = `${prefix}post`
  const authors = Array.from({ length: authorCount }, (_, i) => `${prefix}author${i}`)
  return [...authors.map((a, i) => authorRequest(a, post, i)), postRequest(post, authors.map(wordOf))]
}

const baseConfig: PublishConfig = {
  chain: optimismSepolia,
  rpcUrl: '',
  uploadApiBaseUrl: 'http://127.0.0.1:9',
}

let stack: AaStack & { forkMisses: string[] }
let client: ReturnType<typeof createPublicClient>
let publisher: Address
let wallet: PublishWallet

beforeAll(async () => {
  setSystemTime(new Date('2026-11-06T00:00:00Z'))
  stack = await startAaStack()
  baseConfig.rpcUrl = stack.rpcUrl
  initPublish(baseConfig)
  client = createPublicClient({ chain: optimismSepolia, transport: http(stack.rpcUrl) })
  const rpc = (method: string, params: unknown[]) => client.request({ method: method as never, params: params as never })
  // Later than any block the stack mined at wall-clock time, then one second per block.
  await rpc('evm_setNextBlockTimestamp', [Date.parse('2030-01-01T00:00:00Z') / 1000])
  await rpc('anvil_setBlockTimestampInterval', [1])

  // Register this file's schemas on the fork, so it doesn't depend on which ones OP Sepolia has.
  const registrar = privateKeyToAccount(keyFor('registrar'))
  await stack.setBalance(registrar.address, parseEther('1'))
  const registrarClient = createWalletClient({ account: registrar, chain: optimismSepolia, transport: http(stack.rpcUrl) })
  for (const schema of Object.values(SCHEMAS)) {
    const hash = await registrarClient.writeContract({
      address: SCHEMA_REGISTRY,
      abi: schemaRegistryAbi,
      functionName: 'register',
      args: [schema, zeroAddress, true],
    })
    await client.waitForTransactionReceipt({ hash })
  }

  const signer = fromEthersWallet(new Wallet(keyFor('publisher'))).signer
  const txSender = await createManagedAccountTxSender({
    signer,
    bundlerUrl: stack.bundlerUrl,
    paymasterUrl: stack.paymasterUrl,
  })
  publisher = txSender.address as Address
  wallet = { signer, txSender, kind: 'modular' }
  // Publish expects a deployed account (account setup deploys it first); its first UserOp does that.
  await txSender.sendTransaction({ to: '0x000000000000000000000000000000000000bEEF', data: '0x' })
}, 120_000)

afterAll(async () => {
  setSystemTime()
  await stack?.stop()
  if (stack?.forkMisses.length) {
    throw new Error(
      `The fork read state the fixture lacks; record it again (SEED_AA_STACK_RECORD=1 SEED_LIVE_NETWORK_TESTS=1):\n${stack.forkMisses.join('\n')}`,
    )
  }
})

/** Sends `requests` as one multiPublish from the ManagedAccount and returns each new seed uid by schema, in log order. */
async function sendPart(requests: MultiPublishRequest[]) {
  const { sendMultiPublish } = await resolveMultiPublishSender({ address: publisher, wallet })
  const { transactionHash } = await sendMultiPublish(requests, (send) => send())
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash })
  expect(receipt.status).toBe('success')
  const attested = parseEventLogs({ abi: easAbi, eventName: 'Attested', logs: receipt.logs })
  return (schema: Hex) => attested.filter((l) => l.args.schemaUID.toLowerCase() === schema.toLowerCase()).map((l) => l.args.uid)
}

describe('a split publish on the AA stack', () => {
  test('two parts land, and the second part relation holds the first part seed uids', async () => {
    const units = publishUnits(draftGraph('a', 2))
    expect(units.map((u) => u.map((r) => r.localId))).toEqual([['aauthor0'], ['aauthor1'], ['apost']])

    // Part 1: the two authors. partRequests drops their references to the Post, which isn't in it.
    const part1 = partRequests(units, 2)
    expect(part1.flatMap((r) => r.propertiesToUpdate)).toEqual([])
    const authorUids = (await sendPart(part1))(SCHEMA.authorSeed)
    expect(authorUids).toHaveLength(2)

    // Part 2, rebuilt as getPublishPayload would after part 1 records: the authors are published,
    // so the Post's list holds their seed uids and nothing references a draft.
    const postUids = await sendPart([postRequest('apost', authorUids)])
    const [listUid] = postUids(SCHEMA.authors)
    expect(postUids(SCHEMA.postSeed)).toHaveLength(1)

    const attestation = await client.readContract({ address: EAS, abi: easAbi, functionName: 'getAttestation', args: [listUid!] })
    expect(attestation.attester.toLowerCase()).toBe(publisher.toLowerCase())
    const [listed] = decodeAbiParameters([{ type: 'bytes32[]' }], attestation.data)
    expect(listed).toEqual(authorUids)
  }, 120_000)

  test('fitPublishPart cuts at the real estimate', async () => {
    const { estimateMultiPublish } = await resolveMultiPublishSender({ address: publisher, wallet })
    const units = publishUnits(draftGraph('b', 5))
    expect(units).toHaveLength(6)
    const gasOf = async (count: number) => {
      const gas = await estimateMultiPublish(partRequests(units, count))
      if (typeof gas !== 'bigint') throw new Error(`no gas estimate for ${count} authors: ${gas}`)
      return gas
    }
    const threeAuthors = await gasOf(3)
    const fourAuthors = await gasOf(4)
    expect(fourAuthors).toBeGreaterThan(threeAuthors)

    // Lowered so the real estimate, not the default 16M limit, cuts this graph: a ceiling between
    // the estimates of three and four authors leaves room for three per part.
    const ceiling = (threeAuthors + fourAuthors) / 2n
    initPublish({ ...baseConfig, maxPublishGas: ceiling })
    try {
      expect(await publishGasCeiling()).toBe(ceiling)
      const first = await fitPublishPart(units, estimateMultiPublish, ceiling)
      expect(first).toBe(3)
      // The local estimate is a lower bound and allows more: the RPC estimate made the cut.
      expect(localPrefixLength(units)).toBeGreaterThan(first)

      // The rest as the next part's payload holds it: the first part's authors are published, so
      // the Post lists seed uids for them (any word that isn't a draft's local id or a placeholder).
      const authorIds = units.slice(0, 5).map(([r]) => r!.localId)
      const recorded = new Set(partRequests(units, first).map((r) => r.localId))
      const authorWords = authorIds.map((id) => (recorded.has(id) ? keccak256(toHex(id)) : wordOf(id)))
      const restUnits = publishUnits([...units.slice(first, 5).flat(), postRequest('bpost', authorWords)])
      expect(restUnits).toHaveLength(3)
      // The rest goes in one part: two parts in all.
      expect(await fitPublishPart(restUnits, estimateMultiPublish, ceiling)).toBe(restUnits.length)
    } finally {
      initPublish(baseConfig)
    }
  }, 120_000)
})

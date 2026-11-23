import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { INCLUSION_SCHEMA_DEF, INCLUSION_SCHEMA_UID, STAFF_SCHEMA_DEF, STAFF_SCHEMA_UID, VERSION_SCHEMA_UID, seedSchemaUid } from '@seedprotocol/eas'
import { JsonRpcProvider, Wallet } from 'ethers'
import { createPublicClient, http, keccak256, parseAbi, parseEther, toHex, type Address } from 'viem'
import { optimismSepolia } from 'viem/chains'
import { startAaStack, type AaStack } from '../../../test-utils/aaStack/aaStack'

// Inclusion and Staff halves against the real OP Sepolia SchemaRegistry and EAS predeploys on the
// replayed fork, from EOAs and from a sponsored ManagedAccount. Keys, the clock and block
// timestamps are fixed so the fork reads only recorded state: an attestation's uid, and so the EAS
// storage slot it is written to, includes its block's time.

const { initPublish } = await import('../../config')
const { fromEthersWallet } = await import('../../helpers/seedSigner')
const { createManagedAccountTxSender } = await import('../../helpers/adapters/managedAccountTxSender')
const { PairSchemaNotRegisteredError } = await import('../../errors')
const { getAttestedUidsFromReceipt, prepareEasAttest, ZERO_ADDRESS, ZERO_BYTES32 } = await import('../../helpers/easDirect')
const { registerSchema, getSchemaRecord } = await import('../../helpers/schemaRegistry')
const { waitForPublishReceipt } = await import('../../helpers/chainClient')
const pairs = await import('./index')

const EAS = '0x4200000000000000000000000000000000000021' as Address
const SEED_SCHEMA_DEF = 'bytes32 pair_test_seed'
const SEED_SCHEMA_UID = seedSchemaUid(SEED_SCHEMA_DEF) as `0x${string}`
const keyFor = (label: string) => keccak256(toHex(`seed pair halves ${label}`))

type Wallet_ = ReturnType<typeof fromEthersWallet>
let stack: AaStack & { forkMisses: string[] }
const eoaWallet = (label: string): Wallet_ =>
  fromEthersWallet(new Wallet(keyFor(label), new JsonRpcProvider(stack.rpcUrl, optimismSepolia.id, { staticNetwork: true })))

const ATTESTATION_ABI = parseAbi([
  'function getAttestation(bytes32 uid) view returns ((bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))',
])
const makeClient = (rpcUrl: string) => createPublicClient({ chain: optimismSepolia, transport: http(rpcUrl) })
let client: ReturnType<typeof makeClient>
const onChain = (uid: string) =>
  client.readContract({ address: EAS, abi: ATTESTATION_ABI, functionName: 'getAttestation', args: [uid as `0x${string}`] })
const nonce = (wallet: Wallet_) => client.getTransactionCount({ address: wallet.txSender.address as Address })
const fields = (definition: string, data: `0x${string}`) =>
  Object.fromEntries(new SchemaEncoder(definition).decodeData(data).map((f) => [f.name, String(f.value.value).toLowerCase()]))

/** Attests under `schema` from `wallet` and returns the new uid. */
async function attestRaw(wallet: Wallet_, schema: `0x${string}`, refUID: string, data: `0x${string}`): Promise<`0x${string}`> {
  const { transactionHash } = await wallet.txSender.sendTransaction(
    prepareEasAttest({
      schema,
      data: { recipient: ZERO_ADDRESS as `0x${string}`, expirationTime: 0n, revocable: true, refUID: refUID as `0x${string}`, data, value: 0n },
    }),
  )
  const receipt = await waitForPublishReceipt(transactionHash)
  const created = getAttestedUidsFromReceipt(receipt, EAS, wallet.txSender.address).find((a) => a.schemaUid.toLowerCase() === schema)
  if (!created) throw new Error('no attestation')
  return created.uid.toLowerCase() as `0x${string}`
}
const seed = (wallet: Wallet_) => attestRaw(wallet, SEED_SCHEMA_UID, ZERO_BYTES32, ZERO_BYTES32 as `0x${string}`)
const versionOf = (wallet: Wallet_, seedUid: string) => attestRaw(wallet, VERSION_SCHEMA_UID as `0x${string}`, seedUid, ZERO_BYTES32 as `0x${string}`)

let owner: Wallet_
let author: Wallet_
let person: Wallet_
let mallory: Wallet_
const uids = {} as Record<'publication' | 'post' | 'v1' | 'v2' | 'ownPost' | 'malloryVersion' | 'identity' | 'post2' | 'post2v', `0x${string}`>
/** The author's offer from the second test. */
let offerUid: `0x${string}`

beforeAll(async () => {
  setSystemTime(new Date('2026-11-23T00:00:00Z'))
  stack = await startAaStack()
  initPublish({ chain: optimismSepolia, rpcUrl: stack.rpcUrl, uploadApiBaseUrl: 'http://127.0.0.1:9' })
  client = makeClient(stack.rpcUrl)
  const rpc = (method: string, params: unknown[]) =>
    fetch(stack.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  // Later than any block the stack mined at wall-clock time, then one second per block.
  await rpc('evm_setNextBlockTimestamp', [Date.parse('2030-01-01T00:00:00Z') / 1000])
  await rpc('anvil_setBlockTimestampInterval', [1])

  owner = eoaWallet('owner')
  author = eoaWallet('author')
  person = eoaWallet('person')
  mallory = eoaWallet('mallory')
  for (const w of [owner, author, person, mallory]) await stack.setBalance(w.txSender.address as Address, parseEther('1'))

  if (!(await getSchemaRecord(SEED_SCHEMA_UID))) {
    await waitForPublishReceipt(
      (await owner.txSender.sendTransaction(registerSchema({ schema: SEED_SCHEMA_DEF, resolverAddress: ZERO_ADDRESS, revocable: true }))).transactionHash,
    )
  }
  uids.publication = await seed(owner)
  uids.post = await seed(author)
  uids.v1 = await versionOf(author, uids.post)
  uids.v2 = await versionOf(author, uids.post)
  uids.ownPost = await seed(owner)
  uids.malloryVersion = await versionOf(mallory, uids.post)
  uids.identity = await seed(person)
  uids.post2 = await seed(author)
  uids.post2v = await versionOf(author, uids.post2)
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

describe('Inclusion and Staff halves on OP Sepolia', () => {
  test('refuses while a schema is missing, then any wallet registers each schema once', async () => {
    const before = await nonce(author)
    await expect(pairs.attestInclusionHalf({ wallet: author, half: 'author', publicationUid: uids.publication, postUid: uids.post })).rejects.toBeInstanceOf(
      PairSchemaNotRegisteredError,
    )
    await expect(
      pairs.attestStaffHalf({ wallet: owner, half: 'owner', publicationUid: uids.publication, identityUid: uids.identity }),
    ).rejects.toBeInstanceOf(PairSchemaNotRegisteredError)
    expect(await nonce(author)).toBe(before)

    expect(await pairs.ensureInclusionSchema(mallory)).toBe(INCLUSION_SCHEMA_UID)
    expect(await pairs.ensureStaffSchema(mallory)).toBe(STAFF_SCHEMA_UID)
    const registered = await nonce(mallory)
    await pairs.ensureInclusionSchema(mallory)
    await pairs.ensureStaffSchema(mallory)
    expect(await nonce(mallory)).toBe(registered)
  }, 60_000)

  test('an author offers, and the owner accepts a Version and later a newer one', async () => {
    const offer = await pairs.attestInclusionHalf({ wallet: author, half: 'author', publicationUid: uids.publication, postUid: uids.post })
    offerUid = offer.uid
    const a = await onChain(offer.uid)
    expect(a.schema).toBe(INCLUSION_SCHEMA_UID as `0x${string}`)
    expect(a.attester).toBe(author.txSender.address as Address)
    expect(a.recipient.toLowerCase()).toBe(owner.txSender.address.toLowerCase())
    expect(a.refUID).toBe(ZERO_BYTES32 as `0x${string}`)
    expect(a.revocable).toBe(true)
    expect(fields(INCLUSION_SCHEMA_DEF, a.data)).toEqual({ publication: uids.publication, post: uids.post, version: ZERO_BYTES32 })

    const accept = await pairs.attestInclusionHalf({
      wallet: owner,
      half: 'owner',
      publicationUid: uids.publication,
      postUid: uids.post,
      versionUid: uids.v1,
      refUid: offer.uid,
    })
    const o = await onChain(accept.uid)
    expect(o.attester).toBe(owner.txSender.address as Address)
    expect(o.recipient.toLowerCase()).toBe(author.txSender.address.toLowerCase())
    expect(o.refUID.toLowerCase()).toBe(offer.uid)
    expect(fields(INCLUSION_SCHEMA_DEF, o.data).version).toBe(uids.v1)

    const update = await pairs.attestInclusionHalf({
      wallet: owner,
      half: 'owner',
      publicationUid: uids.publication,
      postUid: uids.post,
      versionUid: uids.v2,
      refUid: offer.uid,
    })
    expect(fields(INCLUSION_SCHEMA_DEF, (await onChain(update.uid)).data).version).toBe(uids.v2)
    expect((await onChain(accept.uid)).revocationTime).toBe(0n)
  }, 60_000)

  test('refuses a half nobody could pair, before sending anything', async () => {
    const sent = await Promise.all([owner, author, mallory].map(nonce))
    const base = { publicationUid: uids.publication, postUid: uids.post }
    const offer = offerUid

    // Not the half's attester: the other side, a stranger.
    await expect(pairs.attestInclusionHalf({ ...base, wallet: owner, half: 'author' })).rejects.toThrow(/sends as .* the post seed's attester/)
    await expect(pairs.attestInclusionHalf({ ...base, wallet: mallory, half: 'owner', versionUid: uids.v1 })).rejects.toThrow(
      /publication seed's attester/,
    )
    // A Version by someone else, or no Version at all.
    await expect(pairs.attestInclusionHalf({ ...base, wallet: owner, half: 'owner', versionUid: uids.malloryVersion })).rejects.toThrow(
      /not a Version of post/,
    )
    await expect(pairs.attestInclusionHalf({ ...base, wallet: owner, half: 'owner', versionUid: uids.post })).rejects.toThrow(/not a Version of post/)
    // One attester on both sides.
    await expect(
      pairs.attestInclusionHalf({ wallet: owner, half: 'owner', publicationUid: uids.publication, postUid: uids.ownPost, versionUid: uids.v1 }),
    ).rejects.toThrow(/same attester/)
    // Answering a half from its own side, or a half for another post.
    await expect(pairs.attestInclusionHalf({ ...base, wallet: author, half: 'author', refUid: offer })).rejects.toThrow(/not an Inclusion owner half/)
    await expect(
      pairs.attestInclusionHalf({ wallet: owner, half: 'owner', publicationUid: uids.publication, postUid: uids.post2, versionUid: uids.post2v, refUid: offer }),
    ).rejects.toThrow(/not an Inclusion author half/)
    // An author half naming a Version.
    await expect(pairs.attestInclusionHalf({ ...base, wallet: author, half: 'author', versionUid: uids.v1 } as never)).rejects.toThrow(/names no Version/)

    expect(await Promise.all([owner, author, mallory].map(nonce))).toEqual(sent)
  }, 60_000)

  test('a ManagedAccount answers an ask as the account, through a sponsored UserOp', async () => {
    const signer = fromEthersWallet(new Wallet(keyFor('managed admin'))).signer
    const sender = await createManagedAccountTxSender({ signer, bundlerUrl: stack.bundlerUrl, paymasterUrl: stack.paymasterUrl })
    const managed = { kind: 'modular' as const, signer, txSender: sender } as unknown as Wallet_
    const post = await seed(managed)
    const version = await versionOf(managed, post)

    const ask = await pairs.attestInclusionHalf({ wallet: owner, half: 'owner', publicationUid: uids.publication, postUid: post, versionUid: version })
    expect((await onChain(ask.uid)).recipient.toLowerCase()).toBe(sender.address.toLowerCase())

    const agree = await pairs.attestInclusionHalf({ wallet: managed, half: 'author', publicationUid: uids.publication, postUid: post, refUid: ask.uid })
    const a = await onChain(agree.uid)
    expect(a.attester).toBe(sender.address as Address)
    expect(a.refUID.toLowerCase()).toBe(ask.uid)
    expect(stack.sentUserOps.at(-1)!.paymasterAndData).toBe(stack.paymaster.toLowerCase())
  }, 60_000)

  test('the owner asks a person onto the staff and the person agrees', async () => {
    const base = { publicationUid: uids.publication, identityUid: uids.identity }
    const ask = await pairs.attestStaffHalf({ ...base, wallet: owner, half: 'owner' })
    const o = await onChain(ask.uid)
    expect(o.schema).toBe(STAFF_SCHEMA_UID as `0x${string}`)
    expect(o.refUID).toBe(ZERO_BYTES32 as `0x${string}`)
    expect(o.recipient.toLowerCase()).toBe(person.txSender.address.toLowerCase())
    expect(fields(STAFF_SCHEMA_DEF, o.data)).toEqual({ publication: uids.publication, identity: uids.identity })

    await expect(pairs.attestStaffHalf({ ...base, wallet: person, half: 'person', refUid: offerUid })).rejects.toThrow(
      /not a Staff owner half/,
    )
    await expect(pairs.attestStaffHalf({ ...base, wallet: person, half: 'person' } as never)).rejects.toThrow(/refUid must be/)

    const agree = await pairs.attestStaffHalf({ ...base, wallet: person, half: 'person', refUid: ask.uid })
    const h = await onChain(agree.uid)
    expect(h.attester).toBe(person.txSender.address as Address)
    expect(h.refUID.toLowerCase()).toBe(ask.uid)
    expect(h.recipient.toLowerCase()).toBe(owner.txSender.address.toLowerCase())
  }, 60_000)

  test("only a half's attester revokes it, once", async () => {
    const offer = offerUid
    await expect(pairs.revokeInclusionHalf({ wallet: owner, uid: offer })).rejects.toThrow(/only the half's attester/)
    await expect(pairs.revokeStaffHalf({ wallet: author, uid: offer })).rejects.toThrow(/not a Staff half/)

    await pairs.revokeInclusionHalf({ wallet: author, uid: offer })
    expect((await onChain(offer)).revocationTime).toBeGreaterThan(0n)
    await expect(pairs.revokeInclusionHalf({ wallet: author, uid: offer })).rejects.toThrow(/is revoked/)
  }, 60_000)
})

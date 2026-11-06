import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from 'bun:test'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import {
  buildKeystoreManifest,
  encryptionIdentityFromSecret,
  openKeystoreManifest,
  recoveryKeyFromPhrase,
  recoveryStanza,
  type EncryptionIdentity,
} from '@seedprotocol/encryption'
import { ENCRYPTION_KEY_SCHEMA_DEF, ENCRYPTION_KEY_SCHEMA_UID, bytes32ToArweaveTxId } from '@seedprotocol/eas'
import { JsonRpcProvider, Wallet } from 'ethers'
import { bytesToHex, createPublicClient, http, keccak256, parseAbi, parseEther, toHex, type Address } from 'viem'
import { optimismSepolia } from 'viem/chains'
import { startAaStack, type AaStack } from '../../../test-utils/aaStack/aaStack'

// Registration against the real OP Sepolia SchemaRegistry and EAS predeploys on the replayed fork,
// from an EOA and from a sponsored ManagedAccount. Only Arweave is stood in for: the app's
// signDataItems records the manifest and returns an id, and the existence check is stubbed.
// Keys, identities, the clock and block timestamps are fixed so the fork reads only recorded state:
// an attestation's uid, and so the EAS storage slot it is written to, includes its block's time.

mock.module('../publish/helpers/verifyArweaveTransactionsExist', () => ({
  verifyArweaveTransactionsExist: async () => {},
}))

const { initPublish } = await import('../../config')
const { fromEthersWallet } = await import('../../helpers/seedSigner')
const { createManagedAccountTxSender } = await import('../../helpers/adapters/managedAccountTxSender')
const { EncryptionKeySchemaNotRegisteredError } = await import('../../errors')
const { ensureEncryptionKeySchema, registerEncryptionKey } = await import('./index')

const EAS = '0x4200000000000000000000000000000000000021' as Address
const keyFor = (label: string) => keccak256(toHex(`seed encryption key ${label}`))
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title'

let stack: AaStack & { forkMisses: string[] }
const uploads: { bytes: Uint8Array; tags: { name: string; value: string }[] }[] = []
const signDataItems = async (list: { blob: Blob; tags: { name: string; value: string }[] }[]) =>
  Promise.all(
    list.map(async (u) => {
      uploads.push({ bytes: new Uint8Array(await u.blob.arrayBuffer()), tags: u.tags })
      return { transaction: { id: `${String(uploads.length).padStart(2, '0')}${'K'.repeat(40)}A` } }
    }),
  ) as never

const eoaWallet = (label: string) => fromEthersWallet(new Wallet(keyFor(label), new JsonRpcProvider(stack.rpcUrl, optimismSepolia.id, { staticNetwork: true })))

async function identityFor(label: string): Promise<{ identity: EncryptionIdentity; manifest: Uint8Array }> {
  const identity = await encryptionIdentityFromSecret(new Uint8Array(Buffer.from(keyFor(label).slice(2), 'hex')))
  const manifest = await buildKeystoreManifest(identity, [await recoveryStanza(identity, (await recoveryKeyFromPhrase(PHRASE)).publicKey)])
  return { identity, manifest }
}

const inputFor = ({ identity, manifest }: { identity: EncryptionIdentity; manifest: Uint8Array }) => ({
  keyId: identity.keyId,
  recipientKey: identity.recipient.publicKey,
  tagKey: identity.tagKey.publicKey,
  keystoreManifest: manifest,
})

const ATTESTATION_ABI = parseAbi([
  'function getAttestation(bytes32 uid) view returns ((bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))',
])

/** The two chain reads the tests make, against the fork. */
function chainReads(rpcUrl: string) {
  const client = createPublicClient({ chain: optimismSepolia, transport: http(rpcUrl) })
  return {
    nonce: (address: string) => client.getTransactionCount({ address: address as Address }),
    attestation: (uid: string) => client.readContract({ address: EAS, abi: ATTESTATION_ABI, functionName: 'getAttestation', args: [uid as `0x${string}`] }),
  }
}
let chain: ReturnType<typeof chainReads>

async function attestationOnChain(uid: string) {
  const attestation = await chain.attestation(uid)
  const fields = Object.fromEntries(new SchemaEncoder(ENCRYPTION_KEY_SCHEMA_DEF).decodeData(attestation.data).map((f) => [f.name, f.value.value]))
  return { attestation, fields }
}

beforeAll(async () => {
  setSystemTime(new Date('2026-11-06T00:00:00Z'))
  stack = await startAaStack()
  initPublish({ chain: optimismSepolia, rpcUrl: stack.rpcUrl, uploadApiBaseUrl: 'http://127.0.0.1:9' })
  chain = chainReads(stack.rpcUrl)
  const rpc = (method: string, params: unknown[]) =>
    fetch(stack.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  // Later than any block the stack mined at wall-clock time, then one second per block.
  await rpc('evm_setNextBlockTimestamp', [Date.parse('2030-01-01T00:00:00Z') / 1000])
  await rpc('anvil_setBlockTimestampInterval', [1])
  for (const label of ['owner', 'eoa user']) await stack.setBalance(eoaWallet(label).txSender.address as Address, parseEther('1'))
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

describe('encryption key registration on OP Sepolia', () => {
  test('refuses before uploading while the schema is missing, then the owner registers it once', async () => {
    const user = eoaWallet('eoa user')
    const keys = await identityFor('eoa identity')
    await expect(
      registerEncryptionKey(inputFor(keys), { account: user.txSender.address, wallet: user, signDataItems }),
    ).rejects.toBeInstanceOf(EncryptionKeySchemaNotRegisteredError)
    expect(uploads).toHaveLength(0)

    const owner = eoaWallet('owner')
    expect(await ensureEncryptionKeySchema(owner)).toBe(ENCRYPTION_KEY_SCHEMA_UID)
    const nonce = await chain.nonce(owner.txSender.address)
    await ensureEncryptionKeySchema(owner)
    expect(await chain.nonce(owner.txSender.address)).toBe(nonce)
  }, 60_000)

  test('an EOA attests its key and manifest directly', async () => {
    const user = eoaWallet('eoa user')
    const keys = await identityFor('eoa identity')
    const result = await registerEncryptionKey(inputFor(keys), { account: user.txSender.address, wallet: user, signDataItems })

    expect(result.attester).toBe(user.txSender.address)
    const upload = uploads.at(-1)!
    expect(upload.bytes).toEqual(keys.manifest)
    expect(upload.tags).toContainEqual({ name: 'Seed-Encryption', value: 'seed-private/v1' })
    expect(upload.tags).toContainEqual({ name: 'Content-Type', value: 'application/octet-stream' })

    const { attestation, fields } = await attestationOnChain(result.uid)
    expect(attestation.schema).toBe(ENCRYPTION_KEY_SCHEMA_UID)
    expect(attestation.attester).toBe(user.txSender.address as Address)
    expect(attestation.revocable).toBe(true)
    expect(fields.key_id).toBe(keys.identity.keyId)
    expect(fields.suite).toBe('seed-private/v1')
    expect(fields.recipient_key).toBe(bytesToHex(keys.identity.recipient.publicKey))
    expect(fields.tag_key).toBe(bytesToHex(keys.identity.tagKey.publicKey))
    expect(bytes32ToArweaveTxId(fields.keystore_tx as string)).toBe(result.keystoreTx)

    // What a reader on another device does with the registration: open the manifest it names.
    const opened = await openKeystoreManifest(uploads.at(-1)!.bytes, { recoveryPhrase: PHRASE }, { expectKeyId: fields.key_id as string })
    expect(opened.keyId).toBe(keys.identity.keyId)
  }, 60_000)

  test('a ManagedAccount attests through a sponsored UserOp, as the account', async () => {
    const sender = await createManagedAccountTxSender({
      signer: fromEthersWallet(new Wallet(keyFor('managed admin'))).signer,
      bundlerUrl: stack.bundlerUrl,
      paymasterUrl: stack.paymasterUrl,
    })
    const wallet = { kind: 'modular' as const, signer: fromEthersWallet(new Wallet(keyFor('managed admin'))).signer, txSender: sender }
    const keys = await identityFor('managed identity')

    const result = await registerEncryptionKey(inputFor(keys), { account: sender.address, wallet, signDataItems })

    const { attestation, fields } = await attestationOnChain(result.uid)
    expect(attestation.attester).toBe(sender.address as Address)
    expect(fields.key_id).toBe(keys.identity.keyId)
    expect(stack.sentUserOps.at(-1)!.paymasterAndData).toBe(stack.paymaster.toLowerCase())
  }, 60_000)

  test("refuses a wallet that sends as someone other than the account, such as a session key", async () => {
    const sessionKey = eoaWallet('session key')
    const before = uploads.length
    await expect(
      registerEncryptionKey(inputFor(await identityFor('eoa identity')), { account: eoaWallet('eoa user').txSender.address, wallet: sessionKey, signDataItems }),
    ).rejects.toThrow(/never by a session key/)
    expect(uploads).toHaveLength(before)
  })

  test("refuses a key id that isn't the keys' or the manifest's", async () => {
    const user = eoaWallet('eoa user')
    const keys = await identityFor('eoa identity')
    const other = await identityFor('managed identity')
    const opts = { account: user.txSender.address, wallet: user, signDataItems }
    await expect(registerEncryptionKey({ ...inputFor(keys), tagKey: other.identity.tagKey.publicKey }, opts)).rejects.toThrow(/not the id of these public keys/)
    await expect(registerEncryptionKey({ ...inputFor(keys), keystoreManifest: other.manifest }, opts)).rejects.toThrow(/not a keystore manifest for/)
  })
})

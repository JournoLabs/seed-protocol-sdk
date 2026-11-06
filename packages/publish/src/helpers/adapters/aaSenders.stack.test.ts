import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import { Wallet } from 'ethers'
import { createPublicClient, http, keccak256, parseEther, toHex, type Address } from 'viem'
import { entryPoint06Address, entryPoint08Address } from 'viem/account-abstraction'
import { optimismSepolia } from 'viem/chains'
import { startAaStack, type AaStack } from '../../../test-utils/aaStack/aaStack'
import { initPublish } from '../../config'
import { fromEthersWallet } from '../seedSigner'
import { createManagedAccountTxSender } from './managedAccountTxSender'
import { createPermissionlessTxSender } from './permissionlessTxSender'
import { CALL_GAS_HEADROOM_BPS } from './userOps'

// Both senders against the real OP Sepolia contracts (ManagedAccount factory, EntryPoint v0.6 and
// v0.8, Simple7702Account) on a replayed fork, with Alto and an accept-all ERC-7677 paymaster.
// Keys are fixed, and so is the clock: viem takes each UserOp's nonce key from Date.now(), and a
// new key reads a new EntryPoint storage slot, which the recorded fork wouldn't have.

const SIMPLE_7702_ACCOUNT = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const TARGET = '0x000000000000000000000000000000000000bEEF' as Address
const keyFor = (label: string) => keccak256(toHex(`seed aa stack ${label}`))
const signerFor = (label: string) => fromEthersWallet(new Wallet(keyFor(label))).signer

let stack: AaStack & { forkMisses: string[] }
let readCode: (address: Address) => Promise<string | undefined>

beforeAll(async () => {
  setSystemTime(new Date('2026-11-06T00:00:00Z'))
  stack = await startAaStack()
  initPublish({ chain: optimismSepolia, rpcUrl: stack.rpcUrl, uploadApiBaseUrl: 'http://127.0.0.1:9' })
  const client = createPublicClient({ chain: optimismSepolia, transport: http(stack.rpcUrl) })
  readCode = (address) => client.getCode({ address })
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

const paymasterCallsFor = (entryPoint: Address) =>
  stack.paymasterCalls.filter((c) => c.entryPoint.toLowerCase() === entryPoint.toLowerCase()).length

describe('createManagedAccountTxSender on the canonical EntryPoint v0.6', () => {
  test('a sponsored first UserOp deploys the account with call-gas headroom', async () => {
    const sender = await createManagedAccountTxSender({
      signer: signerFor('managed sponsored'),
      bundlerUrl: stack.bundlerUrl,
      paymasterUrl: stack.paymasterUrl,
    })
    expect(await readCode(sender.address)).toBeUndefined()
    const paymasterCallsBefore = paymasterCallsFor(entryPoint06Address)

    const { transactionHash } = await sender.sendTransaction({ to: TARGET, data: '0x1234' })

    expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(await readCode(sender.address)).toBeTruthy()
    expect(paymasterCallsFor(entryPoint06Address)).toBeGreaterThan(paymasterCallsBefore)
    const sent = stack.sentUserOps.at(-1)!
    expect(sent.paymasterAndData).toBe(stack.paymaster.toLowerCase())
    const estimate = BigInt(stack.gasEstimates.at(-1)!.callGasLimit as string)
    expect(BigInt(sent.callGasLimit as string)).toBeGreaterThanOrEqual((estimate * CALL_GAS_HEADROOM_BPS) / 10_000n)
  }, 60_000)

  test('unsponsored, the account pays its own gas', async () => {
    const sender = await createManagedAccountTxSender({
      signer: signerFor('managed unsponsored'),
      bundlerUrl: stack.bundlerUrl,
      sponsored: false,
    })
    await stack.setBalance(sender.address, parseEther('1'))

    await sender.sendTransaction({ to: TARGET, data: '0x' })

    expect(await readCode(sender.address)).toBeTruthy()
    expect(stack.sentUserOps.at(-1)!.paymasterAndData).toBe('0x')
  }, 60_000)
})

describe('createPermissionlessTxSender on the canonical EntryPoint v0.8', () => {
  test('a sponsored first send delegates the EOA, and the next send needs no authorization', async () => {
    const signer = signerFor('7702 sponsored')
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl: stack.bundlerUrl,
      paymasterUrl: stack.paymasterUrl,
    })
    expect(sender.address).toBe(signer.address)
    expect(await readCode(signer.address)).toBeUndefined()

    await sender.sendTransaction({ to: TARGET, data: '0x' })

    expect(await readCode(signer.address)).toBe(`0xef0100${SIMPLE_7702_ACCOUNT.slice(2).toLowerCase()}`)
    expect(stack.sentUserOps.at(-1)!.eip7702Auth).toBeTruthy()
    expect(paymasterCallsFor(entryPoint08Address)).toBeGreaterThan(0)

    await sender.sendTransaction({ to: TARGET, data: '0x' })
    expect(stack.sentUserOps.at(-1)!.eip7702Auth ?? null).toBeNull()
  }, 60_000)

  test('unsponsored, the EOA pays its own gas', async () => {
    const signer = signerFor('7702 unsponsored')
    await stack.setBalance(signer.address, parseEther('1'))
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl: stack.bundlerUrl,
      sponsored: false,
    })

    await sender.sendTransaction({ to: TARGET, data: '0x' })

    expect(await readCode(signer.address)).toBe(`0xef0100${SIMPLE_7702_ACCOUNT.slice(2).toLowerCase()}`)
    expect(stack.sentUserOps.at(-1)!.paymaster ?? null).toBeNull()
  }, 60_000)
})

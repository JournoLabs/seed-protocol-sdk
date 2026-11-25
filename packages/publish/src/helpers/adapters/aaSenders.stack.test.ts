import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import { Wallet } from 'ethers'
import { createPublicClient, http, keccak256, parseEther, parseEventLogs, toHex, zeroAddress, type Address, type Hex } from 'viem'
import { entryPoint08Abi } from 'viem/account-abstraction'
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
let client: ReturnType<typeof createPublicClient>

beforeAll(async () => {
  setSystemTime(new Date('2026-11-06T00:00:00Z'))
  stack = await startAaStack()
  initPublish({ chain: optimismSepolia, rpcUrl: stack.rpcUrl, uploadApiBaseUrl: 'http://127.0.0.1:9' })
  client = createPublicClient({ chain: optimismSepolia, transport: http(stack.rpcUrl) })
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

  // The fallback tests reuse the signers above: the recorded fork holds only their state.
  const userOpPaymaster = async (rpc: ReturnType<typeof createPublicClient>, transactionHash: Hex) => {
    const receipt = await rpc.getTransactionReceipt({ hash: transactionHash })
    const [event] = parseEventLogs({ abi: entryPoint08Abi, eventName: 'UserOperationEvent', logs: receipt.logs })
    return event!.args.paymaster
  }

  test('sponsored when funded: the paymaster pays and the EOA keeps its ETH', async () => {
    const signer = signerFor('7702 sponsored')
    let asked = 0
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl: stack.bundlerUrl,
      paymasterUrl: stack.paymasterUrl,
      onSponsorDeclined: async () => (asked++, true),
    })
    const before = await client.getBalance({ address: signer.address as Address })

    const { transactionHash } = await sender.sendTransaction({ to: TARGET, data: '0x' })

    expect((await userOpPaymaster(client, transactionHash)).toLowerCase()).toBe(stack.paymaster.toLowerCase())
    expect(await client.getBalance({ address: signer.address as Address })).toBe(before)
    expect(asked).toBe(0)
  }, 60_000)

  test('self-pays when the service declines', async () => {
    const signer = signerFor('7702 unsponsored')
    await stack.setBalance(signer.address as Address, parseEther('1'))
    const reasons: string[] = []
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl: stack.bundlerUrl,
      paymasterUrl: stack.paymasterUrl,
      onSponsorDeclined: async ({ reason }) => (reasons.push(reason), true),
    })
    stack.setPaymasterMode('decline')
    try {
      const { transactionHash } = await sender.sendTransaction({ to: TARGET, data: '0x' })

      expect(reasons).toEqual(['declined'])
      expect(await userOpPaymaster(client, transactionHash)).toBe(zeroAddress)
      expect(await client.getBalance({ address: signer.address as Address })).toBeLessThan(parseEther('1'))
    } finally {
      stack.setPaymasterMode('sponsor')
    }
  }, 60_000)

  test('self-pays when the paymaster has no deposit', async () => {
    // A stack of its own: the paymaster's EntryPoint deposit is never funded.
    const broke = await startAaStack({ paymasterDepositWei: 0n })
    try {
      initPublish({ chain: optimismSepolia, rpcUrl: broke.rpcUrl, uploadApiBaseUrl: 'http://127.0.0.1:9' })
      const rpc = createPublicClient({ chain: optimismSepolia, transport: http(broke.rpcUrl) })
      const signer = signerFor('7702 unsponsored')
      await broke.setBalance(signer.address as Address, parseEther('1'))
      const reasons: string[] = []
      const sender = await createPermissionlessTxSender({
        signer,
        bundlerUrl: broke.bundlerUrl,
        paymasterUrl: broke.paymasterUrl,
        onSponsorDeclined: async ({ reason }) => (reasons.push(reason), true),
      })

      const { transactionHash } = await sender.sendTransaction({ to: TARGET, data: '0x' })

      expect(reasons).toEqual(['deposit_low'])
      expect(await userOpPaymaster(rpc, transactionHash)).toBe(zeroAddress)
      expect(await rpc.getBalance({ address: signer.address as Address })).toBeLessThan(parseEther('1'))
      expect(broke.forkMisses).toEqual([])
    } finally {
      initPublish({ chain: optimismSepolia, rpcUrl: stack.rpcUrl, uploadApiBaseUrl: 'http://127.0.0.1:9' })
      await broke.stop()
    }
  }, 180_000)
})

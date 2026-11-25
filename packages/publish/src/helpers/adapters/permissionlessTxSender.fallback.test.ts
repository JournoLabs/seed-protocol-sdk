import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Wallet } from 'ethers'
import { keccak256, toHex } from 'viem'
import { entryPoint08Address } from 'viem/account-abstraction'
import { optimismSepolia } from 'viem/chains'
import { initPublish } from '../../config'
import { PublishGasError } from '../../errors'
import type { SelfPayRequest } from '../../payment'
import { pinnedNonce } from '../pinnedNonce'
import { fromEthersWallet } from '../seedSigner'
import { createPermissionlessTxSender } from './permissionlessTxSender'

// A fake chain RPC + bundler and a separate fake ERC-7677 paymaster. The paymaster either
// sponsors or answers with a JSON-RPC error (a decline); the bundler can reject a sponsored op
// with AA31, a self-paid one with AA21, or fail the receipt lookup after accepting the op.

const SIMPLE_7702_ACCOUNT = '0xe6cae83bde06e4c305530e199d7217f42808555b'
const PAYMASTER = `0x${'9'.repeat(40)}`
const HASH = `0x${'c'.repeat(64)}`

type Op = Record<string, string>
let sent: Op[] = []
let paymasterCalls = 0
let behaviour: {
  paymaster: 'sponsor' | 'decline'
  sponsoredSend: 'ok' | 'AA31'
  selfPaidSend: 'ok' | 'AA21'
  receipt: 'ok' | 'error'
  /** The EOA's current delegate. */
  delegate: string
}

const rpcError = (id: number, message: string, code = -32500) =>
  Response.json({ jsonrpc: '2.0', id, error: { code, message } })

const chainAndBundler = Bun.serve({
  port: 0,
  async fetch(req) {
    const { id, method, params } = (await req.json()) as { id: number; method: string; params: unknown[] }
    const ok = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result })
    switch (method) {
      case 'eth_chainId':
        return ok(toHex(optimismSepolia.id))
      case 'eth_supportedEntryPoints':
        return ok([entryPoint08Address])
      case 'eth_getCode':
        // Delegated (to Simple7702Account unless a test says otherwise), so sends carry no authorization.
        return ok(`0xef0100${behaviour.delegate.slice(2)}`)
      case 'eth_getBlockByNumber':
        return ok({ number: '0x10', baseFeePerGas: '0x1', timestamp: '0x1', transactions: [] })
      case 'eth_maxPriorityFeePerGas':
      case 'eth_gasPrice':
        return ok('0x1')
      case 'eth_call': {
        // EntryPoint.getNonce(sender, key): sequence 0 under the key asked for.
        const data = (params as Array<{ data?: string; input?: string }>)[0]!
        const key = BigInt(`0x${(data.data ?? data.input)!.slice(10 + 64, 10 + 128)}`)
        return ok(toHex(key << 64n, { size: 32 }))
      }
      case 'eth_estimateUserOperationGas':
        return ok({ callGasLimit: '0x10000', verificationGasLimit: '0x10000', preVerificationGas: '0x10000' })
      case 'eth_sendUserOperation': {
        const op = (params as Op[])[0]!
        sent.push(op)
        if (op.paymaster && behaviour.sponsoredSend === 'AA31') return rpcError(id, 'AA31 paymaster deposit too low')
        if (!op.paymaster && behaviour.selfPaidSend === 'AA21') return rpcError(id, "AA21 didn't pay prefund")
        return ok(HASH)
      }
      case 'eth_getUserOperationReceipt':
        if (behaviour.receipt === 'error') return rpcError(id, 'receipt lookup failed', -32603)
        return ok({
          userOpHash: HASH,
          sender: sent.at(-1)!.sender,
          nonce: sent.at(-1)!.nonce,
          success: true,
          actualGasCost: '0x1',
          actualGasUsed: '0x1',
          entryPoint: entryPoint08Address,
          logs: [],
          receipt: { transactionHash: HASH, blockHash: HASH, blockNumber: '0x10', logs: [], status: '0x1' },
        })
      default:
        return rpcError(id, `no ${method}`, -32601)
    }
  },
})

const paymasterServer = Bun.serve({
  port: 0,
  async fetch(req) {
    const { id } = (await req.json()) as { id: number }
    paymasterCalls++
    if (behaviour.paymaster === 'decline') return rpcError(id, 'sponsorship declined', -32000)
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        paymaster: PAYMASTER,
        paymasterData: '0x',
        paymasterVerificationGasLimit: '0x10000',
        paymasterPostOpGasLimit: '0x10000',
        isFinal: true,
      },
    })
  },
})

const bundlerUrl = `http://127.0.0.1:${chainAndBundler.port}`
const paymasterUrl = `http://127.0.0.1:${paymasterServer.port}`
const signer = fromEthersWallet(new Wallet(keccak256(toHex('seed sponsor fallback sender')))).signer
const key = 0x5eedn
const tx = { to: `0x${'1'.repeat(40)}` as const, data: '0x' as const, nonceKey: key }

beforeAll(() => {
  initPublish({ chain: optimismSepolia, rpcUrl: bundlerUrl, uploadApiBaseUrl: 'http://127.0.0.1:9' })
})
beforeEach(() => {
  sent = []
  paymasterCalls = 0
  behaviour = { paymaster: 'sponsor', sponsoredSend: 'ok', selfPaidSend: 'ok', receipt: 'ok', delegate: SIMPLE_7702_ACCOUNT }
})
afterAll(() => {
  chainAndBundler.stop(true)
  paymasterServer.stop(true)
})

const gasError = async (promise: Promise<unknown>): Promise<PublishGasError> => {
  const err = await promise.then(
    () => {
      throw new Error('expected the send to fail')
    },
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(PublishGasError)
  return err as PublishGasError
}

describe('createPermissionlessTxSender when the sponsor declines', () => {
  test('sends sponsored when the paymaster agrees', async () => {
    const asked: SelfPayRequest[] = []
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async (r) => (asked.push(r), true),
    })
    await sender.sendTransaction(tx)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.paymaster?.toLowerCase()).toBe(PAYMASTER)
    expect(asked).toEqual([])
  })

  test('self-pays when the paymaster answers an error', async () => {
    behaviour.paymaster = 'decline'
    const asked: SelfPayRequest[] = []
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async (r) => (asked.push(r), true),
    })
    const { transactionHash } = await sender.sendTransaction(tx)
    expect(transactionHash).toBe(HASH)
    expect(asked).toEqual([{ reason: 'declined', address: signer.address }])
    // The declined op never reached the bundler; the resend is the only send.
    expect(sent).toHaveLength(1)
    expect(sent[0]!.paymaster).toBeUndefined()
    expect(BigInt(sent[0]!.nonce!)).toBe(pinnedNonce(key))
  })

  test('self-pays on AA31', async () => {
    behaviour.sponsoredSend = 'AA31'
    const asked: SelfPayRequest[] = []
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async (r) => (asked.push(r), true),
    })
    await sender.sendTransaction(tx)
    expect(asked).toEqual([{ reason: 'deposit_low', address: signer.address }])
    expect(sent).toHaveLength(2)
    expect(sent[0]!.paymaster?.toLowerCase()).toBe(PAYMASTER)
    expect(sent[1]!.paymaster).toBeUndefined()
    expect(sent[1]!.nonce).toBe(sent[0]!.nonce)
    expect(BigInt(sent[1]!.nonce!)).toBe(pinnedNonce(key))
  })

  test("without a nonceKey the resend keeps the declined op's nonce", async () => {
    behaviour.sponsoredSend = 'AA31'
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async () => true,
    })
    await sender.sendTransaction({ to: tx.to, data: tx.data })
    expect(sent).toHaveLength(2)
    expect(sent[1]!.nonce).toBe(sent[0]!.nonce)
  })

  test('refuses when confirm says no', async () => {
    behaviour.sponsoredSend = 'AA31'
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async () => false,
    })
    const err = await gasError(sender.sendTransaction(tx))
    expect(err.code).toBe('SELF_PAY_REFUSED')
    expect(err.address).toBe(signer.address)
    expect(sent).toHaveLength(1)
  })

  test('a throwing confirmSelfPay refuses', async () => {
    behaviour.sponsoredSend = 'AA31'
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async () => {
        throw new Error('dialog closed')
      },
    })
    const err = await gasError(sender.sendTransaction(tx))
    expect(err.code).toBe('SELF_PAY_REFUSED')
    expect(sent).toHaveLength(1)
  })

  test('no fallback without onSponsorDeclined', async () => {
    behaviour.paymaster = 'decline'
    const sender = await createPermissionlessTxSender({ signer, bundlerUrl, paymasterUrl })
    const err = await gasError(sender.sendTransaction(tx))
    expect(err.code).toBe('SPONSOR_DECLINED')
    expect(sent).toHaveLength(0)
  })

  test('unreachable paymaster never falls back', async () => {
    const down = Bun.serve({ port: 0, fetch: () => new Response('') })
    const downUrl = `http://127.0.0.1:${down.port}`
    down.stop(true)
    let asked = 0
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl: downUrl,
      onSponsorDeclined: async () => (asked++, true),
    })
    const err = await gasError(sender.sendTransaction(tx))
    expect(err.code).toBe('SPONSOR_UNREACHABLE')
    expect(asked).toBe(0)
    expect(sent).toHaveLength(0)
  })

  test('a paymaster answering 5xx is unreachable, not a decline', async () => {
    const broken = Bun.serve({ port: 0, fetch: () => new Response('bad gateway', { status: 502 }) })
    try {
      let asked = 0
      const sender = await createPermissionlessTxSender({
        signer,
        bundlerUrl,
        paymasterUrl: `http://127.0.0.1:${broken.port}`,
        onSponsorDeclined: async () => (asked++, true),
      })
      const err = await gasError(sender.sendTransaction(tx))
      expect(err.code).toBe('SPONSOR_UNREACHABLE')
      expect(asked).toBe(0)
    } finally {
      broken.stop(true)
    }
  })

  test.each([
    ['a 503 carrying a JSON-RPC internal error', 503, -32603],
    ['rate limiting', 429, -32005],
    ['a URL that is not a paymaster (method not found)', 200, -32601],
  ])('%s is unreachable, not a decline', async (_name, status, code) => {
    const broken = Bun.serve({
      port: 0,
      async fetch(req) {
        const { id } = (await req.json()) as { id: number }
        return Response.json({ jsonrpc: '2.0', id, error: { code, message: 'down' } }, { status })
      },
    })
    try {
      let asked = 0
      const sender = await createPermissionlessTxSender({
        signer,
        bundlerUrl,
        paymasterUrl: `http://127.0.0.1:${broken.port}`,
        onSponsorDeclined: async () => (asked++, true),
      })
      const err = await gasError(sender.sendTransaction(tx))
      expect(err.code).toBe('SPONSOR_UNREACHABLE')
      expect(asked).toBe(0)
      expect(sent).toHaveLength(0)
    } finally {
      broken.stop(true)
    }
  }, 30_000)

  test('a confirm callback that throws synchronously refuses', async () => {
    behaviour.sponsoredSend = 'AA31'
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: (() => {
        throw new Error('not async')
      }) as never,
    })
    const err = await gasError(sender.sendTransaction(tx))
    expect(err.code).toBe('SELF_PAY_REFUSED')
  })

  test('AA21 on the self-paid send', async () => {
    behaviour.paymaster = 'decline'
    behaviour.selfPaidSend = 'AA21'
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async () => true,
    })
    const err = await gasError(sender.sendTransaction(tx))
    expect(err.code).toBe('SELF_PAY_INSUFFICIENT_FUNDS')
    expect(sent).toHaveLength(1)
  })

  test('does not fall back after the bundler accepted the UserOp', async () => {
    behaviour.receipt = 'error'
    let asked = 0
    const sender = await createPermissionlessTxSender({
      signer,
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async () => (asked++, true),
    })
    const err = await sender.sendTransaction(tx).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PublishGasError)
    expect(String((err as Error).message)).toMatch(/receipt lookup failed/)
    expect(asked).toBe(0)
    expect(sent).toHaveLength(1)
  })

  test('an EOA delegated to a wallet vendor is refused, never re-delegated, even with self-pay on', async () => {
    const vendor = `0x${'b'.repeat(40)}`
    behaviour.delegate = vendor
    behaviour.paymaster = 'decline'
    let asked = 0
    let authorizations = 0
    const sender = await createPermissionlessTxSender({
      signer: {
        ...signer,
        signAuthorization: async (args) => {
          authorizations++
          return signer.signAuthorization!(args)
        },
      },
      bundlerUrl,
      paymasterUrl,
      onSponsorDeclined: async () => (asked++, true),
    })
    const err = await sender.sendTransaction(tx).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'EIP7702_DELEGATED_ELSEWHERE' })
    expect((err as Error).message).toContain(vendor)
    expect(authorizations).toBe(0)
    expect(asked).toBe(0)
    expect(paymasterCalls).toBe(0)
    expect(sent).toHaveLength(0)
  })
})

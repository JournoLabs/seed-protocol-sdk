import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Wallet } from 'ethers'
import { keccak256, toHex } from 'viem'
import { entryPoint08Address } from 'viem/account-abstraction'
import { optimismSepolia } from 'viem/chains'
import { initPublish } from '../../config'
import { pinnedNonce } from '../pinnedNonce'
import { fromEthersWallet } from '../seedSigner'
import { createPermissionlessTxSender } from './permissionlessTxSender'

// Batch 17 item 5 (D60): the key a publish passes has to reach the UserOp's nonce, or a retry
// under the same host key could land a second time. A fake chain RPC and bundler record the UserOp.

const SIMPLE_7702_ACCOUNT = '0xe6cae83bde06e4c305530e199d7217f42808555b'
const HASH = `0x${'c'.repeat(64)}`
const sent: Array<Record<string, string>> = []
const estimated: Array<Record<string, string>> = []

const answers: Record<string, (params: unknown[]) => unknown> = {
  eth_chainId: () => toHex(optimismSepolia.id),
  eth_supportedEntryPoints: () => [entryPoint08Address],
  // Already delegated, so the send carries no authorization.
  eth_getCode: () => `0xef0100${SIMPLE_7702_ACCOUNT.slice(2)}`,
  eth_getBlockByNumber: () => ({ number: '0x10', baseFeePerGas: '0x1', timestamp: '0x1', transactions: [] }),
  eth_maxPriorityFeePerGas: () => '0x1',
  eth_gasPrice: () => '0x1',
  eth_estimateUserOperationGas: ([op]) => {
    estimated.push(op as Record<string, string>)
    return { callGasLimit: '0x10000', verificationGasLimit: '0x10000', preVerificationGas: '0x10000' }
  },
  eth_sendUserOperation: ([op]) => {
    sent.push(op as Record<string, string>)
    return HASH
  },
  eth_getUserOperationReceipt: () => ({
    userOpHash: HASH,
    sender: (sent.at(-1) ?? {}).sender,
    nonce: (sent.at(-1) ?? {}).nonce,
    success: true,
    actualGasCost: '0x1',
    actualGasUsed: '0x1',
    entryPoint: entryPoint08Address,
    logs: [],
    receipt: { transactionHash: HASH, blockHash: HASH, blockNumber: '0x10', logs: [], status: '0x1' },
  }),
}

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as { id: number; method: string; params: unknown[] }
    const answer = answers[body.method]
    if (!answer) return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `no ${body.method}` } })
    return Response.json({ jsonrpc: '2.0', id: body.id, result: answer(body.params) })
  },
})
const url = `http://127.0.0.1:${server.port}`

beforeAll(() => {
  initPublish({ chain: optimismSepolia, rpcUrl: url, uploadApiBaseUrl: 'http://127.0.0.1:9' })
})
afterAll(() => {
  server.stop(true)
})

describe('createPermissionlessTxSender and a nonce key', () => {
  test('sends the UserOp under the key it is given, at sequence 0', async () => {
    const signer = fromEthersWallet(new Wallet(keccak256(toHex('seed nonce key sender')))).signer
    const sender = await createPermissionlessTxSender({ signer, bundlerUrl: url, sponsored: false })
    expect(sender.pinsNonceOn).toBe(entryPoint08Address)

    const key = 0x1234n
    await sender.sendTransaction({ to: `0x${'1'.repeat(40)}`, data: '0x', nonceKey: key })

    expect(sent).toHaveLength(1)
    expect(BigInt(sent[0]!.nonce!)).toBe(pinnedNonce(key))
    expect(BigInt(estimated.at(-1)!.nonce!)).toBe(pinnedNonce(key))
  })
})

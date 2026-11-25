import { afterAll, describe, expect, test } from 'bun:test'
import { entryPoint06Address, entryPoint08Address } from 'viem/account-abstraction'
import { encodeErrorResult, recoverAddress, type Address, type Hex } from 'viem'
import { hashAuthorization } from 'viem/utils'
import { Wallet } from 'ethers'
import { fromEthersWallet } from '../seedSigner'
import { seedErrorsAbi } from '../abi/seedErrors'
import { assertBundlerSupportsEntryPoint08, authorizationForUserOp } from './permissionlessTxSender'
import { assertUserOpSucceeded } from './userOps'
import { isEip7702ModularAccountPublishError } from '../../errors'

let entryPoints: unknown = []
const server = Bun.serve({
  port: 0,
  fetch: () => Response.json({ jsonrpc: '2.0', id: 1, result: entryPoints }),
})
const url = `http://127.0.0.1:${server.port}`

afterAll(() => {
  server.stop(true)
})

describe('assertBundlerSupportsEntryPoint08', () => {
  test('rejects a v0.6-only bundler and points at thirdweb.bundlerUrl', async () => {
    entryPoints = [entryPoint06Address]
    await expect(assertBundlerSupportsEntryPoint08(url)).rejects.toThrow(/thirdweb\.bundlerUrl/)
  })

  test('accepts a bundler that lists v0.8', async () => {
    entryPoints = [entryPoint06Address, entryPoint08Address.toLowerCase()]
    await expect(assertBundlerSupportsEntryPoint08(url)).resolves.toBeUndefined()
  })

  test('lets through a bundler that does not answer eth_supportedEntryPoints', async () => {
    entryPoints = undefined
    await expect(assertBundlerSupportsEntryPoint08(url)).resolves.toBeUndefined()
    await expect(assertBundlerSupportsEntryPoint08('http://127.0.0.1:1')).resolves.toBeUndefined()
  })
})

describe('authorizationForUserOp', () => {
  const delegate = '0xe6Cae83BdE06E4c305530e199D7217f42808555B' as Address
  const previous = '0x00000000000000000000000000000000000000aa' as Address
  const vendor = '0x00000000000000000000000000000000000000bb' as Address
  const wallet = Wallet.createRandom() as unknown as Wallet
  const { signer } = fromEthersWallet(wallet)
  let signed = 0
  const countingSigner = {
    ...signer,
    signAuthorization: async (args: Parameters<NonNullable<typeof signer.signAuthorization>>[0]) => {
      signed++
      return signer.signAuthorization!(args)
    },
  }
  const params = { signer: countingSigner, delegate, chainId: 11155420, getNonce: async () => 7, movableFrom: [] as Address[] }
  const on = (current: Address | undefined) => async () => current

  test('signs when undelegated', async () => {
    const auth = await authorizationForUserOp({ ...params, currentDelegate: on(undefined) })
    expect(auth).toMatchObject({ address: delegate, chainId: 11155420, nonce: 7 })
    const recovered = await recoverAddress({
      hash: hashAuthorization({ address: delegate, chainId: 11155420, nonce: 7 }),
      signature: { r: auth!.r as Hex, s: auth!.s as Hex, yParity: auth!.yParity! },
    })
    expect(recovered).toBe(wallet.address as Address)
  })

  test('no authorization when already on the delegate', async () => {
    expect(await authorizationForUserOp({ ...params, currentDelegate: on(delegate) })).toBeUndefined()
    // getCode answers in lower case
    expect(
      await authorizationForUserOp({ ...params, currentDelegate: on(delegate.toLowerCase() as Address) }),
    ).toBeUndefined()
  })

  test('signs a move from a movable delegate', async () => {
    const auth = await authorizationForUserOp({ ...params, movableFrom: [previous], currentDelegate: on(previous) })
    expect(auth).toMatchObject({ address: delegate, nonce: 7 })
  })

  test('throws EIP7702_DELEGATED_ELSEWHERE for any other delegate', async () => {
    signed = 0
    const err = await authorizationForUserOp({ ...params, movableFrom: [previous], currentDelegate: on(vendor) }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ name: 'Eip7702ModularAccountPublishError', code: 'EIP7702_DELEGATED_ELSEWHERE' })
    expect(isEip7702ModularAccountPublishError(err)).toBe(true)
    expect((err as Error).message).toContain(vendor)
    expect(signed).toBe(0)
  })

  test("stays on a movable delegate when the signer can't authorize the move", async () => {
    const browserSigner = { address: wallet.address as Address, signMessage: signer.signMessage }
    expect(
      await authorizationForUserOp({ ...params, signer: browserSigner, movableFrom: [previous], currentDelegate: on(previous) }),
    ).toBeUndefined()
  })

  test('explains a signer that cannot authorize, such as a browser wallet', async () => {
    const browserSigner = { address: wallet.address as Address, signMessage: signer.signMessage }
    await expect(
      authorizationForUserOp({ ...params, signer: browserSigner, currentDelegate: on(undefined) }),
    ).rejects.toThrow(/no signAuthorization/)
  })
})

describe('assertUserOpSucceeded', () => {
  const transactionHash = `0x${'cd'.repeat(32)}` as const

  test('returns the transaction hash of a successful UserOp', () => {
    expect(assertUserOpSucceeded({ success: true, receipt: { transactionHash } })).toBe(transactionHash)
  })

  test('throws for a failed UserOp even though the bundle transaction succeeded', () => {
    expect(() => assertUserOpSucceeded({ success: false, receipt: { transactionHash } })).toThrow(
      expect.objectContaining({
        code: 'USEROP_FAILED_NO_REASON',
        message: expect.stringContaining('ran out of gas'),
      }),
    )
  })

  test('decodes the revert reason', () => {
    const reason = encodeErrorResult({
      abi: seedErrorsAbi,
      errorName: 'Unauthorized',
      args: ['0x1111111111111111111111111111111111111111'],
    })
    expect(() => assertUserOpSucceeded({ success: false, reason, receipt: { transactionHash } })).toThrow(
      expect.objectContaining({
        code: 'USEROP_REVERTED',
        message: expect.stringMatching(/reverted with Unauthorized\(0x1111/),
      }),
    )
  })
})

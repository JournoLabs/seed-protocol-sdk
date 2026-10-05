import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { estimateUserOpGas, getPaymasterAndData, type UserOperation } from 'thirdweb/wallets/smart'
import { gasFields, logGas } from './gasLog'

/**
 * Headroom on the bundler's callGasLimit, in basis points (1.2x). The bundler's estimate tracks
 * gas used, but the call needs more than that while it runs: refunds are only credited when the
 * transaction ends, and each nested call (EntryPoint → account → executor → EAS) holds back 1/64.
 * EntryPoint v0.6 charges only for gas used, so unused headroom costs nothing.
 */
export const CALL_GAS_HEADROOM_BPS = 12_000n

type PaymasterResult = Awaited<ReturnType<typeof getPaymasterAndData>>

function paymasterAndDataOf(result: PaymasterResult): `0x${string}` {
  return ('paymasterAndData' in result && result.paymasterAndData ? result.paymasterAndData : '0x') as `0x${string}`
}

/**
 * `overrides.paymaster` for the sponsored managed account. Does what thirdweb's sponsored
 * EntryPoint v0.6 flow does (sponsor, estimate, re-sign), except that it raises callGasLimit by
 * {@link CALL_GAS_HEADROOM_BPS} before the paymaster signs. thirdweb uses gas limits returned
 * from this hook as they are; without it, it replaces `tx.gas` with the bundler's estimate.
 *
 * A `tx.gas` larger than the raised estimate wins. `client` may be a function, called per UserOp,
 * so a wallet can be built before publish config has a client id.
 *
 * Install it on any sponsored EntryPoint v0.6 smart wallet that sends Seed publishes, e.g. one
 * built with thirdweb's `smartWallet()` on a server:
 * `overrides: { paymaster: seedPaymaster(client, chain) }`.
 */
export function seedPaymaster(
  client: ThirdwebClient | (() => ThirdwebClient),
  chain: Chain,
  bundlerUrl?: string,
) {
  return async (userOp: Parameters<typeof getPaymasterAndData>[0]['userOp']): Promise<PaymasterResult> => {
    logGas('paymaster hook called (userOp from thirdweb; callGasLimit is tx.gas or 0)', {
      sender: userOp.sender,
      chainId: chain.id,
      bundlerUrl: bundlerUrl ?? '(thirdweb default)',
      entryPoint: 'initCode' in userOp ? 'v0.6' : 'v0.7',
      ...gasFields(userOp),
    })
    if (!('initCode' in userOp)) {
      throw new Error(
        '@seedprotocol/publish: the managed account sent an EntryPoint v0.7 UserOp; its sponsored gas handling only supports EntryPoint v0.6.',
      )
    }
    const thirdwebClient = typeof client === 'function' ? client() : client
    // Don't pass paymasterOverride to getPaymasterAndData, or it calls this hook again.
    const first = await getPaymasterAndData({ userOp, client: thirdwebClient, chain })
    logGas('1/3 paymaster sponsored (limits here are ignored)', gasFields(first))
    const op: UserOperation = { ...userOp, paymasterAndData: paymasterAndDataOf(first) }
    const est = await estimateUserOpGas({ userOp: op, options: { client: thirdwebClient, chain, bundlerUrl } })
    logGas('2/3 bundler estimate (callGasLimit includes thirdweb\'s +50k)', gasFields(est))
    const raised = (est.callGasLimit * CALL_GAS_HEADROOM_BPS) / 10_000n
    op.callGasLimit = userOp.callGasLimit > raised ? userOp.callGasLimit : raised
    op.verificationGasLimit = est.verificationGasLimit
    op.preVerificationGas = est.preVerificationGas

    // The paymaster's signature covers the gas limits, so it signs again after they change.
    logGas('raised limits sent to the paymaster for signing', {
      ...gasFields(op),
      headroomBps: CALL_GAS_HEADROOM_BPS,
      raisedEstimate: raised,
      txGas: userOp.callGasLimit,
    })
    const signed = await getPaymasterAndData({ userOp: op, client: thirdwebClient, chain })
    logGas('3/3 paymaster signed', gasFields(signed))
    if (signed.callGasLimit && signed.verificationGasLimit && signed.preVerificationGas) {
      // The paymaster signed its own limits; returning ours would fail validation.
      logGas('returning to thirdweb: the PAYMASTER\'s own limits (its signature covers them)', {
        ...gasFields(signed),
        requestedCallGasLimit: op.callGasLimit,
      })
      return signed
    }
    const result = {
      paymasterAndData: paymasterAndDataOf(signed),
      callGasLimit: op.callGasLimit,
      verificationGasLimit: op.verificationGasLimit,
      preVerificationGas: op.preVerificationGas,
    }
    logGas('returning to thirdweb: our raised limits (thirdweb should send exactly these)', gasFields(result))
    return result
  }
}

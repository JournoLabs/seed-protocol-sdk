import debug from 'debug'
import { parseAbi, type Address } from 'viem'
import { entryPoint08Address } from 'viem/account-abstraction'
import { getPublishConfig } from '~/config'
import { PublishGasError } from '~/errors'
import { getPublishPublicClient } from '~/helpers/chainClient'
import { resolvePublishPayment } from '~/payment'

/**
 * How many times a publish's estimated gas cost the sponsor's deposit must hold for the preflight
 * to count on sponsorship. The estimate is a heuristic, and other users draw on the same deposit.
 */
export const SPONSOR_DEPOSIT_MARGIN = 2n

const logger = debug('seedProtocol:services:sponsorStatus')

export type SponsorStatus = {
  /** `payment.sponsorPaymaster`. */
  paymaster: string
  /** The paymaster's deposit on EntryPoint v0.8, in wei. */
  depositWei: bigint
}

const entryPointBalanceAbi = parseAbi(['function balanceOf(address account) view returns (uint256)'])

/** The sponsoring paymaster's EntryPoint v0.8 deposit; `null` without `payment.sponsorPaymaster`. */
export async function getSponsorStatus(): Promise<SponsorStatus | null> {
  const paymaster = getPublishConfig().payment?.sponsorPaymaster
  if (!paymaster) return null
  const depositWei = await getPublishPublicClient().readContract({
    address: entryPoint08Address,
    abi: entryPointBalanceAbi,
    functionName: 'balanceOf',
    args: [paymaster as Address],
  })
  return { paymaster, depositWei }
}

/**
 * The publish preflight: with `payment.whenSponsorDeclines: 'user'` and `payment.sponsorPaymaster`,
 * asks `payment.confirmSelfPay` (reason `'deposit_low'`) when the paymaster's deposit is under
 * {@link SPONSOR_DEPOSIT_MARGIN} times the publish's estimated gas cost.
 *
 * @param estimateGas the publish's gas, read only when a deposit is checked
 * @throws PublishGasError `SELF_PAY_REFUSED` when `confirmSelfPay` resolves `false` or throws
 */
export async function confirmSelfPayIfSponsorLow(params: {
  address: string
  estimateGas: () => Promise<bigint>
}): Promise<void> {
  const config = getPublishConfig()
  if (resolvePublishPayment(config).gas.fallback !== 'user') return
  const confirm = config.payment?.confirmSelfPay
  // Without a callback there is nothing to ask: the send-time fallback decides.
  if (!confirm) return
  let estimatedCostWei: bigint
  try {
    const status = await getSponsorStatus()
    if (!status) return
    const gas = await params.estimateGas()
    estimatedCostWei = gas * (await getPublishPublicClient().getGasPrice())
    if (status.depositWei >= SPONSOR_DEPOSIT_MARGIN * estimatedCostWei) return
  } catch (err) {
    // The preflight is optional; a decline at the send is still handled there.
    logger('skipped the sponsor deposit preflight: %O', err)
    return
  }
  const agreed = await Promise.resolve()
    .then(() => confirm({ address: params.address, reason: 'deposit_low', estimatedCostWei }))
    .catch(() => false)
  if (agreed !== true) {
    throw new PublishGasError(
      `The sponsor's deposit can't cover this publish and ${params.address} didn't agree to pay the gas.`,
      'SELF_PAY_REFUSED',
      params.address,
    )
  }
}

import type { ResolvedPublishConfig } from '../../config'
import { resolvePublishPayment } from '../../payment'
import type { SeedSigner } from '../seedSigner'
import type { CreatePermissionlessTxSenderOptions } from './permissionlessTxSender'

/**
 * The EIP-7702 sender's options for `config`: its bundler and paymaster, the Seed delegate when one is
 * configured, whether it is sponsored,
 * and, with `payment.whenSponsorDeclines: 'user'`, the self-pay fallback asking
 * `payment.confirmSelfPay` (or going ahead when there is none).
 */
export function permissionlessSenderOptions(
  config: ResolvedPublishConfig,
  signer: SeedSigner,
): CreatePermissionlessTxSenderOptions {
  const { gas } = resolvePublishPayment(config)
  const confirmSelfPay = config.payment?.confirmSelfPay
  return {
    signer,
    bundlerUrl: config.bundlerUrl!,
    paymasterUrl: config.paymasterUrl,
    sponsored: gas.payer === 'sponsored',
    ...(config.seedDelegateAddress && { delegate: config.seedDelegateAddress }),
    ...(gas.fallback === 'user' && {
      onSponsorDeclined: confirmSelfPay ?? (async () => true),
    }),
  }
}

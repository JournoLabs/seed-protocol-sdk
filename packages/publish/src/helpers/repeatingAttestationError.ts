import { isManagedAccountPublishError, PublishNonceKeyError, type ManagedAccountPublishErrorCode } from '~/errors'
import { PublishChainConfigError } from './verifyPublishChain'

/** An error and its causes, outermost first, at most 8. */
export const errorChain = (err: unknown): unknown[] => {
  const chain: unknown[] = []
  for (let cur = err; cur && chain.length < 8; cur = (cur as { cause?: unknown }).cause) chain.push(cur)
  return chain
}

const REPEATING_CODES = new Set<ManagedAccountPublishErrorCode>([
  'PUBLISH_PREFLIGHT_FAILED',
  'PUBLISH_TOO_LARGE',
  'MULTI_PUBLISH_NOT_ROUTED',
  'USEROP_REVERTED',
  'USEROP_FAILED_NO_REASON',
  'MANAGED_ACCOUNT_NOT_DEPLOYED',
  'EXECUTOR_MODULE_NOT_INSTALLED',
])

/**
 * Whether a publish's attestation error comes back on every retry until something outside the
 * publish changes: a `PublishNonceKeyError`, a `PublishChainConfigError`, or a
 * `ManagedAccountPublishError` whose code is `PUBLISH_PREFLIGHT_FAILED`, `PUBLISH_TOO_LARGE`,
 * `MULTI_PUBLISH_NOT_ROUTED`, `USEROP_REVERTED`, `USEROP_FAILED_NO_REASON`,
 * `MANAGED_ACCOUNT_NOT_DEPLOYED` or `EXECUTOR_MODULE_NOT_INSTALLED`, anywhere in the cause chain.
 *
 * The run still waits for `retry` or `PublishManager.giveUpPublish`. A host can offer giving up
 * first for these, but a retry may still succeed after the author deploys the account, installs the
 * module or funds it, and a new publish uploads to Arweave again.
 */
export function isRepeatingAttestationError(err: unknown): boolean {
  return errorChain(err).some(
    (e) =>
      e instanceof PublishNonceKeyError ||
      e instanceof PublishChainConfigError ||
      (isManagedAccountPublishError(e) && REPEATING_CODES.has(e.code)),
  )
}

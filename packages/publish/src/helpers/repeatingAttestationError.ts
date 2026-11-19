import { isManagedAccountPublishError, PublishNonceKeyError, type ManagedAccountPublishErrorCode } from '~/errors'
import { errorChain } from './errorChain'
import { PublishChainConfigError } from './verifyPublishChain'

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
 * publish changes: a `PublishNonceKeyError` other than `NONCE_KEY_UNUSED` (a retry settles that
 * send from its hash), a `PublishChainConfigError`, or a
 * `ManagedAccountPublishError` whose code is `PUBLISH_PREFLIGHT_FAILED`, `PUBLISH_TOO_LARGE`,
 * `MULTI_PUBLISH_NOT_ROUTED`, `USEROP_REVERTED`, `USEROP_FAILED_NO_REASON`,
 * `MANAGED_ACCOUNT_NOT_DEPLOYED` or `EXECUTOR_MODULE_NOT_INSTALLED`, anywhere in the cause chain.
 * An error restored with a publish from the database matches by `name` and `code`.
 *
 * The run still waits for `retry` or `PublishManager.giveUpPublish`. A host can offer giving up
 * first for these, but a retry may still succeed after the author deploys the account, installs the
 * module or funds it, and a new publish uploads to Arweave again.
 */
export function isRepeatingAttestationError(err: unknown): boolean {
  return errorChain(err).some(
    (e) =>
      (isNamed(e, PublishNonceKeyError) && (e as { code?: unknown }).code !== 'NONCE_KEY_UNUSED') ||
      isNamed(e, PublishChainConfigError) ||
      (isManagedAccountPublishError(e) && REPEATING_CODES.has(e.code)),
  )
}

/**
 * An instance of `type`, or an object carrying its `name`: a publish restored from the database has
 * its error as the plain object the snapshot's JSON kept.
 */
function isNamed(e: unknown, type: abstract new (...args: never[]) => Error): boolean {
  if (e instanceof type) return true
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === type.name
}

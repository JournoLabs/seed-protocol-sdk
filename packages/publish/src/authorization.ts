import type { IItem } from '@seedprotocol/sdk'
import type { ResolvedPublishPayment } from './payment'
import type { PublishCostEstimate, PublishMode } from './services/publishCost/types'

/** What an {@link AuthorizePublish} hook is asked to approve. */
export interface PublishAuthorizationRequest {
  item: IItem<any>
  seedLocalId: string
  publishMode: PublishMode
  /** Who will pay gas and storage (see `resolvePublishPayment`). */
  payment: ResolvedPublishPayment
  /** Cost estimate for this publish. Fetches market prices, so call it only if you need it. */
  getEstimate: () => Promise<PublishCostEstimate>
}

/** An approval. `token` goes to the upload API with this publish's requests. */
export interface PublishAuthorization {
  /**
   * Sent as the {@link PUBLISH_AUTHORIZATION_HEADER} header on upload API requests (not to Turbo),
   * so an operator can meter or bill the publish against it.
   */
  token?: string
}

/**
 * Runs before a publish spends anything (before schema registration, uploads and attestations).
 * Return `false` or throw to refuse: the publish fails with {@link PublishNotAuthorizedError}.
 * Return `true`, nothing, or a {@link PublishAuthorization} to go ahead. A resumed publish that
 * already got past this step is not asked again.
 */
export type AuthorizePublish = (
  request: PublishAuthorizationRequest,
) => PublishAuthorization | boolean | void | Promise<PublishAuthorization | boolean | void>

/** Header carrying {@link PublishAuthorization.token} to the upload API. */
export const PUBLISH_AUTHORIZATION_HEADER = 'X-Seed-Publish-Authorization'

export class PublishNotAuthorizedError extends Error {
  constructor(seedLocalId: string, cause?: unknown) {
    const reason = cause instanceof Error ? `: ${cause.message}` : ''
    super(`@seedprotocol/publish: publish of ${seedLocalId} was not authorized${reason}`, { cause })
    this.name = 'PublishNotAuthorizedError'
  }
}

/**
 * Calls the hook and normalizes its answer. Without a hook every publish is approved.
 * @throws PublishNotAuthorizedError when the hook returns false or throws
 */
export async function runAuthorizePublish(
  hook: AuthorizePublish | undefined,
  request: PublishAuthorizationRequest,
): Promise<PublishAuthorization> {
  if (!hook) return {}
  let answer: Awaited<ReturnType<AuthorizePublish>>
  try {
    answer = await hook(request)
  } catch (error) {
    throw new PublishNotAuthorizedError(request.seedLocalId, error)
  }
  if (answer === false) throw new PublishNotAuthorizedError(request.seedLocalId)
  if (answer && typeof answer === 'object') {
    return typeof answer.token === 'string' && answer.token.length > 0 ? { token: answer.token } : {}
  }
  return {}
}

/** Headers to add to upload API requests for a publish with this authorization. */
export function publishAuthorizationHeaders(authorization: PublishAuthorization | undefined): Record<string, string> {
  return authorization?.token ? { [PUBLISH_AUTHORIZATION_HEADER]: authorization.token } : {}
}

import { createThirdwebClient, type ThirdwebClient } from 'thirdweb'
import { getPublishConfig } from '../config'

let _client: ThirdwebClient | null = null
let _clientKey: string | null = null

/**
 * Thirdweb client for publish sends and contract calls.
 * Uses `thirdwebSecretKey` when set so server-side RPC is not limited to browser origins.
 * Recreates the client when the client id or secret key changes.
 */
export function getClient(): ThirdwebClient {
  const { thirdwebClientId, thirdwebSecretKey } = getPublishConfig()
  if (!thirdwebClientId && !thirdwebSecretKey) {
    throw new Error(
      '@seedprotocol/publish/thirdweb: thirdwebClientId or thirdwebSecretKey is required. Pass one in initPublish / PublishProvider config.',
    )
  }
  const key = `${thirdwebClientId ?? ''}\0${thirdwebSecretKey ?? ''}`
  if (!_client || _clientKey !== key) {
    _clientKey = key
    _client = thirdwebClientId
      ? createThirdwebClient({
          clientId: thirdwebClientId,
          ...(thirdwebSecretKey ? { secretKey: thirdwebSecretKey } : {}),
        })
      : createThirdwebClient({ secretKey: thirdwebSecretKey! })
  }
  return _client
}

/** Drop the cached client (tests). */
export function resetPublishThirdwebClient(): void {
  _client = null
  _clientKey = null
}

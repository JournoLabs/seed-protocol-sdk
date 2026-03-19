/**
 * Test RevokeExecutor that performs only the local DB update (updateSeedRevokedAt).
 * Skips EAS/thirdweb/wallet - use for integration tests without blockchain.
 */

import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import type { RevokeExecutor } from '@/helpers/publishConfig'

/**
 * Creates a test RevokeExecutor that updates the local DB only.
 * No EAS, thirdweb, or wallet calls.
 */
export function createTestRevokeExecutor(): RevokeExecutor {
  return async (params) => {
    const { seedLocalId } = params
    const revokedAt = Math.floor(Date.now() / 1000)
    await updateSeedRevokedAt({ seedLocalId, revokedAt })
  }
}

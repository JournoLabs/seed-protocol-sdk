import { describe, expect, it } from 'vitest'
import { DEFAULT_SEED_GATEWAY_HYPER_KEY } from '../src/constants'
import { DEFAULT_SEED_GATEWAY_HYPER_KEY as ARWEAVE_GATEWAY_HYPER_KEY } from '../../arweave/src/constants'

/**
 * gateway-hyper keeps its own copy of the operator key so the tunnel doesn't depend on
 * @seedprotocol/arweave, which the SDK and clients read it from. The two must stay equal.
 */
describe('DEFAULT_SEED_GATEWAY_HYPER_KEY', () => {
  it('matches the copy in @seedprotocol/arweave', () => {
    expect(DEFAULT_SEED_GATEWAY_HYPER_KEY).toBe(ARWEAVE_GATEWAY_HYPER_KEY)
  })
})

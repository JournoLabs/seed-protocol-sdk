import createTestnet from 'hyperdht/testnet'
import type { DhtBootstrapNode } from '../../src/types'

export type LocalTestnet = {
  bootstrap: DhtBootstrapNode[]
  destroy: () => Promise<void>
}

/** A HyperDHT network on 127.0.0.1, so DHT tests need neither the internet nor the public DHT. */
export async function startTestnet(size = 3): Promise<LocalTestnet> {
  const testnet = await createTestnet(size)
  return {
    bootstrap: testnet.bootstrap,
    destroy: () => testnet.destroy(),
  }
}

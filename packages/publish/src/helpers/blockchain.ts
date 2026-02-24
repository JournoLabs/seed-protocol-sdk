import Arweave from 'arweave'
import { BaseArweaveClient } from '@seedprotocol/sdk'

export const getArweave = (): Arweave => {
  const host = BaseArweaveClient.getHost()

  const ArweaveModule = Arweave as typeof Arweave & { default?: typeof Arweave }
  if (Object.keys(ArweaveModule).includes('default') && ArweaveModule.default) {
    return ArweaveModule.default.init({
      host,
      protocol: 'https',
    })
  }

  return ArweaveModule.init({
    host,
    protocol: 'https',
  })
}


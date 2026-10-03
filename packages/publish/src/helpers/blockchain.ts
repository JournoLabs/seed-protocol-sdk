import Arweave from 'arweave'
import { BaseArweaveClient } from '@seedprotocol/sdk'

/**
 * `arweave` client for the configured gateway, keeping its protocol and port so local gateways
 * (e.g. `http://localhost:1984`) work. See {@link BaseArweaveClient.getArweaveJsApiConfig}.
 */
export const getArweave = (): Arweave => {
  const options = BaseArweaveClient.getArweaveJsApiConfig()

  const ArweaveModule = Arweave as typeof Arweave & { default?: typeof Arweave }
  if (Object.keys(ArweaveModule).includes('default') && ArweaveModule.default) {
    return ArweaveModule.default.init(options)
  }

  return ArweaveModule.init(options)
}

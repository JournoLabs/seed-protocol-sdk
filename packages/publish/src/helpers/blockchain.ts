import Arweave from 'arweave'
import { BaseArweaveClient } from '@seedprotocol/sdk'

/**
 * `arweave` client for the configured gateway, keeping its protocol and port so local gateways
 * (e.g. `http://localhost:1984`) work. Path prefixes are dropped: the `arweave` client cannot
 * address a gateway mounted under a path.
 */
export const getArweave = (): Arweave => {
  const url = new URL(BaseArweaveClient.getBaseUrl())
  const protocol = url.protocol.replace(':', '')
  const options = {
    host: url.hostname,
    protocol,
    port: url.port ? Number(url.port) : protocol === 'http' ? 80 : 443,
  }

  const ArweaveModule = Arweave as typeof Arweave & { default?: typeof Arweave }
  if (Object.keys(ArweaveModule).includes('default') && ArweaveModule.default) {
    return ArweaveModule.default.init(options)
  }

  return ArweaveModule.init(options)
}

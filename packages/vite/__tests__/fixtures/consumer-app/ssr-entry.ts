import { checksumAddress } from '@seedprotocol/eas/utils'
import { loadQueryCacheConfig } from '@seedprotocol/query/cache-config'

export function probe() {
  return {
    checksum: checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'),
    cacheEnabled: loadQueryCacheConfig().enabled,
  }
}

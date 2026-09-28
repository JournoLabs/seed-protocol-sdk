import { checksumAddress } from '@seedprotocol/eas/utils'
import { loadQueryCacheConfig } from '@seedprotocol/query/cache-config'
import pluralize from 'pluralize'

const checksummed = checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')
const cacheEnabled = loadQueryCacheConfig().enabled
const posts = pluralize('post')

export function App() {
  return (
    <div>
      {checksummed} {posts} {String(cacheEnabled)}
    </div>
  )
}

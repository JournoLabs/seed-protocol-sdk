import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import { DefaultEasClient } from './EasClient.js'
import { DefaultQueryClient } from './QueryClient.js'

export { DefaultEasClient } from './EasClient.js'
export { DefaultQueryClient } from './QueryClient.js'

/**
 * Register the default EAS + query clients for whichever of the two has no implementation yet.
 * Clients a host already registered (e.g. the SDK's browser clients) are left in place.
 */
export function ensureEasPlatform(): void {
  if (!BaseEasClient.isConfigured()) BaseEasClient.configure(new DefaultEasClient())
  if (!BaseQueryClient.isConfigured()) BaseQueryClient.configure(new DefaultQueryClient())
}

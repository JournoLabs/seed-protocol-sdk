import { NodeEasClient } from './EasClient.js'
import { NodeQueryClient } from './QueryClient.js'
import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'

export { EasClient, NodeEasClient } from './EasClient.js'
export { QueryClient, NodeQueryClient } from './QueryClient.js'

/** Register Node.js EAS + query client implementations. */
export function registerNodeEasPlatform(): void {
  BaseEasClient.configure(new NodeEasClient())
  BaseQueryClient.configure(new NodeQueryClient())
}

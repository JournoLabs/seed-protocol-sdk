import { NodeEasClient, type NodeEasClientOptions } from './EasClient.js'
import { NodeQueryClient } from './QueryClient.js'
import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'

export { NodeEasClient } from './EasClient.js'
export type { NodeEasClientOptions } from './EasClient.js'
export {
  createEasNodeDispatcher,
  EAS_NODE_ECDH_CURVE,
  EAS_NODE_KEEP_ALIVE_TIMEOUT_MS,
} from './easDispatcher.js'
export type { EasNodeDispatcherOptions } from './easDispatcher.js'
export { NodeQueryClient } from './QueryClient.js'

/**
 * Register Node.js EAS + query client implementations. `easClient` options go to
 * {@link NodeEasClient}, e.g. `{ dispatcher: false }` to send EAS requests through fetch's
 * global dispatcher.
 */
export function registerNodeEasPlatform(options: { easClient?: NodeEasClientOptions } = {}): void {
  BaseEasClient.configure(new NodeEasClient(options.easClient))
  BaseQueryClient.configure(new NodeQueryClient())
}

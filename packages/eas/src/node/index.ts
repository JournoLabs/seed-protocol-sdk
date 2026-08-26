import './EasClient.js'
import './QueryClient.js'

export { EasClient } from './EasClient.js'
export { QueryClient } from './QueryClient.js'

/** Register Node.js EAS + query client implementations. */
export function registerNodeEasPlatform(): void {
  // Side-effect imports above register platform classes.
}

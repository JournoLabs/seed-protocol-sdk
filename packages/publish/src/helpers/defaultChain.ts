import type { Chain } from 'viem'
import { optimismSepolia } from 'viem/chains'

/** Default chain when apps omit `PublishConfig.chain`. */
export const DEFAULT_PUBLISH_CHAIN: Chain = optimismSepolia

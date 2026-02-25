import type { PublishConfig } from './config'

declare global {
  interface Window {
    __SEED_PUBLISH_CONFIG__?: PublishConfig | null
  }
}

export {}

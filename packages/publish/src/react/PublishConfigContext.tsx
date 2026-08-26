import { createContext, useContext } from 'react'
import type { PublishConfig } from '../config'

export const PublishConfigContext = createContext<PublishConfig | null>(null)

export function usePublishConfig(): PublishConfig {
  const config = useContext(PublishConfigContext)
  if (!config) {
    throw new Error(
      'usePublishConfig: PublishConfig is missing. Pass config to PublishProvider or call initPublish() before render.',
    )
  }
  return config
}

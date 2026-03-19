import React, { createContext, FC, useContext, useEffect } from "react"
import type { MutableRefObject } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { ThirdwebProvider } from "thirdweb/react"
import { SeedProvider } from '@seedprotocol/react'
import { initPublish, getConfigRef, type PublishConfig } from "../config"

const PublishConfigContext = createContext<PublishConfig | null>(null)

export function usePublishConfig(): PublishConfig {
  const config = useContext(PublishConfigContext)
  if (!config) {
    throw new Error('usePublishConfig must be used within PublishProvider')
  }
  return config
}

export interface PublishProviderProps {
  children: React.ReactNode
  /**
   * If provided, calls initPublish with this config.
   * Otherwise, assumes initPublish was already called elsewhere.
   */
  config?: PublishConfig
  /** Optional: use your own QueryClient for Seed hooks. If not provided, SeedProvider creates one. */
  queryClient?: QueryClient
  /** Optional: ref to receive the QueryClient instance (e.g. for tests). */
  queryClientRef?: MutableRefObject<QueryClient | null>
}

const PublishProvider: FC<PublishProviderProps> = ({
  children,
  config,
  queryClient,
  queryClientRef,
}) => {
  useEffect(() => {
    if (config) {
      initPublish(config)
    }
  }, [config])

  return (
    <PublishConfigContext.Provider value={config ?? getConfigRef()}>
      <ThirdwebProvider>
        <SeedProvider queryClient={queryClient} queryClientRef={queryClientRef}>
          {children}
        </SeedProvider>
      </ThirdwebProvider>
    </PublishConfigContext.Provider>
  )
}

export default PublishProvider

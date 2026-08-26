import React, { FC, useEffect } from "react"
import type { MutableRefObject } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { SeedProvider } from '@seedprotocol/react'
import { initPublish, getConfigRef, type PublishConfig } from "../config"
import { PublishConfigContext, usePublishConfig } from "./PublishConfigContext"

export { usePublishConfig }
export type { PublishConfig }

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

/**
 * Core PublishProvider — no Thirdweb dependency.
 * For in-app wallets / ConnectButton, use `@seedprotocol/publish/thirdweb`.
 */
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
      <SeedProvider queryClient={queryClient} queryClientRef={queryClientRef}>
        {children}
      </SeedProvider>
    </PublishConfigContext.Provider>
  )
}

export default PublishProvider

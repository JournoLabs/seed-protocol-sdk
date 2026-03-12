import React, { FC } from "react"
import type { MutableRefObject } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { ThirdwebProvider } from "thirdweb/react"
import { SeedProvider } from '@seedprotocol/react'
import { initPublish, type PublishConfig } from "../config"

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
  if (config) {
    initPublish(config)
  }

  return (
    <ThirdwebProvider>
      <SeedProvider queryClient={queryClient} queryClientRef={queryClientRef}>
        {children}
      </SeedProvider>
    </ThirdwebProvider>
  )
}

export default PublishProvider

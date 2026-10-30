import React, { FC, useRef } from "react"
import type { MutableRefObject } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { SeedProvider } from '@seedprotocol/react'
import type { SeedConfig, SeedConstructorOptions } from '@seedprotocol/sdk'
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
  /**
   * The Seed client config, passed to `SeedProvider` as its `config`: with it, the provider
   * initializes the client. `config` above is the publish config.
   */
  seedConfig?: SeedConfig
  /** Owned and watched addresses for the client's init, passed to `SeedProvider`. */
  addresses?: SeedConstructorOptions['addresses']
  /** Called when client init fails, passed to `SeedProvider`. */
  onInitError?: (err: unknown) => void
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
  seedConfig,
  addresses,
  onInitError,
  queryClient,
  queryClientRef,
}) => {
  // During render, not in an effect: children such as ConnectButton read the config on their
  // first render, which runs before this provider's effects. Once per config object.
  const initializedConfig = useRef<PublishConfig | undefined>(undefined)
  if (config && initializedConfig.current !== config) {
    initPublish(config)
    initializedConfig.current = config
  }

  return (
    <PublishConfigContext.Provider value={config ?? getConfigRef()}>
      <SeedProvider
        config={seedConfig}
        addresses={addresses}
        onInitError={onInitError}
        queryClient={queryClient}
        queryClientRef={queryClientRef}
      >
        {children}
      </SeedProvider>
    </PublishConfigContext.Provider>
  )
}

export default PublishProvider

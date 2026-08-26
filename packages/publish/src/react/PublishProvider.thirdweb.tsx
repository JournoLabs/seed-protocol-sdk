import React, { FC, useEffect } from "react"
import type { MutableRefObject } from "react"
import type { QueryClient } from "@tanstack/react-query"
import { ThirdwebProvider } from "thirdweb/react"
import { SeedProvider } from '@seedprotocol/react'
import { initPublish, getConfigRef, type PublishConfig } from "../config"
import { PublishConfigContext, usePublishConfig } from "./PublishConfigContext"
import type { PublishProviderProps } from "./PublishProvider"

export { usePublishConfig }
export type { PublishProviderProps }

/**
 * Thirdweb-backed PublishProvider (includes ThirdwebProvider).
 */
const PublishProviderThirdweb: FC<PublishProviderProps> = ({
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

export default PublishProviderThirdweb

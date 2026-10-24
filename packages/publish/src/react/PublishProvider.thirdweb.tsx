import React, { FC, useRef } from "react"
import { ThirdwebProvider } from "thirdweb/react"
import { SeedProvider } from '@seedprotocol/react'
import { initPublish, getConfigRef, type PublishConfig } from "../config"
import { PublishConfigContext, usePublishConfig } from "./PublishConfigContext"
import type { PublishProviderProps } from "./PublishProvider"

export { usePublishConfig }

/**
 * Thirdweb-backed PublishProvider (includes ThirdwebProvider).
 */
const PublishProviderThirdweb: FC<PublishProviderProps> = ({
  children,
  config,
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
      <ThirdwebProvider>
        <SeedProvider queryClient={queryClient} queryClientRef={queryClientRef}>
          {children}
        </SeedProvider>
      </ThirdwebProvider>
    </PublishConfigContext.Provider>
  )
}

export default PublishProviderThirdweb

import React, { FC } from "react"
import { ThirdwebClient } from "thirdweb"
import { ConnectButton as ConnectButtonThirdweb, darkTheme } from "thirdweb/react"
import { client as seedClient } from "@seedprotocol/sdk"
import { getClient, getWalletsForConnectButton } from "../helpers/thirdweb"
import { getPublishConfig } from "../config"
import { optimismSepolia } from "thirdweb/chains"

const ConnectButton: FC = () => {
  const handleDisconnect = async () => {
    console.log('[ConnectButton] Disconnected')
    try {
      await seedClient.setAddresses([])
    } catch (err) {
      console.warn('[ConnectButton] Failed to clear seed client addresses:', err)
    }
  }

  const { thirdwebAccountFactoryAddress } = getPublishConfig()

  return (
    <ConnectButtonThirdweb
      client={getClient() as ThirdwebClient}
      wallets={getWalletsForConnectButton()}
      autoConnect={true}
      chain={optimismSepolia}
      chains={[ optimismSepolia, ]}
      accountAbstraction={{
        chain          : optimismSepolia,
        factoryAddress : thirdwebAccountFactoryAddress,
        gasless        : true,
      }}
      onDisconnect={handleDisconnect}
      theme={darkTheme({
        colors: {
          primaryButtonBg: '#1D2939',
          primaryButtonText: '#FFFFFF',
          secondaryButtonHoverBg: '#1D2939',
          connectedButtonBg: '#101828',
          connectedButtonBgHover: '#1D2939',
          borderColor: '#344054',
        },
      })}
    />
  )
}

export default ConnectButton
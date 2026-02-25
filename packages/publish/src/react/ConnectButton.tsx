import React, { FC } from "react"
import { ConnectButton as ConnectButtonThirdweb, darkTheme } from "thirdweb/react"
import { client as seedClient } from "@seedprotocol/sdk"
import { getClient, getWalletsForConnectButton } from "../helpers/thirdweb"
import { getPublishConfig } from "../config"
import { optimismSepolia } from "thirdweb/chains"
import { getContract, sendTransaction, waitForReceipt } from "thirdweb"
import { getInstalledModules, installModule } from "thirdweb/modules"
import type { Account, Wallet } from "thirdweb/wallets"
import { encodeAbiParameters } from "viem"
import { EAS_CONTRACT_ADDRESS } from "../helpers/constants"

async function ensureModularAccountModule(account: Account): Promise<void> {
  const config = getPublishConfig()
  const { modularAccountModuleContract, modularAccountModuleData } = config
  if (!modularAccountModuleContract) return

  const accountContract = getContract({
    client: getClient(),
    chain: optimismSepolia,
    address: account.address,
  })

  const installed = await getInstalledModules({ contract: accountContract })
  const moduleAddr = modularAccountModuleContract.toLowerCase()
  const isInstalled = installed.some(
    (m: { implementation: string }) => m.implementation?.toLowerCase() === moduleAddr
  )
  if (isInstalled) return

  const tx = installModule({
    contract: accountContract,
    moduleContract: modularAccountModuleContract,
    data: encodeAbiParameters(
      [{ type: "address" }],
      [EAS_CONTRACT_ADDRESS]
    ),
  })
  const result = await sendTransaction({ transaction: tx, account })
  await waitForReceipt({
    client: getClient(),
    transactionHash: result.transactionHash,
    chain: optimismSepolia,
  })
}

const ConnectButton: FC = () => {
  const handleDisconnect = async () => {
    console.log('[ConnectButton] Disconnected')
    try {
      await seedClient.setAddresses([])
    } catch (err) {
      console.warn('[ConnectButton] Failed to clear seed client addresses:', err)
    }
  }

  const handleConnect = async (activeWallet: Wallet, _allConnectedWallets: Wallet[]) => {
    const account = activeWallet.getAccount()
    if (!account) return
    console.log('[ConnectButton] Connected', account.address)
    try {
      await ensureModularAccountModule(account)
    } catch (err) {
      console.warn('[ConnectButton] Module check/install failed:', err)
    }
  }

  return (
    <ConnectButtonThirdweb
      client={getClient()}
      wallets={getWalletsForConnectButton()}
      autoConnect={true}
      chain={optimismSepolia}
      chains={[ optimismSepolia, ]}
      onConnect={handleConnect}
      // accountAbstraction={{
      //   chain          : optimismSepolia,
      //   factoryAddress : thirdwebAccountFactoryAddress,
      //   gasless        : true,
      //   overrides: {
      //     execute: (accountContract, transaction) => {
      //       // Log the gas that was set on the transaction
      //       console.log("[SmartWallet Execute]", {
      //         gas: transaction.gas,
      //         to: transaction.to,
      //         dataLength: transaction.data?.length,
      //       });
      
      //       // Return the default execute call — don't change behavior,
      //       // just observe what's being passed through
      //       return prepareContractCall({
      //         contract: accountContract,
      //         method: "function execute(address, uint256, bytes)",
      //         params: [
      //           transaction.to ?? "",
      //           transaction.value ?? 0n,
      //           transaction.data ?? "0x",
      //         ],
      //         gas: transaction.gas, // Pass through whatever was set
      //       });
      //     },
      //   },
      // }}
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
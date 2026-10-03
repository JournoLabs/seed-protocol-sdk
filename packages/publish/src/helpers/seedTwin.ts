import { defineChain, type Chain } from 'viem'
import type { PublishConfig } from '../config'

/**
 * The parts of seed-protocol's `.twin/twin.json` (written by `bun run twin:up`) that apps need.
 * Its test-account keys are deliberately not part of this type.
 */
export interface SeedTwinInfo {
  chainId: number
  rpcUrl: string
  bundlerUrl: string
  easGraphqlUrl: string
  contracts: {
    eas: string
    schemaRegistry: string
    managedAccountFactory: string
    seedProtocolExecutor: string
  }
  forkedFrom?: { chain?: string; chainId?: number; block?: number }
}

export type SeedTwinPublishConfig = Pick<
  PublishConfig,
  | 'chain'
  | 'rpcUrl'
  | 'easContractAddress'
  | 'schemaRegistryAddress'
  | 'managedAccountFactoryAddress'
  | 'modularAccountModuleContract'
  | 'thirdweb'
>

/**
 * Publish and SDK settings for the protocol's local OP Sepolia twin, from its `twin.json`.
 * Spread `publish` into `initPublish` and `eas` into `SeedConfig`:
 *
 * ```ts
 * const twin = seedTwinConfig(twinJson)
 * initPublish({ ...twin.publish, uploadApiBaseUrl, thirdwebClientId, useModularExecutor: true })
 * client.init({ config: { ...config, eas: twin.eas, filesDir: `.seed-${twin.chain.id}` } })
 * ```
 *
 * The twin has no paymaster or Thirdweb EIP-7702 service, so `thirdweb` turns sponsorship off,
 * uses the twin's bundler and sends admin transactions from a plain EOA. Fund the ManagedAccount
 * and the in-app EOA with `bun run twin:fund` before publishing.
 */
export function seedTwinConfig(twin: SeedTwinInfo): {
  chain: Chain
  publish: SeedTwinPublishConfig
  eas: { chainId: number; indexerUrl: string }
} {
  const missing = (
    [
      ['chainId', twin?.chainId],
      ['rpcUrl', twin?.rpcUrl],
      ['bundlerUrl', twin?.bundlerUrl],
      ['easGraphqlUrl', twin?.easGraphqlUrl],
      ['contracts.eas', twin?.contracts?.eas],
      ['contracts.schemaRegistry', twin?.contracts?.schemaRegistry],
      ['contracts.managedAccountFactory', twin?.contracts?.managedAccountFactory],
      ['contracts.seedProtocolExecutor', twin?.contracts?.seedProtocolExecutor],
    ] as const
  )
    .filter(([, value]) => value === undefined || value === null || value === '')
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(`seedTwinConfig: twin.json is missing ${missing.join(', ')}. Re-run twin:up.`)
  }

  const forkName = twin.forkedFrom?.chain ? ` (${twin.forkedFrom.chain} fork)` : ''
  const chain = defineChain({
    id: twin.chainId,
    name: `Seed twin${forkName}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [twin.rpcUrl] } },
    testnet: true,
  })

  return {
    chain,
    publish: {
      chain,
      rpcUrl: twin.rpcUrl,
      easContractAddress: twin.contracts.eas,
      schemaRegistryAddress: twin.contracts.schemaRegistry,
      managedAccountFactoryAddress: twin.contracts.managedAccountFactory,
      modularAccountModuleContract: twin.contracts.seedProtocolExecutor,
      thirdweb: { bundlerUrl: twin.bundlerUrl, sponsorGas: false, modularWalletMode: 'EOA' },
    },
    eas: { chainId: twin.chainId, indexerUrl: twin.easGraphqlUrl },
  }
}

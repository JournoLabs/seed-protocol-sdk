/**
 * EAS deployments per chain. Pure data (no viem / thirdweb) so read and write packages can share it.
 *
 * Addresses from https://github.com/ethereum-attestation-service/eas-contracts#deployments.
 * OP Stack chains use the predeploys 0x4200…0021 (EAS) and 0x4200…0020 (SchemaRegistry).
 */

export type HexAddress = `0x${string}`

export interface EasChainDeployment {
  chainId: number
  /** Human-readable chain name (used in error messages). */
  name: string
  easContractAddress: HexAddress
  schemaRegistryAddress: HexAddress
  /** EAS indexer GraphQL endpoint (easscan). */
  indexerUrl?: string
  /** EAS explorer origin; attestation pages live at `{explorerUrl}/attestation/view/{uid}`. */
  explorerUrl?: string
  testnet?: boolean
}

export const OP_STACK_EAS_CONTRACT_ADDRESS: HexAddress = '0x4200000000000000000000000000000000000021'
export const OP_STACK_SCHEMA_REGISTRY_ADDRESS: HexAddress = '0x4200000000000000000000000000000000000020'

function opStack(
  chainId: number,
  name: string,
  easscanSubdomain: string,
  testnet = false,
): EasChainDeployment {
  return {
    chainId,
    name,
    easContractAddress: OP_STACK_EAS_CONTRACT_ADDRESS,
    schemaRegistryAddress: OP_STACK_SCHEMA_REGISTRY_ADDRESS,
    indexerUrl: `https://${easscanSubdomain}.easscan.org/graphql`,
    explorerUrl: `https://${easscanSubdomain}.easscan.org`,
    testnet,
  }
}

function easscan(subdomain: string | null) {
  const origin = subdomain ? `https://${subdomain}.easscan.org` : 'https://easscan.org'
  return { indexerUrl: `${origin}/graphql`, explorerUrl: origin }
}

/** Known EAS deployments keyed by chain id. */
export const EAS_CHAIN_DEPLOYMENTS: Readonly<Record<number, EasChainDeployment>> = {
  1: {
    chainId: 1,
    name: 'Ethereum',
    easContractAddress: '0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587',
    schemaRegistryAddress: '0xA7b39296258348C78294F95B872b282326A97BDF',
    ...easscan(null),
  },
  11155111: {
    chainId: 11155111,
    name: 'Sepolia',
    easContractAddress: '0xC2679fBD37d54388Ce493F1DB75320D236e1815e',
    schemaRegistryAddress: '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0',
    ...easscan('sepolia'),
    testnet: true,
  },
  10: opStack(10, 'Optimism', 'optimism'),
  11155420: opStack(11155420, 'Optimism Sepolia', 'optimism-sepolia', true),
  8453: opStack(8453, 'Base', 'base'),
  84532: opStack(84532, 'Base Sepolia', 'base-sepolia', true),
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    easContractAddress: '0xbD75f629A22Dc1ceD33dDA0b68c546A1c035c458',
    schemaRegistryAddress: '0xA310da9c5B885E7fb3fbA9D66E9Ba6Df512b78eB',
    ...easscan('arbitrum'),
  },
  421614: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    easContractAddress: '0x2521021fc8BF070473E1e1801D3c7B4aB701E1dE',
    schemaRegistryAddress: '0x45CB6Fa0870a8Af06796Ac15915619a0f22cd475',
    // No public easscan indexer found for this chain; set SeedConfig.eas.indexerUrl.
    testnet: true,
  },
  137: {
    chainId: 137,
    name: 'Polygon',
    easContractAddress: '0x5E634ef5355f45A855d02D66eCD687b1502AF790',
    schemaRegistryAddress: '0x7876EEF51A891E737AF8ba5A5E0f0Fd29073D5a7',
    ...easscan('polygon'),
  },
  534352: {
    chainId: 534352,
    name: 'Scroll',
    easContractAddress: '0xC47300428b6AD2c7D03BB76D05A176058b47E6B0',
    schemaRegistryAddress: '0xD2CDF46556543316e7D34e8eDc4624e2bB95e3B6',
    ...easscan('scroll'),
  },
  59144: {
    chainId: 59144,
    name: 'Linea',
    easContractAddress: '0xaEF4103A04090071165F78D45D83A0C0782c2B2a',
    schemaRegistryAddress: '0x55D26f9ae0203EF95494AE4C170eD35f4Cf77797',
    ...easscan('linea'),
  },
}

/** Chain id Seed Protocol uses when an app does not configure one. */
export const DEFAULT_EAS_CHAIN_ID = 11155420

export function getEasChainDeployment(chainId: number): EasChainDeployment | undefined {
  return EAS_CHAIN_DEPLOYMENTS[chainId]
}

/**
 * Merge a known deployment with app overrides. Throws when the chain is unknown and the
 * overrides do not supply both contract addresses.
 */
export function resolveEasChainDeployment(
  chainId: number,
  overrides: Partial<Omit<EasChainDeployment, 'chainId'>> = {},
): EasChainDeployment {
  const known = getEasChainDeployment(chainId)
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  ) as Partial<EasChainDeployment>
  const merged = { ...known, ...definedOverrides, chainId } as Partial<EasChainDeployment>
  if (!merged.easContractAddress || !merged.schemaRegistryAddress) {
    throw new Error(
      `No known EAS deployment for chain ${chainId}. Pass easContractAddress and schemaRegistryAddress for this chain.`,
    )
  }
  return {
    ...merged,
    name: merged.name ?? `chain ${chainId}`,
  } as EasChainDeployment
}

/** Build `{explorerUrl}/attestation/view/{uid}`, or undefined when the chain has no explorer. */
export function getEasAttestationExplorerUrl(
  deployment: Pick<EasChainDeployment, 'explorerUrl'>,
  uid: string,
): string | undefined {
  if (!deployment.explorerUrl) return undefined
  return `${deployment.explorerUrl.replace(/\/+$/, '')}/attestation/view/${uid}`
}

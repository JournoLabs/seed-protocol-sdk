import { getPublishConfig } from '../config'
import { getPublishPublicClient, isContractDeployed } from './chainClient'
import { getPublishRpcUrl } from './chainConfig'

/** Thrown by {@link verifyPublishChain}; `problems` lists every check that failed. */
export class PublishChainConfigError extends Error {
  override name = 'PublishChainConfigError'
  constructor(
    readonly chainId: number,
    readonly problems: string[],
  ) {
    super(
      `@seedprotocol/publish: chain ${chainId} is not set up for publishing:\n- ${problems.join('\n- ')}`,
    )
  }
}

let verified: { key: string; result: Promise<void> } | null = null

function configKey(): string {
  const cfg = getPublishConfig()
  return [
    cfg.chain.id,
    getPublishRpcUrl(),
    cfg.easContractAddress,
    cfg.schemaRegistryAddress,
    cfg.thirdwebAccountFactoryAddress ?? '',
    cfg.modularAccountModuleContract ?? '',
  ]
    .join('|')
    .toLowerCase()
}

async function runChecks(): Promise<void> {
  const cfg = getPublishConfig()
  const { chain } = cfg
  const problems: string[] = []

  let rpcChainId: number | undefined
  try {
    rpcChainId = await getPublishPublicClient().getChainId()
  } catch (cause) {
    throw new PublishChainConfigError(chain.id, [
      `could not reach the RPC (${redactRpcUrl(getPublishRpcUrl())}): ${cause instanceof Error ? cause.message : String(cause)}`,
    ])
  }
  if (rpcChainId !== chain.id) {
    // Contract checks against the wrong chain would only add noise.
    throw new PublishChainConfigError(chain.id, [
      `the RPC reports chain ${rpcChainId}, but PublishConfig.chain is ${chain.name} (${chain.id}). Point rpcUrl at ${chain.name}.`,
    ])
  }

  const contracts: Array<[label: string, address: string | undefined, fix: string]> = [
    ['EAS contract', cfg.easContractAddress, 'set easContractAddress'],
    ['EAS SchemaRegistry', cfg.schemaRegistryAddress, 'set schemaRegistryAddress'],
    [
      'ManagedAccount factory',
      cfg.thirdwebAccountFactoryAddress,
      'deploy the factory or fix managedAccountFactoryAddress',
    ],
    [
      'executor module',
      cfg.modularAccountModuleContract?.trim() || undefined,
      'deploy the module or fix modularAccountModuleContract',
    ],
  ]
  const results = await Promise.all(
    contracts.map(async ([label, address, fix]) => {
      if (!address) return null
      const deployed = await isContractDeployed(address)
      return deployed ? null : `no ${label} at ${address} on ${chain.name}; ${fix}.`
    }),
  )
  for (const r of results) if (r) problems.push(r)

  if (problems.length > 0) throw new PublishChainConfigError(chain.id, problems)
}

/** Hide API keys embedded in RPC URLs (e.g. Thirdweb client ids) from error messages. */
function redactRpcUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return 'configured rpcUrl'
  }
}

/**
 * Checks that the configured chain is usable before anything is sent: the RPC reports
 * `PublishConfig.chain.id`, and EAS, the SchemaRegistry and (when configured) the ManagedAccount
 * factory and executor module have code at their addresses.
 *
 * Runs once per configuration (cached; a failure is retried on the next call). The publish
 * flow calls it before the first attestation; apps can call it at startup to fail early.
 *
 * @throws PublishChainConfigError listing every failed check
 */
export function verifyPublishChain(): Promise<void> {
  const key = configKey()
  if (verified?.key === key) return verified.result
  const result = runChecks()
  verified = { key, result }
  result.catch(() => {
    if (verified?.result === result) verified = null
  })
  return result
}

/** @internal Tests only. */
export function resetVerifiedPublishChain(): void {
  verified = null
}

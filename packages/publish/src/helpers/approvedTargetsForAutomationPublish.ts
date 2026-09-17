import { getPublishConfig } from '../config'

/**
 * Allowlisted call targets for **automation** session keys on a ManagedAccount.
 * Returns only the configured Seed executor module — never the ManagedAccount or raw EAS
 * (those would allow `setEas` / arbitrary attestations).
 *
 * @throws if `modularAccountModuleContract` is unset or invalid
 */
export function approvedTargetsForAutomationPublish(): `0x${string}`[] {
  const module = getPublishConfig().modularAccountModuleContract?.trim()
  if (!module || !/^0x[0-9a-fA-F]{40}$/.test(module)) {
    throw new Error(
      '@seedprotocol/publish: automation session keys require PublishConfig.modularAccountModuleContract ' +
        '(executor module only). Do not use defaultApprovedTargetsForModularPublish for server-held keys.',
    )
  }
  return [module.toLowerCase() as `0x${string}`]
}

import { getPublishConfig } from '../config'

function uniqueAddressesLower(addresses: string[]): `0x${string}`[] {
  const set = new Set<string>()
  for (const a of addresses) {
    const t = a.trim().toLowerCase()
    if (t.startsWith('0x') && t.length === 42) set.add(t)
  }
  return [...set].sort().map((x) => x as `0x${string}`)
}

/**
 * Allowlisted call targets for modular session signers: the managed account (`multiPublish`) and
 * the executor module when configured. Never EAS: a direct EAS target would bypass the Seed
 * extension's forced revocability.
 */
export function defaultApprovedTargetsForModularPublish(managedAddress: string): `0x${string}`[] {
  const cfg = getPublishConfig()
  const extra: string[] = [managedAddress]
  if (cfg.modularAccountModuleContract?.trim()) {
    extra.push(cfg.modularAccountModuleContract.trim())
  }
  return uniqueAddressesLower(extra)
}

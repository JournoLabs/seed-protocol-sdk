import { getPublishConfig } from '../config'
import { EAS_CONTRACT_ADDRESS } from './constants'

function uniqueAddressesLower(addresses: string[]): `0x${string}`[] {
  const set = new Set<string>()
  for (const a of addresses) {
    const t = a.trim().toLowerCase()
    if (t.startsWith('0x') && t.length === 42) set.add(t)
  }
  return [...set].sort().map((x) => x as `0x${string}`)
}

/** Allowlisted call targets for modular session signers: managed account, EAS, optional executor module. */
export function defaultApprovedTargetsForModularPublish(managedAddress: string): `0x${string}`[] {
  const cfg = getPublishConfig()
  const extra: string[] = [managedAddress, EAS_CONTRACT_ADDRESS]
  if (cfg.modularAccountModuleContract?.trim()) {
    extra.push(cfg.modularAccountModuleContract.trim())
  }
  return uniqueAddressesLower(extra)
}

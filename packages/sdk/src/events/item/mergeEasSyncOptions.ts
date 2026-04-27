import type { SyncFromEasOptions } from '@/events/item/syncDbWithEas'

/**
 * Merge multiple EAS sync intents: full sync (no concrete address list) wins;
 * otherwise union addresses (first-seen casing).
 */
export function mergeEasSyncRequestIntents(
  parts: (SyncFromEasOptions | undefined | null)[],
): SyncFromEasOptions {
  const norm = parts.filter((p): p is SyncFromEasOptions => p != null)
  if (norm.length === 0) {
    return {}
  }
  let full = false
  const addressMap = new Map<string, string>()
  for (const p of norm) {
    if (!('addresses' in p) || p.addresses === undefined) {
      full = true
      break
    }
    for (const addr of p.addresses) {
      const k = addr.toLowerCase()
      if (!addressMap.has(k)) {
        addressMap.set(k, addr)
      }
    }
  }
  if (full) {
    return {}
  }
  if (addressMap.size === 0) {
    return { addresses: [] }
  }
  return { addresses: [...addressMap.values()] }
}

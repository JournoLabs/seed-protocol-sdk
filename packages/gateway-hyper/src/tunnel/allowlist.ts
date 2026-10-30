import net from 'node:net'
import { decodePublicKey } from '../keys'

export type AllowlistOptions = {
  /** Client public keys (z32 or hex) */
  keys?: string[]
  /** Client IPs or CIDR ranges, IPv4 or IPv6 */
  ips?: string[]
}

/** How a stream was let in, or `none` when it was refused. */
export type AllowedBy = 'open' | 'key' | 'ip' | 'none'

export type AllowlistVerdict = {
  ok: boolean
  /** The UDP address the connection uses, IPv4-mapped prefix removed */
  host: string | null
  by: AllowedBy
}

/** The parts of a HyperDHT stream the allowlist reads. */
export type AllowlistStream = {
  remotePublicKey?: Uint8Array | null
  rawStream?: { remoteHost?: string | null } | null
}

export type Allowlist = {
  /** False when neither list has entries, so every client is let in. */
  enabled: boolean
  /** One line for logs, e.g. `keys=2 ips=192.168.1.0/24` or `off`. */
  summary: string
  /**
   * For HyperDHT's `firewall` server option: true refuses the client before it gets a stream.
   * Refuses only on the key, and only when no IP list is set, since the client's real address
   * is not known until the connection is up.
   */
  firewall: (remotePublicKey: Uint8Array) => boolean
  /** Check an established stream by key, then by address. */
  check: (stream: AllowlistStream) => AllowlistVerdict
}

function ipFamily(addr: string): 'ipv4' | 'ipv6' | null {
  if (net.isIPv4(addr)) return 'ipv4'
  if (net.isIPv6(addr)) return 'ipv6'
  return null
}

function parseIps(entries: string[]): net.BlockList {
  const list = new net.BlockList()
  for (const entry of entries) {
    const [addr = '', bits, extra] = entry.split('/')
    const family = ipFamily(addr)
    if (!family || extra !== undefined) {
      throw new Error(`Invalid allowlist IP (expected an address or CIDR): ${entry}`)
    }
    if (bits === undefined) {
      list.addAddress(addr, family)
      continue
    }
    const prefix = Number(bits)
    const max = family === 'ipv4' ? 32 : 128
    if (!/^\d+$/.test(bits) || prefix > max) {
      throw new Error(`Invalid allowlist CIDR prefix (expected 0–${max}): ${entry}`)
    }
    list.addSubnet(addr, prefix, family)
  }
  return list
}

function parseKeys(entries: string[]): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) {
    keys.add(decodePublicKey(entry).toString('hex'))
  }
  return keys
}

/** Strip the IPv4-mapped IPv6 prefix so `::ffff:1.2.3.4` matches an IPv4 entry. */
function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  const mapped = host.toLowerCase().startsWith('::ffff:') ? host.slice(7) : null
  return mapped && net.isIPv4(mapped) ? mapped : host
}

function cleanEntries(entries: string[] | undefined): string[] {
  return (entries ?? []).map((entry) => entry.trim()).filter(Boolean)
}

/**
 * Decide which HyperDHT clients may use a tunnel. A client is let in when its public key or
 * its address is listed; with both lists empty, every client is. Invalid entries throw.
 *
 * The address is the UDP address the connection uses. A client on the operator's LAN
 * connects over the LAN and shows a private address, and a connection relayed through
 * another HyperDHT node shows the relay's address, so it is refused unless its key is listed.
 */
export function createAllowlist(options: AllowlistOptions = {}): Allowlist {
  const keyEntries = cleanEntries(options.keys)
  const ipEntries = cleanEntries(options.ips)
  const keys = parseKeys(keyEntries)
  const ips = parseIps(ipEntries)
  const enabled = keys.size > 0 || ipEntries.length > 0

  const keyAllowed = (publicKey: Uint8Array | null | undefined): boolean =>
    publicKey != null && keys.has(Buffer.from(publicKey).toString('hex'))

  const ipAllowed = (host: string | null): boolean => {
    if (!host) return false
    const family = ipFamily(host)
    return family !== null && ips.check(host, family)
  }

  return {
    enabled,
    summary: enabled ? `keys=${keys.size} ips=${ipEntries.join(',') || 'none'}` : 'off',
    firewall: (remotePublicKey) => {
      if (!enabled || ipEntries.length > 0) return false
      return !keyAllowed(remotePublicKey)
    },
    check: (stream) => {
      const host = normalizeHost(stream.rawStream?.remoteHost)
      if (!enabled) return { ok: true, host, by: 'open' }
      if (keyAllowed(stream.remotePublicKey)) return { ok: true, host, by: 'key' }
      if (ipAllowed(host)) return { ok: true, host, by: 'ip' }
      return { ok: false, host, by: 'none' }
    },
  }
}

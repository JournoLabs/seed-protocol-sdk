import { promises as dnsPromises } from 'node:dns'
import {
  buildDomainOwnershipTxtValue,
  parseDomainOwnershipTxtValue,
} from '@seedprotocol/eas'
import type { DomainOwnershipChallenge } from './challenge'

export type DnsTxtLookupResult = {
  source: string
  values: string[]
  dnssecAuthenticated?: boolean
}

export type VerifyDomainOwnershipDnsResult = {
  ok: boolean
  matchedSources: string[]
  lookups: DnsTxtLookupResult[]
  error?: string
}

type DohAnswer = { name?: string; type?: number; data?: string; TTL?: number }
type DohResponse = { Status?: number; AD?: boolean; Answer?: DohAnswer[] }

async function lookupNodeDns(name: string): Promise<DnsTxtLookupResult> {
  const records = await dnsPromises.resolveTxt(name)
  const values = records.map((chunks) => chunks.join(''))
  return { source: 'node:dns', values }
}

async function lookupDoh(
  name: string,
  source: string,
  endpoint: string,
): Promise<DnsTxtLookupResult> {
  const url = `${endpoint}?name=${encodeURIComponent(name)}&type=TXT`
  const res = await fetch(url, {
    headers: { accept: 'application/dns-json' },
  })
  if (!res.ok) {
    throw new Error(`DoH ${source} HTTP ${res.status}`)
  }
  const body = (await res.json()) as DohResponse
  const values = (body.Answer ?? [])
    .filter((a) => a.type === 16 && typeof a.data === 'string')
    .map((a) => a.data!.replace(/^"|"$/g, ''))
  return {
    source,
    values,
    dnssecAuthenticated: Boolean(body.AD),
  }
}

const DEFAULT_LOOKUPS: Array<(name: string) => Promise<DnsTxtLookupResult>> = [
  (name) => lookupNodeDns(name),
  (name) => lookupDoh(name, 'cloudflare-doh', 'https://cloudflare-dns.com/dns-query'),
  (name) => lookupDoh(name, 'google-doh', 'https://dns.google/resolve'),
]

function valuesMatchExpected(values: string[], expected: string): boolean {
  const expectedParsed = parseDomainOwnershipTxtValue(expected)
  for (const v of values) {
    if (v === expected || v.replace(/^"|"$/g, '') === expected) return true
    const parsed = parseDomainOwnershipTxtValue(v)
    if (
      expectedParsed &&
      parsed &&
      parsed.token === expectedParsed.token &&
      parsed.claimer === expectedParsed.claimer
    ) {
      return true
    }
  }
  return false
}

/**
 * Verify that the challenge TXT is visible via multiple DNS vantage points.
 * Requires quorum (≥2 matching sources) when no DNSSEC-authenticated match is seen.
 */
export async function verifyDomainOwnershipDns(
  challenge: DomainOwnershipChallenge,
  options?: {
    lookups?: Array<(name: string) => Promise<DnsTxtLookupResult>>
    /** Minimum matching sources when DNSSEC AD is not observed (default 2). */
    quorum?: number
    now?: number
  },
): Promise<VerifyDomainOwnershipDnsResult> {
  const now = options?.now ?? Date.now()
  if (Date.parse(challenge.expiresAt) <= now) {
    return {
      ok: false,
      matchedSources: [],
      lookups: [],
      error: 'Challenge expired',
    }
  }

  // Ensure expected TXT is canonical for this challenge material
  const expected = buildDomainOwnershipTxtValue({
    token: challenge.token,
    claimer: challenge.claimer,
    expiry: challenge.expiresAt,
  })
  if (expected !== challenge.txtValue) {
    return {
      ok: false,
      matchedSources: [],
      lookups: [],
      error: 'Challenge txtValue does not match token/claimer/expiry',
    }
  }

  const lookupFns = options?.lookups ?? DEFAULT_LOOKUPS
  const quorum = options?.quorum ?? 2
  const lookups: DnsTxtLookupResult[] = []
  const matchedSources: string[] = []
  let dnssecMatch = false

  await Promise.all(
    lookupFns.map(async (fn) => {
      try {
        const result = await fn(challenge.txtName)
        lookups.push(result)
        if (valuesMatchExpected(result.values, expected)) {
          matchedSources.push(result.source)
          if (result.dnssecAuthenticated) dnssecMatch = true
        }
      } catch (err) {
        lookups.push({
          source: 'error',
          values: [],
        })
        void err
      }
    }),
  )

  const ok = dnssecMatch || matchedSources.length >= quorum
  return {
    ok,
    matchedSources,
    lookups,
    error: ok
      ? undefined
      : `DNS TXT not confirmed (matched ${matchedSources.length}/${quorum} sources)`,
  }
}

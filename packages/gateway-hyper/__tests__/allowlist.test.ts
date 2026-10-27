import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import HyperDHT from 'hyperdht'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAllowlist, type AllowlistOptions } from '../src/tunnel/allowlist'
import { serveTunnel } from '../src/tunnel/serve'
import { createTunnelSession } from '../src/tunnel/session'
import { startTestnet, type LocalTestnet } from './helpers/testnet'

/**
 * Every address of this machine. A client on the operator's machine or LAN connects over the
 * LAN, so the operator sees one of these rather than 127.0.0.1, even on a loopback testnet.
 */
function ownAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .flatMap((iface) => (iface ? [iface.address.split('%')[0]!] : []))
}

const listed = HyperDHT.keyPair()
const unlisted = HyperDHT.keyPair()

function fakeStream(publicKey: Buffer, remoteHost: string | null) {
  return { remotePublicKey: publicKey, rawStream: { remoteHost } }
}

describe('createAllowlist', () => {
  it('lets everyone in with no entries', () => {
    const allow = createAllowlist({ keys: [' '], ips: [] })
    expect(allow.enabled).toBe(false)
    expect(allow.summary).toBe('off')
    expect(allow.firewall(unlisted.publicKey)).toBe(false)
    expect(allow.check(fakeStream(unlisted.publicKey, '198.51.100.1'))).toMatchObject({
      ok: true,
      by: 'open',
    })
  })

  it('lets a listed key in from any address, given as z32 or hex', () => {
    const z32 = createAllowlist({ keys: [HyperDHT.keyPair().publicKey.toString('hex')] })
    expect(z32.check(fakeStream(listed.publicKey, '198.51.100.1')).ok).toBe(false)
    const allow = createAllowlist({ keys: [listed.publicKey.toString('hex')], ips: ['10.0.0.1'] })
    expect(allow.check(fakeStream(listed.publicKey, '198.51.100.1'))).toMatchObject({
      ok: true,
      by: 'key',
    })
  })

  it('refuses an unlisted key from an unlisted address', () => {
    const allow = createAllowlist({ keys: [listed.publicKey.toString('hex')], ips: ['10.0.0.0/8'] })
    expect(allow.check(fakeStream(unlisted.publicKey, '198.51.100.1'))).toEqual({
      ok: false,
      host: '198.51.100.1',
      by: 'none',
    })
    expect(allow.check(fakeStream(unlisted.publicKey, null)).ok).toBe(false)
  })

  it('matches addresses and CIDR ranges, IPv4 and IPv6', () => {
    const allow = createAllowlist({ ips: ['203.0.113.7', '192.168.1.0/24', '2001:db8::/32'] })
    const by = (host: string) => allow.check(fakeStream(unlisted.publicKey, host))
    expect(by('203.0.113.7')).toMatchObject({ ok: true, by: 'ip' })
    expect(by('203.0.113.8').ok).toBe(false)
    expect(by('192.168.1.42')).toMatchObject({ ok: true, by: 'ip' })
    expect(by('192.168.2.1').ok).toBe(false)
    expect(by('2001:db8:1::5').ok).toBe(true)
    expect(by('2001:db9::1').ok).toBe(false)
  })

  it('matches an IPv4-mapped IPv6 address against IPv4 entries', () => {
    const allow = createAllowlist({ ips: ['192.168.1.0/24'] })
    expect(allow.check(fakeStream(unlisted.publicKey, '::ffff:192.168.1.9'))).toEqual({
      ok: true,
      host: '192.168.1.9',
      by: 'ip',
    })
    expect(allow.check(fakeStream(unlisted.publicKey, '::FFFF:192.168.3.9')).ok).toBe(false)
  })

  it('refuses on the key in the firewall only when no IP list is set', () => {
    const keysOnly = createAllowlist({ keys: [listed.publicKey.toString('hex')] })
    expect(keysOnly.firewall(unlisted.publicKey)).toBe(true)
    expect(keysOnly.firewall(listed.publicKey)).toBe(false)
    const both = createAllowlist({ keys: [listed.publicKey.toString('hex')], ips: ['10.0.0.0/8'] })
    expect(both.firewall(unlisted.publicKey)).toBe(false)
  })

  it.each([
    [{ ips: ['not-an-ip'] }, /Invalid allowlist IP/],
    [{ ips: ['10.0.0.0/33'] }, /CIDR prefix/],
    [{ ips: ['10.0.0.0/x'] }, /CIDR prefix/],
    [{ ips: ['10.0.0.0/8/1'] }, /Invalid allowlist IP/],
    [{ keys: ['nope'] }, /Invalid Gateway Hyper key/],
  ] as [AllowlistOptions, RegExp][])('throws on an invalid entry: %j', (options, message) => {
    expect(() => createAllowlist(options)).toThrow(message)
  })
})

describe('serveTunnel allowlist over HyperDHT', () => {
  let testnet: LocalTestnet
  let upstream: http.Server
  let upstreamUrl: string
  let requests = 0

  beforeAll(async () => {
    testnet = await startTestnet()
    upstream = http.createServer((_req, res) => {
      requests++
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
    const addr = upstream.address()
    if (!addr || typeof addr === 'string') throw new Error('upstream address unavailable')
    upstreamUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await testnet.destroy()
  })

  /** Serve with `allowlist`, send one GET as `client`, and report what happened. */
  async function tryRequest(allowlist: AllowlistOptions, client: { publicKey: Buffer; secretKey: Buffer }) {
    const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-allow-')), 'op.json')
    const operator = await serveTunnel({
      upstream: upstreamUrl,
      keyFile,
      allowlist,
      bootstrap: testnet.bootstrap,
    })
    const session = await createTunnelSession({
      key: operator.key,
      keyPair: client,
      bootstrap: testnet.bootstrap,
      connectTimeoutMs: 5000,
      requestTimeoutMs: 5000,
    })
    const before = requests
    try {
      const res = await session.forwardHttp({ method: 'GET', path: '/', headers: {} }, Buffer.alloc(0))
      return { ok: true as const, status: res.meta.status, upstreamHit: requests > before }
    } catch (err) {
      return { ok: false as const, error: err as Error, upstreamHit: requests > before }
    } finally {
      await session.close()
      await operator.close()
    }
  }

  it('accepts a listed key', async () => {
    const result = await tryRequest({ keys: [listed.publicKey.toString('hex')] }, listed)
    expect(result).toMatchObject({ ok: true, status: 200, upstreamHit: true })
  }, 30_000)

  it('refuses an unlisted key in the firewall', async () => {
    const result = await tryRequest({ keys: [listed.publicKey.toString('hex')] }, unlisted)
    expect(result).toMatchObject({ ok: false, upstreamHit: false })
  }, 30_000)

  it('accepts a client whose address is in a listed range', async () => {
    const result = await tryRequest({ ips: ownAddresses() }, unlisted)
    expect(result).toMatchObject({ ok: true, status: 200, upstreamHit: true })
  }, 30_000)

  it('refuses a client whose address is not listed, before reading from it, with a 403 it can read', async () => {
    const result = await tryRequest(
      { keys: [listed.publicKey.toString('hex')], ips: ['198.51.100.0/24'] },
      unlisted,
    )
    expect(result).toMatchObject({ ok: true, status: 403, upstreamHit: false })
  }, 30_000)

  it('lets a listed key in when its address is not listed', async () => {
    const result = await tryRequest(
      { keys: [listed.publicKey.toString('hex')], ips: ['198.51.100.0/24'] },
      listed,
    )
    expect(result).toMatchObject({ ok: true, status: 200, upstreamHit: true })
  }, 30_000)
})

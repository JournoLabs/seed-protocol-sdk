import { describe, expect, it } from 'vitest'
import { parseCli } from '../src/cli'

const A = '0xABCDEF0123456789abcdef0123456789abcdef01'
const B = '0x' + '2'.repeat(40)

describe('parseCli', () => {
  it('takes publishers from repeated --attester flags and SEED_MCP_ATTESTERS, lower case and once each', () => {
    expect(parseCli(['--attester', A, '--attester', B], { SEED_MCP_ATTESTERS: ` ${A.toLowerCase()}, ` })).toEqual({
      kind: 'run',
      options: { attesters: [A.toLowerCase(), B] },
    })
  })

  it('runs with no publishers when none are given', () => {
    expect(parseCli([], {})).toEqual({ kind: 'run', options: { attesters: [] } })
  })

  it('rejects an attester that is not an address', () => {
    const result = parseCli(['--attester', 'alice.eth'], {})
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.message).toContain('alice.eth')
  })

  it('rejects an unknown flag', () => {
    expect(parseCli(['--everyone'], {}).kind).toBe('error')
  })

  it('prints help', () => {
    expect(parseCli(['-h'], {})).toEqual({ kind: 'help' })
  })

  it('serves HTTP with defaults for port, host and rate limit', () => {
    expect(parseCli(['--http'], {})).toEqual({
      kind: 'run',
      options: { attesters: [] },
      http: { port: 3000, host: '127.0.0.1', allowedOrigins: [], rateLimit: 120, trustProxy: false },
    })
  })

  it('reads the HTTP flags', () => {
    const result = parseCli(
      ['--http', '--port', '8080', '--host', '0.0.0.0', '--allowed-origin', 'https://a.example', '--rate-limit', '0', '--trust-proxy'],
      {},
    )
    expect(result.kind === 'run' && result.http).toEqual({
      port: 8080,
      host: '0.0.0.0',
      allowedOrigins: ['https://a.example'],
      rateLimit: 0,
      trustProxy: true,
    })
  })

  it('rejects HTTP flags without --http, a bad port and an origin with a path', () => {
    expect(parseCli(['--port', '8080'], {})).toEqual({ kind: 'error', message: '--port needs --http' })
    expect(parseCli(['--http', '--port', '70000'], {}).kind).toBe('error')
    expect(parseCli(['--http', '--allowed-origin', 'https://a.example/app'], {}).kind).toBe('error')
  })
})

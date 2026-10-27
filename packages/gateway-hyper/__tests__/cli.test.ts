import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main, parseBootstrap } from '../src/cli'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('seed-gateway --help', () => {
  it('prints only the usage of the command asked about', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['serve', '--help'])
    const serve = String(log.mock.calls[0]?.[0])
    expect(serve).toContain('seed-gateway serve')
    expect(serve).not.toContain('seed-gateway connect')
    await main(['connect', '-h'])
    expect(String(log.mock.calls[1]?.[0])).not.toContain('seed-gateway serve')
  })
})

describe('seed-gateway flags', () => {
  it('warns about a flag the chosen mode ignores', async () => {
    const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-cli-')), 'client.key.json')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await main(['connect', '--print-key', '--key-file', keyFile, '--trace'])
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[Seed Protocol] --trace has no effect with connect --print-key; ignoring it.',
    ])
  })

  it('reads --bootstrap as host:port nodes', () => {
    expect(parseBootstrap('127.0.0.1:49737, [::1]:49738')).toEqual([
      { host: '127.0.0.1', port: 49737 },
      { host: '::1', port: 49738 },
    ])
    expect(parseBootstrap(undefined)).toBeUndefined()
  })
})

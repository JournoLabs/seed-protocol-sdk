import { afterAll, describe, expect, test } from 'bun:test'
import { entryPoint06Address, entryPoint08Address } from 'viem/account-abstraction'
import { assertBundlerSupportsEntryPoint08 } from './permissionlessTxSender'

let entryPoints: unknown = []
const server = Bun.serve({
  port: 0,
  fetch: () => Response.json({ jsonrpc: '2.0', id: 1, result: entryPoints }),
})
const url = `http://127.0.0.1:${server.port}`

afterAll(() => {
  server.stop(true)
})

describe('assertBundlerSupportsEntryPoint08', () => {
  test('rejects a v0.6-only bundler and points at thirdweb.bundlerUrl', async () => {
    entryPoints = [entryPoint06Address]
    await expect(assertBundlerSupportsEntryPoint08(url)).rejects.toThrow(/thirdweb\.bundlerUrl/)
  })

  test('accepts a bundler that lists v0.8', async () => {
    entryPoints = [entryPoint06Address, entryPoint08Address.toLowerCase()]
    await expect(assertBundlerSupportsEntryPoint08(url)).resolves.toBeUndefined()
  })

  test('lets through a bundler that does not answer eth_supportedEntryPoints', async () => {
    entryPoints = undefined
    await expect(assertBundlerSupportsEntryPoint08(url)).resolves.toBeUndefined()
    await expect(assertBundlerSupportsEntryPoint08('http://127.0.0.1:1')).resolves.toBeUndefined()
  })
})

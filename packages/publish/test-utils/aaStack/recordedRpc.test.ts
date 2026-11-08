import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRecordedRpc } from './recordedRpc'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A stand-in upstream that answers with `replies` in turn, then with the last one. */
function upstream(replies: ({ status: number } | { body: unknown })[]) {
  let calls = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => {
      const reply = replies[Math.min(calls++, replies.length - 1)]!
      return 'status' in reply ? new Response('slow down', { status: reply.status }) : Response.json(reply.body)
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, calls: () => calls, stop: () => server.stop(true) }
}

async function ask(url: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'eth_getStorageAt', params: ['0x42', '0x1', 'latest'] }),
  })
  return (await res.json()) as { result?: unknown; error?: unknown }
}

describe('recordedRpc', () => {
  test('records the answer after the upstream stops rate-limiting, never the rate-limit error', async () => {
    const limited = { body: { jsonrpc: '2.0', id: 1, error: { code: -32016, message: 'requests per second capacity' } } }
    const up = upstream([limited, { status: 429 }, { body: { jsonrpc: '2.0', id: 1, result: '0x05' } }])
    const dir = mkdtempSync(join(tmpdir(), 'recorded-rpc-'))
    dirs.push(dir)
    const fixturePath = join(dir, 'fixture.json')
    const rpc = startRecordedRpc({ fixturePath, mode: 'record', upstream: up.url, forkBlock: 1 })

    expect(await ask(rpc.url)).toMatchObject({ id: 7, result: '0x05' })
    expect(up.calls()).toBe(3)
    await rpc.stop()
    up.stop()

    const answers = Object.values(JSON.parse(readFileSync(fixturePath, 'utf8')).answers)
    expect(answers).toEqual([{ result: '0x05' }])
    const replay = startRecordedRpc({ fixturePath, mode: 'replay', forkBlock: 1 })
    expect(await ask(replay.url)).toMatchObject({ result: '0x05' })
    await replay.stop()
  }, 20_000)

  test("keeps an upstream error that isn't a rate limit, as the chain's answer", async () => {
    const up = upstream([{ body: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'rpc method is not whitelisted' } } }])
    const dir = mkdtempSync(join(tmpdir(), 'recorded-rpc-'))
    dirs.push(dir)
    const fixturePath = join(dir, 'fixture.json')
    const rpc = startRecordedRpc({ fixturePath, mode: 'record', upstream: up.url, forkBlock: 1 })
    expect(await ask(rpc.url)).toMatchObject({ error: { code: -32601 } })
    expect(up.calls()).toBe(1)
    await rpc.stop()
    up.stop()
    expect(Object.values(JSON.parse(readFileSync(fixturePath, 'utf8')).answers)).toEqual([{ error: { code: -32601, message: 'rpc method is not whitelisted' } }])
  })
})

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

type RpcRequest = { jsonrpc: '2.0'; id: unknown; method: string; params?: unknown }
type RecordedAnswer = { result: unknown } | { error: unknown }

export type RecordedRpcFixture = {
  /** Where the answers were recorded from. */
  upstream: string
  forkBlock: number
  /** `JSON.stringify([method, params])` to the upstream's answer. */
  answers: Record<string, RecordedAnswer>
}

export type RecordedRpc = {
  url: string
  /** Requests replay had no answer for, as `method params`. */
  misses: string[]
  /** Stops the server; in record mode, writes the fixture. */
  stop: () => Promise<void>
}

const keyOf = (req: RpcRequest) => JSON.stringify([req.method, req.params ?? []])

/**
 * Lookups by transaction hash. Anvil forwards them to the upstream for a transaction it hasn't
 * mined yet, and the upstream never has one the test sent, so the answer is always null. Hashes
 * can differ between runs (fees, timing), so replay answers these without a recorded entry.
 */
const TX_HASH_LOOKUPS = new Set(['eth_getTransactionReceipt', 'eth_getTransactionByHash'])

/**
 * A JSON-RPC server standing in for a public chain RPC, so a fork of it runs with no network.
 *
 * `record` forwards each request it has no answer for to `upstream`, and on `stop()` writes the
 * fixture with the new answers added.
 * `replay` answers from that file and errors on anything not in it. Anvil asks a fork's upstream
 * only for state at the pinned block, so the same test run asks the same questions each time.
 */
export function startRecordedRpc(options: {
  fixturePath: string
  mode: 'record' | 'replay'
  upstream?: string
  forkBlock: number
}): RecordedRpc {
  const { fixturePath, mode, forkBlock } = options
  // Recording adds to the fixture rather than replacing it, so recording one test file keeps the
  // answers other files replay. A fixture for another block is started over.
  const existing = existsSync(fixturePath) ? (JSON.parse(readFileSync(fixturePath, 'utf8')) as RecordedRpcFixture) : undefined
  const answers: Record<string, RecordedAnswer> =
    mode === 'replay' ? existing!.answers : existing?.forkBlock === forkBlock ? { ...existing.answers } : {}
  const misses: string[] = []

  const answer = async (req: RpcRequest): Promise<Record<string, unknown>> => {
    const key = keyOf(req)
    if (mode === 'record' && !(key in answers)) {
      const res = await fetch(options.upstream!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: req.method, params: req.params ?? [] }),
      })
      const body = (await res.json()) as { result?: unknown; error?: unknown }
      answers[key] = 'error' in body && body.error !== undefined ? { error: body.error } : { result: body.result }
    }
    const recorded = answers[key] ?? (TX_HASH_LOOKUPS.has(req.method) ? { result: null } : undefined)
    if (!recorded) {
      misses.push(`${req.method} ${JSON.stringify(req.params ?? [])}`)
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32000, message: `not in the recorded fork fixture: ${req.method}` },
      }
    }
    return { jsonrpc: '2.0', id: req.id, ...recorded }
  }

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const body = (await request.json()) as RpcRequest | RpcRequest[]
      return Response.json(Array.isArray(body) ? await Promise.all(body.map(answer)) : await answer(body))
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    misses,
    stop: async () => {
      server.stop(true)
      if (mode !== 'record') return
      const sorted = Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)))
      const fixture: RecordedRpcFixture = { upstream: options.upstream!, forkBlock, answers: sorted }
      writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 1)}\n`)
    },
  }
}

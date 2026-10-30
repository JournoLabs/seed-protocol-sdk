import Arweave from 'arweave'
import type { JWKInterface } from 'arweave/node/lib/wallet'
import {
  BaseArweaveClient,
  DEFAULT_ARWEAVE_HOST,
  invalidateReadGatewayCache,
  setPreferredArweaveReadBaseUrls,
} from '@seedprotocol/arweave'

/**
 * A local Arweave node for tests (arlocal: a real HTTP gateway API backed by SQLite), so tests of
 * the Arweave client make real requests without depending on a public gateway's uptime.
 *
 * `start()` picks a free port; `postTransaction` signs, posts and mines a transaction so it is
 * served at `/raw/<id>`, `/<id>` and through GraphQL right away.
 *
 * arlocal 1.1.66 has no `/raw/<id>` route, which ar.io gateways serve and `downloadFiles` reads,
 * so the tests talk to a small server in front of it that answers `/raw/<id>` from arlocal's
 * `/<id>` and passes every other request through unchanged. That server is also where
 * `failRawRead` makes a gateway error happen, which arlocal has no way to do.
 */
export type LocalArweave = {
  /** `http://127.0.0.1:<port>` */
  baseUrl: string
  host: string
  arweave: Arweave
  /** Signs and posts a transaction, and mines it unless `mine` is false. */
  postTransaction: (
    data: string | Uint8Array,
    tags?: { name: string; value: string }[],
    options?: { mine?: boolean },
  ) => Promise<string>
  /** `/raw/<id>` answers `status` from now on. */
  failRawRead: (transactionId: string, status: number) => void
  stop: () => Promise<void>
}

type ArLocalInstance = { start: () => Promise<void>; stop: () => Promise<void> }

const freePort = async (): Promise<number> => {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

/** Forwards to arlocal on `targetPort`, serving `/raw/<id>` from `/<id>`. */
async function startRawRoute(
  targetPort: number,
  failedReads: Map<string, number>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const { createServer } = await import('node:http')
  const server = createServer(async (req, res) => {
    try {
      const failure = failedReads.get((req.url ?? '').replace(/^\/raw\//, ''))
      if (failure !== undefined && req.url?.startsWith('/raw/')) {
        res.writeHead(failure)
        res.end()
        return
      }
      const path = (req.url ?? '/').replace(/^\/raw\//, '/')
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const upstream = await fetch(`http://127.0.0.1:${targetPort}${path}`, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter((e): e is [string, string] => typeof e[1] === 'string' && e[0] !== 'host'),
        ),
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      })
      res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([k]) => k !== 'content-encoding' && k !== 'content-length')))
      res.end(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      res.writeHead(502)
      res.end(String(error))
    }
  })
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

export async function startLocalArweave(): Promise<LocalArweave> {
  const mod = (await import('arlocal')) as unknown as { default: { default?: unknown } }
  const ArLocal = (mod.default.default ?? mod.default) as new (port: number, showLogs: boolean) => ArLocalInstance
  const node = new ArLocal(await freePort(), false)
  await node.start()
  const nodePort = (node as unknown as { port: number }).port
  const failedReads = new Map<string, number>()
  const front = await startRawRoute(nodePort, failedReads)

  const port = front.port
  const host = `127.0.0.1:${port}`
  const baseUrl = `http://${host}`
  const arweave = Arweave.init({ host: '127.0.0.1', port, protocol: 'http' })
  const wallet: JWKInterface = await arweave.wallets.generate()
  const address = await arweave.wallets.jwkToAddress(wallet)
  const mint = await fetch(`${baseUrl}/mint/${address}/1000000000000000`)
  if (!mint.ok) throw new Error(`arlocal mint failed: ${mint.status}`)

  return {
    baseUrl,
    host,
    arweave,
    async postTransaction(data, tags = [], { mine = true } = {}) {
      const tx = await arweave.createTransaction({ data }, wallet)
      for (const tag of tags) tx.addTag(tag.name, tag.value)
      await arweave.transactions.sign(tx, wallet)
      const posted = await arweave.transactions.post(tx)
      if (posted.status !== 200) throw new Error(`arlocal post failed: ${posted.status}`)
      if (mine) {
        const mined = await fetch(`${baseUrl}/mine`)
        if (!mined.ok) throw new Error(`arlocal mine failed: ${mined.status}`)
      }
      return tx.id
    },
    failRawRead(transactionId, status) {
      failedReads.set(transactionId, status)
    },
    async stop() {
      await front.close()
      await node.stop()
    },
  }
}

/**
 * Points the Arweave client at `node` alone: reads are pinned with `ARWEAVE_READ_GATEWAYS`, so the
 * public fallbacks are never asked. Returns a function that restores the default host.
 */
export function pinArweaveClientTo(node: LocalArweave): () => void {
  const previousReadGateways = process.env.ARWEAVE_READ_GATEWAYS
  process.env.ARWEAVE_READ_GATEWAYS = node.host
  BaseArweaveClient.setHost(node.baseUrl)
  setPreferredArweaveReadBaseUrls([])
  BaseArweaveClient.resetReadGatewaySelectionStateForTests()
  invalidateReadGatewayCache()
  return () => {
    if (previousReadGateways === undefined) delete process.env.ARWEAVE_READ_GATEWAYS
    else process.env.ARWEAVE_READ_GATEWAYS = previousReadGateways
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
    invalidateReadGatewayCache()
  }
}

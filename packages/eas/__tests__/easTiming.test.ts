import debug from 'debug'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { createEasGraphQLClient } from '../src/EasClient/createEasGraphQLClient.js'
import { BaseQueryClient } from '../src/QueryClient/BaseQueryClient.js'
import { DefaultQueryClient } from '../src/default/QueryClient.js'
import { getItemVersionsFromEas } from '../src/api.js'
import { fetchEasModelSchemas } from '../src/modelSchemas.js'
import { easTimingLogger, timedFetchQuery } from '../src/easTiming.js'

const seedUids = ['0x' + '01'.repeat(32), '0x' + '02'.repeat(32), '0x' + '03'.repeat(32)]
const versions = [{ id: 'v1' }, { id: 'v2' }]
const responseBody = JSON.stringify({ data: { itemVersions: versions } })

const indexerFetch = vi.fn(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20))
  return new Response(responseBody, { headers: { 'content-type': 'application/json' } })
})

let lines: string[]
const originalLog = easTimingLogger.log

beforeEach(() => {
  lines = []
  easTimingLogger.log = (...args: unknown[]) => lines.push(String(args[0]))
  vi.stubGlobal('fetch', indexerFetch)
  const client = createEasGraphQLClient('https://indexer.example.com/graphql')
  BaseEasClient.configure({ getEasClient: () => client })
  BaseQueryClient.configure(new DefaultQueryClient())
})

afterEach(() => {
  debug.disable()
  easTimingLogger.log = originalLog
  vi.unstubAllGlobals()
  indexerFetch.mockClear()
})

/** debug adds the namespace, a timestamp or diff and colour codes depending on the terminal; this drops them. */
const plain = (line: string) =>
  line
    .replace(/\u001b\[[\d;]*m/g, '')
    .replace(/^.*?seedEas:timing\s+/, '')
    .replace(/\s+\+\d+m?s$/, '')

describe('EAS request timing', () => {
  it('logs one request line and a source per fetchQuery call when seedEas:timing is on', async () => {
    debug.enable('seedEas:timing')

    const [a, b] = await Promise.all([getItemVersionsFromEas({ seedUids }), getItemVersionsFromEas({ seedUids })])
    expect(a).toEqual(versions)
    expect(b).toEqual(versions)
    expect(indexerFetch).toHaveBeenCalledTimes(1)

    const out = lines.map(plain)
    const requests = out.filter((line) => line.startsWith('request '))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatch(
      new RegExp(`^request GetVersions refUID\\.in=3 rows=2 bytes=${responseBody.length} \\d+ms`),
    )

    const sources = out.filter((line) => line.startsWith('fetchQuery ')).map((line) => line.split(' ')[2])
    expect(sources.sort()).toEqual(['deduped', 'network'])
    expect(out.find((line) => line.includes(' network '))).toMatch(/^fetchQuery getVersionsForAllModels network \d+ms$/)
  })

  it('reports a result the query client kept as cache', async () => {
    debug.enable('seedEas:timing')
    const queryClient = BaseQueryClient.getQueryClient()
    const options = { queryKey: ['timingCacheCheck'], queryFn: async () => 1, staleTime: 60_000 }

    await timedFetchQuery(queryClient, options)
    await timedFetchQuery(queryClient, options)

    expect(lines.map(plain).map((line) => line.split(' ')[2])).toEqual(['network', 'cache'])
  })

  it('logs nothing when the namespace is off', async () => {
    debug.disable()
    expect(await getItemVersionsFromEas({ seedUids })).toEqual(versions)
    expect(indexerFetch).toHaveBeenCalledTimes(1)
    expect(lines).toEqual([])
  })

  it('logs the model schema lookup', async () => {
    debug.enable('seedEas:timing')
    await fetchEasModelSchemas([{ name: 'Post', level: 'exact' }])
    expect(lines.map(plain).some((line) => /^fetchQuery fetchEasModelSchemas network \d+ms$/.test(line))).toBe(true)
  })

})

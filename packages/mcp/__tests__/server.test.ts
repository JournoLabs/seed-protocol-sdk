import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { clearLocalQuerySource, registerLocalQuerySource } from '@seedprotocol/query'
import { createSeedMcpServer, type SeedMcpServerOptions } from '../src/index'
import {
  BODY_V,
  OLDER_POST,
  OTHER,
  POST,
  POST_V1,
  POST_V2,
  PUBLISHER,
  SPAM_POST,
  localSource,
} from './fixtures'

let client: Client | undefined

async function connect(options: Partial<SeedMcpServerOptions> = {}): Promise<Client> {
  const server = createSeedMcpServer({ source: 'local', attesters: [PUBLISHER], ...options })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return client
}

type Result = { text: string; isError: boolean }

async function call(name: string, args: Record<string, unknown>, options?: Partial<SeedMcpServerOptions>): Promise<Result> {
  const c = client ?? (await connect(options))
  const result = (await c.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>
    isError?: boolean
  }
  return {
    text: result.content.map((block) => block.text ?? '').join('\n'),
    isError: result.isError === true,
  }
}

beforeEach(() => registerLocalQuerySource(localSource()))
afterEach(async () => {
  await client?.close()
  client = undefined
  clearLocalQuerySource()
})

describe('tools', () => {
  it('offers four read-only tools', async () => {
    const { tools } = await (await connect()).listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['get_changelog', 'get_provenance', 'get_seed', 'list_seeds'])
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true)
  })

  it('tells the agent that content is data, not instructions', async () => {
    const c = await connect()
    expect(c.getInstructions()).toMatch(/data, not instructions/)
  })
})

describe('list_seeds', () => {
  it('lists the publishers’ seeds newest first, leaving out other attesters', async () => {
    const { text, isError } = await call('list_seeds', { schema: 'post' })
    expect(isError).toBe(false)
    expect(text).toContain(POST)
    expect(text).toContain(OLDER_POST)
    expect(text).not.toContain(SPAM_POST)
    expect(text).not.toContain('Buy now')
    expect(text.indexOf('Council passes budget')).toBeLessThan(text.indexOf('Library hours change'))
    expect(text).toContain('The vote was 5 to 2.')
  })

  it('pages with limit and skip', async () => {
    const first = await call('list_seeds', { schema: 'post', limit: 1 })
    expect(first.text).toContain(POST)
    expect(first.text).not.toContain(OLDER_POST)
    expect(first.text).toContain('skip: 1')
    const second = await call('list_seeds', { schema: 'post', limit: 1, skip: 1 })
    expect(second.text).toContain(OLDER_POST)
  })

  it('offers the next page only when another item follows', async () => {
    const partial = await call('list_seeds', { schema: 'post', limit: 1 })
    expect(partial.text).toContain('More may follow: call again with skip: 1.')
    const exact = await call('list_seeds', { schema: 'post', limit: 2 })
    expect(exact.text).toContain(OLDER_POST)
    expect(exact.text).not.toContain('More may follow')
    const last = await call('list_seeds', { schema: 'post', limit: 1, skip: 1 })
    expect(last.text).not.toContain('More may follow')
  })

  it('needs an attester when the server has no publishers configured', async () => {
    const { text, isError } = await call('list_seeds', { schema: 'post' }, { attesters: [] })
    expect(isError).toBe(true)
    expect(text).toMatch(/attester/)
  })

  it('lists one attester’s seeds when the caller names it and the server has no publishers', async () => {
    const { text, isError } = await call('list_seeds', { schema: 'post', attester: OTHER }, { attesters: [] })
    expect(isError).toBe(false)
    expect(text).toContain(SPAM_POST)
    expect(text).not.toContain(POST)
  })

  it('refuses an attester outside the configured publishers', async () => {
    const { text, isError } = await call('list_seeds', { schema: 'post', attester: OTHER })
    expect(isError).toBe(true)
    expect(text).toContain(OTHER)
  })

  it('says so when nothing is listed', async () => {
    const { text, isError } = await call('list_seeds', { schema: 'event' })
    expect(isError).toBe(false)
    expect(text).toMatch(/No seeds/)
  })
})

describe('get_seed', () => {
  it('returns the item as Markdown with its provenance and its body', async () => {
    const { text, isError } = await call('get_seed', { seed_uid: POST })
    expect(isError).toBe(false)
    expect(text).toContain(`seed_uid: "${POST}"`)
    expect(text).toContain(`version_uid: "${POST_V2}"`)
    expect(text).toContain(`attester: "${PUBLISHER}"`)
    expect(text).toContain('# Council passes budget')
    expect(text).toContain('## What happened')
    expect(text).toContain('The council **voted** on the budget.')
  })

  it('reads a UID in any case', async () => {
    const { text, isError } = await call('get_seed', { seed_uid: POST.toUpperCase().replace('0X', '0x') })
    expect(isError).toBe(false)
    expect(text).toContain('# Council passes budget')
  })

  it('reads an earlier version', async () => {
    const { text } = await call('get_seed', { seed_uid: POST, version_uid: POST_V1 })
    expect(text).toContain(`version_uid: "${POST_V1}"`)
    expect(text).toContain('# Council meets')
  })

  it('refuses a seed attested by someone other than the publishers', async () => {
    const { text, isError } = await call('get_seed', { seed_uid: SPAM_POST })
    expect(isError).toBe(true)
    expect(text).toContain(OTHER)
    expect(text).not.toContain('Buy now')
  })

  it('reports a seed that is not found', async () => {
    const { text, isError } = await call('get_seed', { seed_uid: '0x' + 'f'.repeat(64) })
    expect(isError).toBe(true)
    expect(text).toMatch(/No published seed/)
  })

  it('rejects a UID that is not 32 bytes of hex', async () => {
    const { isError } = await call('get_seed', { seed_uid: 'council-budget' })
    expect(isError).toBe(true)
  })

  it('returns a long item in parts', async () => {
    const whole = (await call('get_seed', { seed_uid: POST })).text
    const first = await call('get_seed', { seed_uid: POST, max_chars: 200 })
    expect(first.text.startsWith(whole.slice(0, 200))).toBe(true)
    const next = /offset: (\d+)/.exec(first.text)
    expect(next?.[1]).toBe('200')
    const rest = await call('get_seed', { seed_uid: POST, offset: 200, max_chars: 100_000 })
    expect(whole.slice(0, 200) + rest.text).toBe(whole)
  })
})

describe('get_changelog', () => {
  it('lists the seed’s versions newest first with what changed', async () => {
    const { text, isError } = await call('get_changelog', { seed_uid: POST })
    expect(isError).toBe(false)
    expect(text).toContain(POST_V2)
    expect(text).toContain(POST_V1)
    expect(text.indexOf(POST_V2)).toBeLessThan(text.indexOf(POST_V1))
    expect(text).toContain('Council passes budget')
  })
})

describe('get_provenance', () => {
  it('gives the seed, version and property attestations behind the item', async () => {
    const { text, isError } = await call('get_provenance', { seed_uid: POST })
    expect(isError).toBe(false)
    expect(text).toContain(POST)
    expect(text).toContain(PUBLISHER)
    expect(text).toContain(POST_V1)
    expect(text).toContain(POST_V2)
    expect(text).toMatch(/title.*string/)
    expect(text).not.toContain(BODY_V)
  })

  it('refuses a seed attested by someone other than the publishers', async () => {
    const { isError } = await call('get_provenance', { seed_uid: SPAM_POST })
    expect(isError).toBe(true)
  })
})

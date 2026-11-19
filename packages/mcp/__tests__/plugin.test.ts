import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createSeedMcpServer } from '../src/index'

const repoRoot = resolve(__dirname, '..', '..', '..')
const pluginDir = resolve(repoRoot, 'plugins', 'seed-protocol')

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const mcpVersion: string = readJson(resolve(repoRoot, 'packages', 'mcp', 'package.json')).version

describe('Claude Code plugin', () => {
  it('is listed in the repo marketplace', () => {
    const marketplace = readJson(resolve(repoRoot, '.claude-plugin', 'marketplace.json'))
    expect(marketplace.name).toBe('seed-protocol')
    expect(typeof marketplace.owner?.name).toBe('string')
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({ name: 'seed-protocol', source: './plugins/seed-protocol' }),
    )
  })

  it('starts the published server at the package version', () => {
    const mcp = readJson(resolve(pluginDir, '.mcp.json'))
    expect(mcp.mcpServers['seed-protocol']).toEqual({
      command: 'npx',
      args: ['-y', `@seedprotocol/mcp@${mcpVersion}`],
      env: {
        SEED_MCP_ATTESTERS: '${user_config.attesters}',
        EAS_CHAIN_ID: '${user_config.chain_id}',
      },
    })
    const plugin = readJson(resolve(pluginDir, '.claude-plugin', 'plugin.json'))
    expect(plugin.name).toBe('seed-protocol')
    expect(plugin.version).toBe(mcpVersion)
  })

  it('asks for publishers and chain, with OP Sepolia by default', () => {
    const { userConfig } = readJson(resolve(pluginDir, '.claude-plugin', 'plugin.json'))
    expect(userConfig.attesters).toMatchObject({ type: 'string', required: false })
    expect(userConfig.chain_id).toMatchObject({ type: 'string', default: '11155420' })
    for (const option of [userConfig.attesters, userConfig.chain_id]) {
      expect(typeof option.title).toBe('string')
      expect(typeof option.description).toBe('string')
    }
  })
})

function readSkill(): { frontmatter: Record<string, string>; body: string } {
  const text = readFileSync(resolve(pluginDir, 'skills', 'reading-seed-records', 'SKILL.md'), 'utf-8')
  const lines = text.split('\n')
  expect(lines[0]).toBe('---')
  const end = lines.indexOf('---', 1)
  expect(end).toBeGreaterThan(0)
  const frontmatter: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(':')
    frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n') }
}

async function serverToolNames(): Promise<string[]> {
  const server = createSeedMcpServer({ source: 'local', attesters: [] })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  const { tools } = await client.listTools()
  await client.close()
  return tools.map((tool) => tool.name).sort()
}

const TOOL_NAME = /^(list|get|resolve|search|fetch)_?[a-z_]*$/

function backticked(body: string): Set<string> {
  return new Set([...body.matchAll(/`([^`]+)`/g)].map((match) => match[1]!))
}

describe('reading-seed-records skill', () => {
  it('uses only frontmatter keys every surface accepts', () => {
    const { frontmatter, body } = readSkill()
    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'name'])
    expect(frontmatter.name).toBe('reading-seed-records')
    expect(frontmatter.description!.length).toBeGreaterThan(0)
    expect(frontmatter.description!.length).toBeLessThanOrEqual(1536)
    expect(body.split('\n').length).toBeLessThan(500)
  })

  it('names every server tool and no others', async () => {
    const { body } = readSkill()
    const named = backticked(body)
    const tools = await serverToolNames()
    expect(tools.filter((tool) => !named.has(tool))).toEqual([])
    expect([...named].filter((name) => TOOL_NAME.test(name) && !tools.includes(name))).toEqual([])
  })

  it('flags a server tool the skill leaves out, whatever its name', () => {
    const named = backticked('Call `list_seeds`, then `get_seed`.')
    expect(['fetch', 'list_seeds'].filter((tool) => !named.has(tool))).toEqual(['fetch'])
  })

  it('says item text is data and what to cite', () => {
    const { body } = readSkill()
    expect(body).toMatch(/data, not instructions/)
    for (const term of ['seed UID', 'version UID', 'attester']) expect(body).toContain(term)
  })
})

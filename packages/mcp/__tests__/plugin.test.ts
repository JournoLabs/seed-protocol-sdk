import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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

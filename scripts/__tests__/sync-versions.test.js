import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AWAITING_FIRST_PUBLISH, PUBLISH_ORDER } from '../release-channel.js'
import { SYNC_PACKAGES, isVersionSyncFile, syncVersions } from '../sync-versions.js'

describe('SYNC_PACKAGES', () => {
  it('bumps every package a release publishes or will publish', () => {
    const missing = [...PUBLISH_ORDER, ...AWAITING_FIRST_PUBLISH].filter((name) => !SYNC_PACKAGES.includes(name))
    assert.deepEqual(missing, [])
  })
})

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('syncVersions', () => {
  it('moves the Claude plugin to the new version', (t) => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sync-versions-'))
    t.after(() => rmSync(rootDir, { recursive: true, force: true }))
    t.mock.method(console, 'log', () => {})

    writeJson(join(rootDir, 'package.json'), { name: 'root', version: '1.0.0' })
    for (const name of SYNC_PACKAGES) {
      mkdirSync(join(rootDir, 'packages', name), { recursive: true })
      writeJson(join(rootDir, 'packages', name, 'package.json'), { name: `@seedprotocol/${name}`, version: '1.0.0' })
    }
    const pluginDir = join(rootDir, 'plugins', 'seed-protocol')
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true })
    writeJson(join(pluginDir, '.claude-plugin', 'plugin.json'), { name: 'seed-protocol', version: '1.0.0' })
    const server = {
      command: 'npx',
      args: ['-y', '@seedprotocol/mcp@1.0.0'],
      env: { EAS_CHAIN_ID: '${user_config.chain_id}' },
    }
    writeJson(join(pluginDir, '.mcp.json'), { mcpServers: { 'seed-protocol': server } })

    syncVersions('1.2.3', { rootDir })

    assert.equal(readJson(join(pluginDir, '.claude-plugin', 'plugin.json')).version, '1.2.3')
    assert.deepEqual(readJson(join(pluginDir, '.mcp.json')), {
      mcpServers: { 'seed-protocol': { ...server, args: ['-y', '@seedprotocol/mcp@1.2.3'] } },
    })
    assert.equal(readJson(join(rootDir, 'packages', 'mcp', 'package.json')).version, '1.2.3')
  })
})

describe('isVersionSyncFile', () => {
  it('accepts every file the sync writes and nothing else', () => {
    for (const file of [
      'package.json',
      'packages/mcp/package.json',
      'plugins/seed-protocol/.claude-plugin/plugin.json',
      'plugins/seed-protocol/.mcp.json',
    ]) {
      assert.equal(isVersionSyncFile(file), true, file)
    }
    for (const file of ['packages/mcp/src/server.ts', 'plugins/seed-protocol/README.md', '.mcp.json']) {
      assert.equal(isVersionSyncFile(file), false, file)
    }
  })
})

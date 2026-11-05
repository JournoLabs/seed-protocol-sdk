import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceSpecifiers } from '../check-publish-manifest.js'
import { AWAITING_FIRST_PUBLISH, PUBLISH_ORDER } from '../release-channel.js'
import { publishableManifest } from '../workspace-publish-manifest.js'

const rootDir = join(import.meta.dirname, '..', '..')
const scriptPath = join(rootDir, 'scripts', 'check-publish-manifest.js')
const PUBLIC_PACKAGES = [...PUBLISH_ORDER, ...AWAITING_FIRST_PUBLISH]

function runCheckIn(manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'check-publish-manifest-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    execFileSync(process.execPath, [scriptPath], { cwd: dir, stdio: 'pipe' })
    return { ok: true }
  } catch (error) {
    return { ok: false, stderr: String(error.stderr) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('workspaceSpecifiers', () => {
  it('names every workspace: specifier in each dependency field', () => {
    assert.deepEqual(
      workspaceSpecifiers({
        dependencies: { '@seedprotocol/eas': 'workspace:*', jsonld: '9.0.0' },
        peerDependencies: { '@seedprotocol/sdk': 'workspace:^' },
        devDependencies: { other: 'workspace:~' },
      }),
      [
        'dependencies.@seedprotocol/eas: workspace:*',
        'devDependencies.other: workspace:~',
        'peerDependencies.@seedprotocol/sdk: workspace:^',
      ],
    )
  })

  it('finds none in a manifest of plain ranges', () => {
    assert.deepEqual(workspaceSpecifiers({ dependencies: { a: '^1.0.0' } }), [])
  })
})

describe('check-publish-manifest CLI', () => {
  it('fails on a manifest that keeps a workspace: specifier and names it', () => {
    const result = runCheckIn({ name: '@seedprotocol/rdf', dependencies: { '@seedprotocol/query': 'workspace:*' } })
    assert.equal(result.ok, false)
    assert.match(result.stderr, /dependencies\.@seedprotocol\/query: workspace:\*/)
  })

  it('passes a manifest with pinned versions', () => {
    assert.equal(runCheckIn({ name: '@seedprotocol/rdf', dependencies: { '@seedprotocol/query': '0.8.1' } }).ok, true)
  })
})

describe('public packages', () => {
  for (const name of PUBLIC_PACKAGES) {
    it(`${name} runs the check last in prepublishOnly`, () => {
      const manifest = JSON.parse(readFileSync(join(rootDir, 'packages', name, 'package.json'), 'utf-8'))
      const hook = manifest.scripts?.prepublishOnly ?? ''
      assert.match(hook, /node \.\.\/\.\.\/scripts\/check-publish-manifest\.js$/, `prepublishOnly: ${hook || '(none)'}`)
    })

    it(`${name} has no workspace: specifier once its publish manifest is pinned`, () => {
      const manifest = JSON.parse(readFileSync(join(rootDir, 'packages', name, 'package.json'), 'utf-8'))
      assert.deepEqual(workspaceSpecifiers(publishableManifest(manifest, rootDir)), [])
    })
  }
})

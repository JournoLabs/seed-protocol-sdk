import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plugin, ViteDevServer } from 'vite'
import { seedVitePlugin } from '../src/index.js'
import { watchRdfSidecar } from '../src/rdfSidecar.js'

// The workspace package, as an app installs it: the plugin loads it with Node's own import, so its dist.
const rdfPackage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../rdf')

const schema = {
  id: 'schema-1',
  version: 1,
  models: { Post: { id: 'model-post', properties: { title: { id: 'prop-title', type: 'Text' } } } },
}
const sidecar = {
  schemaId: 'schema-1',
  schemaVersion: 1,
  terms: { 'model-post': 'schema:BlogPosting', 'prop-title': 'schema:headline' },
  '@context': {
    '@version': 1.1,
    schema: 'https://schema.org/',
    Post: { '@id': 'schema:BlogPosting', '@context': { title: 'schema:headline' } },
  },
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** An app root with the schema, optionally a sidecar, and optionally @seedprotocol/rdf. */
function app({ withSidecar = true, withRdf = true } = {}): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vite-rdf-')))
  tempDirs.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app' }))
  fs.writeFileSync(path.join(root, 'seedSchema.json'), JSON.stringify(schema))
  if (withSidecar) fs.writeFileSync(path.join(root, 'seedSchema.context.jsonld'), JSON.stringify(sidecar))
  if (withRdf) {
    fs.mkdirSync(path.join(root, 'node_modules/@seedprotocol'), { recursive: true })
    fs.symlinkSync(rdfPackage, path.join(root, 'node_modules/@seedprotocol/rdf'), 'dir')
  }
  return root
}

function devServer(root: string) {
  const logged: string[] = []
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  const logger = { warn: (m: string) => logged.push(`warn ${m}`), info: (m: string) => logged.push(`info ${m}`) }
  const server = { config: { root, logger }, watcher } as unknown as ViteDevServer
  return { server, watcher, logged }
}

const writeJson = (root: string, file: string, value: unknown) => fs.writeFileSync(path.join(root, file), JSON.stringify(value))

describe('rdfSidecar dev check', () => {
  it('stays quiet about a sidecar in step with the schema', async () => {
    const root = app()
    const { server, logged, watcher } = devServer(root)
    await watchRdfSidecar(server, {})
    expect(logged).toEqual([])
    expect(watcher.add).toHaveBeenCalledWith([path.join(root, 'seedSchema.json'), path.join(root, 'seedSchema.context.jsonld')])
  })

  it('warns after a rename or deletion in the schema, on the file change', async () => {
    const root = app()
    const { server, logged, watcher } = devServer(root)
    await watchRdfSidecar(server, {})
    writeJson(root, 'seedSchema.json', {
      ...schema,
      version: 2,
      models: { Post: { id: 'model-post', properties: { headline: { id: 'prop-headline', type: 'Text' } } } },
    })
    watcher.emit('change', path.join(root, 'seedSchema.json'))
    await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0))
    expect(logged).toEqual([
      'warn [seed-protocol] seedSchema.context.jsonld: term "schema:headline" names prop-title, which is no model or property in the schema',
      'warn [seed-protocol] seedSchema.context.jsonld: @context is behind the schema; run `seed-rdf sync --write`',
      'info [seed-protocol] seedSchema.context.jsonld: 1 property has no RDF term; `seed-rdf check` lists them',
    ])
  })

  it('ignores changes to other files', async () => {
    const root = app()
    const { server, logged, watcher } = devServer(root)
    await watchRdfSidecar(server, {})
    writeJson(root, 'seedSchema.context.jsonld', { ...sidecar, schemaId: 'other' })
    watcher.emit('change', path.join(root, 'src/main.ts'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(logged).toEqual([])
  })

  it('does nothing without a sidecar', async () => {
    const { server, logged } = devServer(app({ withSidecar: false, withRdf: false }))
    await watchRdfSidecar(server, {})
    expect(logged).toEqual([])
  })

  it('asks for @seedprotocol/rdf once when the app has a sidecar but not the package', async () => {
    const root = app({ withRdf: false })
    const { server, logged, watcher } = devServer(root)
    await watchRdfSidecar(server, {})
    watcher.emit('change', path.join(root, 'seedSchema.json'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(logged).toEqual(['warn [seed-protocol] seedSchema.context.jsonld: install @seedprotocol/rdf to check this sidecar against the schema'])
  })

  it('reports a sidecar for another schema, and reads the paths it is given', async () => {
    const root = app()
    fs.mkdirSync(path.join(root, 'rdf'))
    writeJson(root, 'rdf/mapping.jsonld', { ...sidecar, schemaId: 'other' })
    const { server, logged } = devServer(root)
    await watchRdfSidecar(server, { sidecar: 'rdf/mapping.jsonld' })
    expect(logged).toEqual(['warn [seed-protocol] rdf/mapping.jsonld: The sidecar is for schema other, not schema-1'])
  })

  it('is on by default in the plugin and off with rdfSidecar: false', async () => {
    const root = app()
    writeJson(root, 'seedSchema.context.jsonld', { ...sidecar, terms: { ...sidecar.terms, gone: 'schema:gone' } })
    const configure = (plugin: Plugin) => (plugin.configureServer as (server: ViteDevServer) => void).bind(plugin)
    const plugin = (options = {}) => seedVitePlugin({ isolationHeaders: false, ...options }).find((p) => p.name === 'seed-protocol:config')!

    const on = devServer(root)
    configure(plugin())(on.server)
    await vi.waitFor(() => expect(on.logged.join()).toMatch(/schema:gone/))

    const off = devServer(root)
    configure(plugin({ rdfSidecar: false }))(off.server)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(off.logged).toEqual([])
    expect(off.watcher.add).not.toHaveBeenCalled()
  })
})

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runRdfCli } from '../src/cli'
import { syncSidecar, type RdfSidecar, type SidecarSchema } from '../src/index'

const schema: SidecarSchema = {
  id: 'schema-1',
  version: 2,
  models: {
    Post: {
      id: 'model-post',
      properties: {
        title: { id: 'prop-title', type: 'Text' },
        summary: { id: 'prop-summary', type: 'Text' },
      },
    },
  },
}
const sidecar: RdfSidecar = {
  schemaId: 'schema-1',
  '@context': { schema: 'https://schema.org/' },
  terms: { 'model-post': 'schema:BlogPosting', 'prop-title': 'schema:headline' },
}

let dir: string
let out: string[]
let err: string[]
const run = (...args: string[]) => runRdfCli(args, { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
const write = (name: string, value: unknown) => writeFile(path.join(dir, name), JSON.stringify(value))
const read = async (name: string) => JSON.parse(await readFile(path.join(dir, name), 'utf8')) as RdfSidecar

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'seed-rdf-cli-'))
  out = []
  err = []
  await write('seed.schema.json', schema)
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('seed-rdf check', () => {
  it('passes a synced sidecar and lists unmapped properties', async () => {
    await write('seed.schema.context.jsonld', syncSidecar({ schema, sidecar }))
    expect(await run('check')).toBe(0)
    expect(out).toEqual(['Unmapped (exported under protocol IRIs):', '  Post.summary (prop-summary)'])
    expect(err).toEqual([])
  })

  it('fails on a stale term, so CI catches it', async () => {
    await write('seed.schema.context.jsonld', syncSidecar({ schema, sidecar: { ...sidecar, terms: { ...sidecar.terms, gone: 'schema:gone' } } }))
    expect(await run('check')).toBe(1)
    expect(err).toEqual(['Stale terms (no model or property in the schema has this id):', '  gone: schema:gone'])
  })

  it('passes, with a note, when only a rename left the context behind', async () => {
    await write('seed.schema.context.jsonld', sidecar)
    expect(await run('check')).toBe(0)
    expect(out.at(-1)).toMatch(/seed-rdf sync --write/)
  })

  it('reads the files it is given', async () => {
    await write('other.json', syncSidecar({ schema, sidecar }))
    await write('app.json', schema)
    expect(await run('check', '--schema', 'app.json', '--sidecar', 'other.json')).toBe(0)
  })

  it('exits 2 when the sidecar is missing or for another schema', async () => {
    expect(await run('check')).toBe(2)
    expect(err[0]).toMatch(/No sidecar at .*seed\.schema\.context\.jsonld/)
    await write('seed.schema.context.jsonld', { ...sidecar, schemaId: 'other' })
    expect(await run('check')).toBe(2)
  })

  it('exits 2 on an unknown command', async () => {
    expect(await run('fix')).toBe(2)
    expect(err.join('\n')).toMatch(/Unknown command: fix[\s\S]*Usage:/)
  })
})

describe('seed-rdf sync', () => {
  it('prints the synced sidecar and leaves the file alone without --write', async () => {
    await write('seed.schema.context.jsonld', sidecar)
    expect(await run('sync')).toBe(0)
    expect(JSON.parse(out.join('\n'))).toEqual(syncSidecar({ schema, sidecar }))
    expect(await read('seed.schema.context.jsonld')).toEqual(sidecar)
  })

  it('writes it with --write', async () => {
    await write('seed.schema.context.jsonld', sidecar)
    expect(await run('sync', '--write')).toBe(0)
    const written = await read('seed.schema.context.jsonld')
    expect(written.schemaVersion).toBe(2)
    expect(written['@context']).toMatchObject({ Post: { '@id': 'schema:BlogPosting', '@context': { title: 'schema:headline' } } })
    expect(await run('check')).toBe(0)
  })
})

describe('seed-rdf suggest', () => {
  it('prints suggestions for unmapped properties', async () => {
    await write('seed.schema.context.jsonld', sidecar)
    expect(await run('suggest')).toBe(0)
    expect(out).toEqual(['Post.summary (prop-summary): dcterms:abstract'])
  })

  it('creates a sidecar from the suggestions with --write', async () => {
    expect(await run('suggest', '--write')).toBe(0)
    const written = await read('seed.schema.context.jsonld')
    expect(written.terms).toEqual({ 'model-post': 'schema:BlogPosting', 'prop-title': 'dcterms:title', 'prop-summary': 'dcterms:abstract' })
    expect(written['@context']).toMatchObject({ dcterms: 'http://purl.org/dc/terms/', schema: 'https://schema.org/' })
    expect(await run('check')).toBe(0)
  })
})

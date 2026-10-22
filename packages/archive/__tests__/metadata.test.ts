import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { dublinCoreXml, premisXml, type Premis } from '../src'

const premis: Premis = {
  objects: [
    { kind: 'intellectualEntity', identifiers: [{ type: 'Seed Protocol seed UID', value: '0xabc' }] },
    {
      kind: 'file',
      identifiers: [{ type: 'bag path', value: 'data/index.html' }],
      fixity: { 'SHA-256': 'aa', 'SHA-512': 'bb' },
      size: 12,
      formatName: 'text/html',
      originalName: 'https://ar.seedprotocol.io/raw/tx',
    },
  ],
  events: [
    {
      identifier: { type: 'EAS attestation UID', value: '0xv1' },
      type: 'creation',
      dateTime: '2026-10-08T21:00:00.000Z',
      detail: 'Seed attested <first> & "only"',
      outcome: 'success',
      agents: [{ type: 'EVM address', value: '0x1', role: 'attester' }],
      objects: [{ type: 'Seed Protocol seed UID', value: '0xabc' }],
    },
  ],
  agents: [
    { identifiers: [{ type: 'EVM address', value: '0x1' }], type: 'person' },
    { identifiers: [{ type: 'software', value: '@seedprotocol/archive' }], name: '@seedprotocol/archive', type: 'software', version: '0.7.8' },
  ],
}

describe('premisXml', () => {
  it('writes LoC vocabulary URIs and escapes text', () => {
    const xml = premisXml(premis)
    expect(xml).toContain(
      '<premis:eventType authority="eventType" authorityURI="http://id.loc.gov/vocabulary/preservation/eventType" valueURI="http://id.loc.gov/vocabulary/preservation/eventType/cre">creation</premis:eventType>',
    )
    expect(xml).toContain('valueURI="http://id.loc.gov/vocabulary/preservation/agentType/sof">software</premis:agentType>')
    expect(xml).toContain('Seed attested &lt;first&gt; &amp; &quot;only&quot;')
    expect(() => premisXml({ objects: [] })).toThrow('at least one object')
  })
})

describe('dublinCoreXml', () => {
  it('writes repeated elements in DCMI order and drops empty values', () => {
    const xml = dublinCoreXml({ identifier: ['a', 'b'], title: 'T & U', creator: '' })
    expect(xml).toMatch(/<dc:title>T &amp; U<\/dc:title>\n {2}<dc:identifier>a<\/dc:identifier>\n {2}<dc:identifier>b</)
    expect(xml).not.toContain('dc:creator')
  })
})

// Schema validation needs the official XSDs, which aren't vendored: set ARCHIVE_XSD_DIR to a
// directory holding premis.xsd (https://www.loc.gov/standards/premis/v3/premis.xsd) and
// oai_dc.xsd with its simpledc20021212.xsd import pointed at a local copy.
const xsdDir = process.env.ARCHIVE_XSD_DIR
const hasXmllint = spawnSync('xmllint', ['--version']).status === 0

describe.runIf(xsdDir && hasXmllint)('schema validation', () => {
  const validate = async (xml: string, xsd: string) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'seed-archive-xsd-'))
    try {
      const file = path.join(dir, 'doc.xml')
      await writeFile(file, xml)
      return spawnSync('xmllint', ['--noout', '--nonet', '--schema', path.join(xsdDir!, xsd), file], { encoding: 'utf8' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('PREMIS validates against premis.xsd', async () => {
    const result = await validate(premisXml(premis), 'premis.xsd')
    expect(result.stderr).toContain('validates')
  })

  it('Dublin Core validates against oai_dc.xsd', async () => {
    const result = await validate(dublinCoreXml({ title: 'T', date: '2026-10-08', identifier: ['a'] }), 'oai_dc.xsd')
    expect(result.stderr).toContain('validates')
  })
})

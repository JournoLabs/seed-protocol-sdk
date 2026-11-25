import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')

describe('package manifest', () => {
  it('marks the @seedprotocol/publish peer optional, since src imports only its types', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(manifest.peerDependenciesMeta?.['@seedprotocol/publish']?.optional).toBe(true)

    const runtimeImports = readdirSync(join(root, 'src'), { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'))
      .filter((f) => /^\s*(import|export)\s+(?!type\b)[^\n]*from\s+'@seedprotocol\/publish'/m.test(readFileSync(join(root, 'src', f), 'utf8')))
    expect(runtimeImports).toEqual([])
  })
})

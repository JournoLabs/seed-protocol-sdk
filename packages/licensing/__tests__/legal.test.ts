import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { describe, expect, it } from 'vitest'
import hashes from '../legal/hashes.generated.json'
import { creativeCommons } from '../src/catalog/cc'

const legalDir = join(__dirname, '../legal')

describe('pinned legal texts', () => {
  it.each(creativeCommons.map((m) => [m.spdx, m] as const))('%s matches its file', (spdx, m) => {
    const hash = bytesToHex(sha256(readFileSync(join(legalDir, `${spdx}.txt`))))
    expect(m.legal.sha256).toBe(hash)
    expect((hashes as Record<string, string>)[spdx]).toBe(hash)
  })
})

import { describe, expect, it } from 'vitest'
import { parseCli } from '../src/cli'

const A = '0xABCDEF0123456789abcdef0123456789abcdef01'
const B = '0x' + '2'.repeat(40)

describe('parseCli', () => {
  it('takes publishers from repeated --attester flags and SEED_MCP_ATTESTERS, lower case and once each', () => {
    expect(parseCli(['--attester', A, '--attester', B], { SEED_MCP_ATTESTERS: ` ${A.toLowerCase()}, ` })).toEqual({
      kind: 'run',
      options: { attesters: [A.toLowerCase(), B] },
    })
  })

  it('runs with no publishers when none are given', () => {
    expect(parseCli([], {})).toEqual({ kind: 'run', options: { attesters: [] } })
  })

  it('rejects an attester that is not an address', () => {
    const result = parseCli(['--attester', 'alice.eth'], {})
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.message).toContain('alice.eth')
  })

  it('rejects an unknown flag', () => {
    expect(parseCli(['--everyone'], {}).kind).toBe('error')
  })

  it('prints help', () => {
    expect(parseCli(['-h'], {})).toEqual({ kind: 'help' })
  })
})

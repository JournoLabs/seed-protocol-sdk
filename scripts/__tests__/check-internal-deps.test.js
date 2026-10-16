import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { nonWorkspaceInternalRefs } from '../check-internal-deps.js'

describe('nonWorkspaceInternalRefs', () => {
  it('accepts workspace refs in every dependency field', () => {
    assert.deepEqual(
      nonWorkspaceInternalRefs({
        dependencies: { '@seedprotocol/eas': 'workspace:*' },
        devDependencies: { '@seedprotocol/sdk': 'workspace:*' },
        optionalDependencies: { '@seedprotocol/query': 'workspace:^' },
        peerDependencies: { '@seedprotocol/sdk': 'workspace:*' },
      }),
      [],
    )
  })

  it('flags semver ranges and exact versions on internal packages', () => {
    assert.deepEqual(
      nonWorkspaceInternalRefs({
        dependencies: { '@seedprotocol/arweave': '0.7.4' },
        peerDependencies: { '@seedprotocol/sdk': '^0.6.0', react: '^18 || ^19' },
      }),
      ['dependencies.@seedprotocol/arweave = "0.7.4"', 'peerDependencies.@seedprotocol/sdk = "^0.6.0"'],
    )
  })

  it('ignores packages outside the @seedprotocol scope', () => {
    assert.deepEqual(
      nonWorkspaceInternalRefs({ dependencies: { '@seedprotocolx/sdk': '^1.0.0', xstate: '^5.28.0' } }),
      [],
    )
  })
})

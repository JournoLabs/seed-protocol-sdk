import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { nonWorkspaceInternalRefs, unpublishedInstallRefs } from '../check-internal-deps.js'

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

describe('unpublishedInstallRefs', () => {
  const manifests = {
    archive: { name: '@seedprotocol/archive' },
    eas: { name: '@seedprotocol/eas' },
    sdk: {
      name: '@seedprotocol/sdk',
      dependencies: { '@seedprotocol/archive': 'workspace:*', '@seedprotocol/eas': 'workspace:*' },
      devDependencies: { '@seedprotocol/bundler-core': 'workspace:*' },
    },
    react: { name: '@seedprotocol/react', peerDependencies: { '@seedprotocol/sdk': 'workspace:*' } },
  }

  it('accepts install-time refs to packages published earlier, and ignores devDependencies', () => {
    assert.deepEqual(
      unpublishedInstallRefs(manifests, {
        publishOrder: ['archive', 'eas', 'sdk', 'react'],
        awaitingFirstPublish: [],
      }),
      [],
    )
  })

  it('flags a dependency on a package awaiting its first publish (0.7.10)', () => {
    assert.deepEqual(
      unpublishedInstallRefs(manifests, {
        publishOrder: ['eas', 'sdk', 'react'],
        awaitingFirstPublish: ['archive'],
      }),
      [
        'sdk dependencies.@seedprotocol/archive: archive is in AWAITING_FIRST_PUBLISH: publish it by hand, then move it into PUBLISH_ORDER',
      ],
    )
  })

  it('flags a dependency CI never publishes, and one published later', () => {
    assert.deepEqual(
      unpublishedInstallRefs(manifests, {
        publishOrder: ['archive', 'react', 'sdk'],
        awaitingFirstPublish: [],
      }),
      [
        'react peerDependencies.@seedprotocol/sdk: sdk comes after react in PUBLISH_ORDER',
        'sdk dependencies.@seedprotocol/eas: eas is not in PUBLISH_ORDER',
      ],
    )
  })
})

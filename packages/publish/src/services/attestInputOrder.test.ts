import { describe, expect, it } from 'bun:test'

const { attestPublishAuthorization } = await import('./publishAuthorization/index')
const { attestPublishedBy } = await import('./publishedBy/index')
const { attestDomainOwnership } = await import('./domainOwnership/index')
const { setConfigRef } = await import('~/config')
const { brandTxSender } = await import('~/helpers/seedSigner')

setConfigRef({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.invalid' })

const identity = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'

/** Records every transaction and fails it, so nothing waits on a receipt. */
function recordingSender(address: string) {
  const sent: unknown[] = []
  return {
    sent,
    wallet: brandTxSender({
      address: address as `0x${string}`,
      sendTransaction: async (tx) => {
        sent.push(tx)
        throw new Error('recorded')
      },
    }),
  }
}

// Bad inputs must fail before the schema is looked up or registered. The schema read goes to
// rpc.invalid, so an implementation that registers first fails with a network error instead.
describe('attest tools validate before registering schemas', () => {
  it('attestPublishAuthorization refuses a sender that is not the identity', async () => {
    const { sent, wallet } = recordingSender(other)
    await expect(
      attestPublishAuthorization({ wallet, identity, sessionKey: other }),
    ).rejects.toThrow('must be sent by the identity')
    expect(sent).toHaveLength(0)
  })

  it('attestPublishAuthorization refuses a bad session key', async () => {
    const { sent, wallet } = recordingSender(identity)
    await expect(
      attestPublishAuthorization({ wallet, identity, sessionKey: 'nope' }),
    ).rejects.toThrow('sessionKey must be a valid address')
    expect(sent).toHaveLength(0)
  })

  it('attestPublishedBy refuses a missing batchHash in hash mode', async () => {
    const { sent, wallet } = recordingSender(identity)
    await expect(
      attestPublishedBy({
        wallet,
        mode: 'hash',
        seedUid: `0x${'ab'.repeat(32)}`,
        toolName: 't',
        toolVersion: '1',
      } as Parameters<typeof attestPublishedBy>[0]),
    ).rejects.toThrow('hash mode requires batchHash')
    expect(sent).toHaveLength(0)
  })

  it('attestPublishedBy refuses an invalid seedUid', async () => {
    const { sent, wallet } = recordingSender(identity)
    await expect(
      attestPublishedBy({
        wallet,
        mode: 'uids',
        attestationUids: [],
        seedUid: `0x${'00'.repeat(32)}`,
        toolName: 't',
        toolVersion: '1',
      }),
    ).rejects.toThrow('requires a valid seedUid')
    expect(sent).toHaveLength(0)
  })

  it('attestDomainOwnership refuses a bad claimer', async () => {
    const { sent, wallet } = recordingSender(identity)
    await expect(
      attestDomainOwnership({
        wallet,
        domain: 'example.com',
        claimer: 'nope',
        challengeHash: `0x${'cd'.repeat(32)}`,
        registrySnapshot: { domain: 'example.com' },
      } as Parameters<typeof attestDomainOwnership>[0]),
    ).rejects.toThrow('requires a valid claimer address')
    expect(sent).toHaveLength(0)
  })
})

import { afterEach, describe, expect, mock, test } from 'bun:test'

const isAutomationSessionActiveMock = mock(async () => false)
const getPublishAuthorizationFromEasMock = mock(async () => [] as unknown[])

mock.module('./ensureAutomationSessionKey', () => ({
  isAutomationSessionActive: (...args: unknown[]) => isAutomationSessionActiveMock(...args),
  ensureAutomationSessionKey: mock(async () => {}),
  removeAutomationSessionKey: mock(async () => {}),
}))

const easActual = await import('@seedprotocol/eas')
mock.module('@seedprotocol/eas', () => ({
  ...easActual,
  getPublishAuthorizationFromEas: (...args: unknown[]) =>
    getPublishAuthorizationFromEasMock(...args),
  decodePublishAuthorizationData: (data: string) => {
    const fields = JSON.parse(data) as Array<{ name: string; value: string | number }>
    const by = Object.fromEntries(fields.map((f) => [f.name, f.value]))
    return {
      identity: String(by.identity ?? '').toLowerCase(),
      sessionKey: String(by.sessionKey ?? '').toLowerCase(),
      app: String(by.app ?? '').toLowerCase(),
      scopes: String(by.scopes ?? 'publish,revoke'),
      grantedAt: Number(by.grantedAt ?? 0),
      expiresAt: Number(by.expiresAt ?? 0),
      permissionsHash: String(by.permissionsHash ?? '0x' + '00'.repeat(32)),
    }
  },
  assessPublishAuthorization: ({ decoded }: { decoded: { expiresAt: number } }) => {
    if (decoded.expiresAt > 0 && decoded.expiresAt < Math.floor(Date.now() / 1000)) {
      return { status: 'expired', warnings: [] }
    }
    return { status: 'valid', warnings: [] }
  },
}))

afterEach(() => {
  isAutomationSessionActiveMock.mockClear()
  getPublishAuthorizationFromEasMock.mockClear()
  isAutomationSessionActiveMock.mockImplementation(async () => false)
  getPublishAuthorizationFromEasMock.mockImplementation(async () => [])
})

describe('assertStorageBoundToIdentity', () => {
  test('bound via active session key', async () => {
    isAutomationSessionActiveMock.mockImplementationOnce(async () => true)
    const { assertStorageBoundToIdentity } = await import('./assertStorageBoundToIdentity')
    const result = await assertStorageBoundToIdentity({
      managedAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      dataItemOwner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    expect(result.bound).toBe(true)
    expect(result.via).toBe('active_session_key')
  })

  test('bound via publish authorization sidecar', async () => {
    const identity = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const session = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    getPublishAuthorizationFromEasMock.mockImplementationOnce(async () => [
      {
        id: '0x1',
        expirationTime: Math.floor(Date.now() / 1000) + 10_000,
        decodedDataJson: JSON.stringify([
          { name: 'identity', value: identity },
          { name: 'sessionKey', value: session },
          { name: 'app', value: '0x0000000000000000000000000000000000000000' },
          { name: 'scopes', value: 'publish,revoke' },
          { name: 'grantedAt', value: 1 },
          { name: 'expiresAt', value: Math.floor(Date.now() / 1000) + 10_000 },
          { name: 'permissionsHash', value: '0x' + 'ab'.repeat(32) },
        ]),
      },
    ])
    const { assertStorageBoundToIdentity } = await import('./assertStorageBoundToIdentity')
    const result = await assertStorageBoundToIdentity({
      managedAddress: identity,
      dataItemOwner: session,
      allowActiveSessionKey: false,
    })
    expect(result.bound).toBe(true)
    expect(result.via).toBe('publish_authorization')
  })

  test('unbound when neither path matches', async () => {
    const { assertStorageBoundToIdentity } = await import('./assertStorageBoundToIdentity')
    const result = await assertStorageBoundToIdentity({
      managedAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      dataItemOwner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    expect(result.bound).toBe(false)
    expect(result.via).toBe(null)
  })
})

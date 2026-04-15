import { afterEach, describe, expect, test } from 'bun:test'
import { getPublishConfig, initPublish, resolveAutoDeployEip7702ModularAccount, setConfigRef } from './config'

afterEach(() => {
  setConfigRef(null)
})

describe('resolveAutoDeployEip7702ModularAccount', () => {
  test('explicit true', () => {
    expect(
      resolveAutoDeployEip7702ModularAccount(
        { thirdwebClientId: 't', uploadApiBaseUrl: 'u', autoDeployEip7702ModularAccount: true },
        false,
      ),
    ).toBe(true)
  })

  test('explicit false', () => {
    expect(
      resolveAutoDeployEip7702ModularAccount(
        { thirdwebClientId: 't', uploadApiBaseUrl: 'u', autoDeployEip7702ModularAccount: false },
        true,
      ),
    ).toBe(false)
  })

  test('undefined follows useModularExecutor', () => {
    expect(
      resolveAutoDeployEip7702ModularAccount({ thirdwebClientId: 't', uploadApiBaseUrl: 'u' }, true),
    ).toBe(true)
    expect(
      resolveAutoDeployEip7702ModularAccount({ thirdwebClientId: 't', uploadApiBaseUrl: 'u' }, false),
    ).toBe(false)
  })
})

describe('getPublishConfig autoDeployEip7702ModularAccount', () => {
  test('defaults true when useModularExecutor true', () => {
    initPublish({
      thirdwebClientId: 't',
      uploadApiBaseUrl: 'https://example.com',
      useModularExecutor: true,
    })
    expect(getPublishConfig().autoDeployEip7702ModularAccount).toBe(true)
  })

  test('defaults false when useModularExecutor false', () => {
    initPublish({
      thirdwebClientId: 't',
      uploadApiBaseUrl: 'https://example.com',
      useModularExecutor: false,
    })
    expect(getPublishConfig().autoDeployEip7702ModularAccount).toBe(false)
  })

  test('explicit false with modular executor', () => {
    initPublish({
      thirdwebClientId: 't',
      uploadApiBaseUrl: 'https://example.com',
      useModularExecutor: true,
      autoDeployEip7702ModularAccount: false,
    })
    expect(getPublishConfig().autoDeployEip7702ModularAccount).toBe(false)
  })
})

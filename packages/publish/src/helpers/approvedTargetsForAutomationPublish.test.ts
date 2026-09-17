import { afterEach, describe, expect, test } from 'bun:test'
import { setConfigRef, type PublishConfig } from '../config'
import { approvedTargetsForAutomationPublish } from './approvedTargetsForAutomationPublish'
import {
  buildAutomationSessionKeyPermissions,
  hashAutomationSessionKeyPermissions,
  PUBLISH_AUTOMATION_SCOPES,
} from './automationSessionKeyPermissions'

afterEach(() => {
  setConfigRef(null)
})

function setCfg(partial: Partial<PublishConfig> & Pick<PublishConfig, 'uploadApiBaseUrl'>) {
  setConfigRef({
    thirdwebClientId: 'test',
    ...partial,
  } as PublishConfig)
}

describe('approvedTargetsForAutomationPublish', () => {
  test('throws when modularAccountModuleContract is unset', () => {
    setCfg({ uploadApiBaseUrl: 'https://example.com' })
    expect(() => approvedTargetsForAutomationPublish()).toThrow(/modularAccountModuleContract/)
  })

  test('returns only the executor module', () => {
    const moduleAddr = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    setCfg({
      uploadApiBaseUrl: 'https://example.com',
      modularAccountModuleContract: moduleAddr,
    })
    expect(approvedTargetsForAutomationPublish()).toEqual([
      moduleAddr.toLowerCase() as `0x${string}`,
    ])
  })
})

describe('automationSessionKeyPermissions', () => {
  test('hash is stable for same permissions', () => {
    setCfg({
      uploadApiBaseUrl: 'https://example.com',
      modularAccountModuleContract: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    const p = buildAutomationSessionKeyPermissions({ expiresAt: 1_900_000_000 })
    expect(hashAutomationSessionKeyPermissions(p)).toBe(
      hashAutomationSessionKeyPermissions(p, PUBLISH_AUTOMATION_SCOPES),
    )
    expect(p.approvedTargets).toHaveLength(1)
    expect(p.nativeTokenLimitPerTransaction).toBe(0)
  })
})

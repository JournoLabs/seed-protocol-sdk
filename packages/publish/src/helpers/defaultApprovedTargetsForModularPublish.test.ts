import { afterEach, describe, expect, test } from 'bun:test'
import { setConfigRef, type PublishConfig } from '../config'
import { defaultApprovedTargetsForModularPublish } from './defaultApprovedTargetsForModularPublish'

afterEach(() => {
  setConfigRef(null)
})

function setCfg(partial: Partial<PublishConfig> & Pick<PublishConfig, 'uploadApiBaseUrl'>) {
  setConfigRef({
    thirdwebClientId: 'test',
    ...partial,
  } as PublishConfig)
}

describe('defaultApprovedTargetsForModularPublish', () => {
  test('grants only the executor module, never the managed account', () => {
    const moduleAddr = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const managed = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    setCfg({ uploadApiBaseUrl: 'https://example.com', modularAccountModuleContract: moduleAddr })
    expect(defaultApprovedTargetsForModularPublish(managed)).toEqual([moduleAddr])
  })

  test('throws when no executor module is configured', () => {
    setCfg({ uploadApiBaseUrl: 'https://example.com' })
    expect(() => defaultApprovedTargetsForModularPublish()).toThrow(/modularAccountModuleContract/)
  })
})

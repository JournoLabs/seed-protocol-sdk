import { afterEach, describe, expect, test } from 'bun:test'
import { initPublish, setConfigRef } from '../config'
import { EAS_CONTRACT_ADDRESS } from './constants'
import { defaultApprovedTargetsForModularPublish } from './defaultApprovedTargetsForModularPublish'

afterEach(() => {
  setConfigRef(null)
})

describe('defaultApprovedTargetsForModularPublish', () => {
  test('includes managed account and EAS', () => {
    initPublish({
      thirdwebClientId: 'test',
      uploadApiBaseUrl: 'https://example.com',
    })
    const managed = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const targets = defaultApprovedTargetsForModularPublish(managed)
    const lower = targets.map((a) => a.toLowerCase())
    expect(lower).toContain(managed.toLowerCase())
    expect(lower).toContain(EAS_CONTRACT_ADDRESS.toLowerCase())
  })

  test('includes modular executor module when configured', () => {
    const moduleAddr = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    initPublish({
      thirdwebClientId: 'test',
      uploadApiBaseUrl: 'https://example.com',
      modularAccountModuleContract: moduleAddr,
    })
    const targets = defaultApprovedTargetsForModularPublish(
      '0xcccccccccccccccccccccccccccccccccccccccc',
    )
    expect(targets.map((a) => a.toLowerCase())).toContain(moduleAddr.toLowerCase())
  })
})

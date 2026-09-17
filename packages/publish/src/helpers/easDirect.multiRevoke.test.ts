import { afterEach, describe, expect, test } from 'bun:test'
import { setConfigRef, type PublishConfig } from '../config'
import { prepareEasMultiRevoke } from './easDirect'
import { EAS_CONTRACT_ADDRESS } from './constants'

afterEach(() => {
  setConfigRef(null)
})

function setCfg(partial: Partial<PublishConfig> & Pick<PublishConfig, 'uploadApiBaseUrl'>) {
  setConfigRef({
    thirdwebClientId: 'test',
    ...partial,
  } as PublishConfig)
}

describe('prepareEasMultiRevoke routing', () => {
  test('targets EAS when no executor module is configured', () => {
    setCfg({ uploadApiBaseUrl: 'https://example.com' })
    const tx = prepareEasMultiRevoke([
      { schema: `0x${'11'.repeat(32)}`, data: [{ uid: `0x${'22'.repeat(32)}` }] },
    ])
    expect(tx.to.toLowerCase()).toBe(EAS_CONTRACT_ADDRESS.toLowerCase())
  })

  test('targets executor module when modularAccountModuleContract is set', () => {
    const moduleAddr = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    setCfg({
      uploadApiBaseUrl: 'https://example.com',
      modularAccountModuleContract: moduleAddr,
    })
    const tx = prepareEasMultiRevoke([
      { schema: `0x${'11'.repeat(32)}`, data: [{ uid: `0x${'22'.repeat(32)}` }] },
    ])
    expect(tx.to.toLowerCase()).toBe(moduleAddr.toLowerCase())
  })
})

import { describe, expect, test } from 'bun:test'
import { MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA } from '../../../helpers/constants'
import { resolvePublishRouting } from './createAttestations'

describe('resolvePublishRouting', () => {
  test('uses publisher contract as multiPublish target in non-modular mode', () => {
    const publisher = '0xabc0000000000000000000000000000000000001'
    const routing = resolvePublishRouting({
      useModularExecutor: false,
      publisherAddress: publisher,
    })
    expect(routing).toEqual({
      txTargetAddress: publisher,
      contractAddressForEvents: publisher,
    })
  })

  test('uses managed address target in modular mode', () => {
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: '0xmanaged',
    })
    expect(routing).toEqual({
      txTargetAddress: '0xmanaged',
      contractAddressForEvents: '0xmanaged',
    })
  })

  test('prefers module contract as event source in modular mode', () => {
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: '0xmanaged',
      modularAccountModuleContract: '0xmodule',
    })
    expect(routing).toEqual({
      txTargetAddress: '0xmanaged',
      contractAddressForEvents: '0xmodule',
    })
  })

  test('throws in modular mode when managedAddress missing', () => {
    expect(() =>
      resolvePublishRouting({
        useModularExecutor: true,
        publisherAddress: '0xabc',
      }),
    ).toThrow('managedAddress is required')
  })

  test('modular tx target is never the ABI reference deployment (regression guard)', () => {
    const managed = '0x05c1a02815bf9c634763d63b8df5573b3a00ef08'
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: managed,
    })
    expect(routing.txTargetAddress.toLowerCase()).toBe(managed.toLowerCase())
    expect(routing.txTargetAddress.toLowerCase()).not.toBe(
      MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA.toLowerCase(),
    )
  })
})

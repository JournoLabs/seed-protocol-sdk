import { describe, expect, it } from 'vitest'
import { getInvariantSafePropertyDescriptor } from '@/helpers/reactiveProxy'

describe('getInvariantSafePropertyDescriptor', () => {
  it('returns an own configurable:false accessor unchanged', () => {
    const target: { revokedAt?: number } = {}
    Object.defineProperty(target, 'revokedAt', {
      get() {
        return 1
      },
      enumerable: true,
      configurable: false,
    })

    const desc = getInvariantSafePropertyDescriptor(target, 'revokedAt', {
      value: 99,
      writable: true,
    })
    expect(desc).toEqual(Object.getOwnPropertyDescriptor(target, 'revokedAt'))
    expect(desc?.configurable).toBe(false)
    expect(desc && 'get' in desc).toBe(true)
  })

  it('does not invent a descriptor on a non-extensible target', () => {
    const target = Object.preventExtensions({ seedLocalId: 'abc' })
    const desc = getInvariantSafePropertyDescriptor(target, 'revokedAt', {
      value: 123,
    })
    expect(desc).toBeUndefined()
  })

  it('does not invent a descriptor on a frozen target', () => {
    const target = Object.freeze({})
    const desc = getInvariantSafePropertyDescriptor(target, 'revokedAt', {
      value: 123,
    })
    expect(desc).toBeUndefined()
  })

  it('invents a configurable data descriptor only when the target is extensible and the key is not own', () => {
    const target = {}
    const desc = getInvariantSafePropertyDescriptor(target, 'revokedAt', {
      value: undefined,
    })
    expect(desc).toEqual({
      enumerable: true,
      configurable: true,
      value: undefined,
      writable: true,
    })
  })

  it('does not promote a prototype accessor to an own descriptor', () => {
    class Sample {
      get revokedAt() {
        return 7
      }
    }
    const target = new Sample()
    expect(Object.getOwnPropertyDescriptor(target, 'revokedAt')).toBeUndefined()

    const desc = getInvariantSafePropertyDescriptor(target, 'revokedAt')
    expect(desc).toBeUndefined()
  })

  it('does not throw when a proxy uses the helper against a frozen target', () => {
    const target = Object.freeze({ seedLocalId: 'x' })
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(t, prop) {
        return getInvariantSafePropertyDescriptor(t, prop, {
          value: 1,
        })
      },
    })
    expect(() => Object.getOwnPropertyDescriptor(proxy, 'revokedAt')).not.toThrow()
    expect(Object.getOwnPropertyDescriptor(proxy, 'revokedAt')).toBeUndefined()
  })

  it('does not throw when a proxy uses the helper against an own non-configurable accessor', () => {
    const target: { revokedAt?: number } = {}
    Object.defineProperty(target, 'revokedAt', {
      get() {
        return 5
      },
      enumerable: true,
      configurable: false,
    })
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(t, prop) {
        return getInvariantSafePropertyDescriptor(t, prop, {
          value: 99,
          writable: true,
        })
      },
    })
    expect(() => Object.getOwnPropertyDescriptor(proxy, 'revokedAt')).not.toThrow()
    const desc = Object.getOwnPropertyDescriptor(proxy, 'revokedAt')
    expect(desc?.configurable).toBe(false)
    expect(desc && 'get' in desc).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { licenseHistory, offerInForce, type LicenseOfferRecord } from '../src'

const offer = (uid: string, timeCreated: number, revocationTime = 0): LicenseOfferRecord => ({
  uid,
  timeCreated,
  revocationTime,
  termsHash: `0x${uid.padStart(64, '0')}`,
  spdx: 'CC-BY-4.0',
})

describe('offerInForce', () => {
  it('is null with no offer at or before the time', () => {
    expect(offerInForce([], 100)).toBeNull()
    expect(offerInForce([offer('a', 101)], 100)).toBeNull()
  })

  it('takes the newest offer attested at or before the time', () => {
    const offers = [offer('b', 200), offer('a', 100), offer('c', 300)]
    expect(offerInForce(offers, 250)).toMatchObject({ offer: { uid: 'b' }, revoked: false, since: 200 })
    expect(offerInForce(offers, 200)).toMatchObject({ offer: { uid: 'b' }, since: 200 })
    expect(offerInForce(offers, 199)).toMatchObject({ offer: { uid: 'a' } })
  })

  it('reads a revoked offer as revoked from its revocation time, not before', () => {
    const offers = [offer('a', 100, 300)]
    expect(offerInForce(offers, 299)).toMatchObject({ offer: { uid: 'a' }, revoked: false, since: 100 })
    expect(offerInForce(offers, 300)).toMatchObject({ offer: { uid: 'a' }, revoked: true, since: 300 })
  })

  it('lets a later offer replace a revocation', () => {
    const offers = [offer('a', 100, 200), offer('b', 300)]
    expect(offerInForce(offers, 250)).toMatchObject({ offer: { uid: 'a' }, revoked: true })
    expect(offerInForce(offers, 300)).toMatchObject({ offer: { uid: 'b' }, revoked: false })
  })

  it('ignores the revocation of an offer no longer in force', () => {
    const offers = [offer('a', 100, 400), offer('b', 200)]
    expect(offerInForce(offers, 500)).toMatchObject({ offer: { uid: 'b' }, revoked: false, since: 200 })
  })

  it('counts an offer revoked in the second it was made as revoked then', () => {
    expect(offerInForce([offer('a', 100, 100)], 100)).toMatchObject({ revoked: true })
  })

  it('breaks a tie between offers in one second by uid, so every reader agrees', () => {
    expect(offerInForce([offer('b', 100), offer('a', 100)], 100)?.offer.uid).toBe('b')
    expect(offerInForce([offer('a', 100), offer('b', 100)], 100)?.offer.uid).toBe('b')
  })

  it('rejects a time that is not a finite number', () => {
    expect(() => offerInForce([], Number.NaN)).toThrow(RangeError)
  })
})

describe('licenseHistory', () => {
  it('lists every change of the license in force, oldest first', () => {
    const offers = [offer('c', 500), offer('a', 100, 200), offer('b', 300, 600), offer('d', 400, 450)]
    expect(licenseHistory(offers).map(({ offer, revoked, since }) => [offer.uid, revoked, since])).toEqual([
      ['a', false, 100],
      ['a', true, 200],
      ['b', false, 300],
      ['d', false, 400],
      ['d', true, 450],
      ['c', false, 500],
    ])
  })

  it('is empty without offers', () => expect(licenseHistory([])).toEqual([]))
})

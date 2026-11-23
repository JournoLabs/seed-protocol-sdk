import { describe, expect, test } from 'bun:test'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { LICENSE_OFFER_SCHEMA_DEF, LICENSE_OFFER_SCHEMA_UID, arweaveTxIdToBytes32 } from '@seedprotocol/eas'
import { InvalidLicenseOfferError } from '../../errors'
import { encodeLicenseOfferData, licenseOfferAttestation, parseLicenseOffer } from './index'

const TERMS = `0x${'AB'.repeat(32)}`
const TX = 'p1zjJ0gVyVyJtnHqO8pKcqQ4Ew3cZtYwYgC2QbE5xdA'

describe('parseLicenseOffer', () => {
  test('normalizes the hash and the SPDX id', () => {
    expect(parseLicenseOffer({ termsHash: TERMS, spdx: ' CC-BY-4.0 ' })).toEqual({
      termsHash: TERMS.toLowerCase(),
      spdx: 'CC-BY-4.0',
    })
  })

  test.each([
    [undefined],
    [{ spdx: 'CC0-1.0' }],
    [{ termsHash: '0x12', spdx: 'CC0-1.0' }],
    [{ termsHash: TERMS, spdx: '  ' }],
    [{ termsHash: TERMS, spdx: 'CC0-1.0', legalTxId: 'short' }],
  ])('refuses %p', (offer) => {
    expect(() => parseLicenseOffer(offer)).toThrow(InvalidLicenseOfferError)
  })
})

describe('encodeLicenseOfferData', () => {
  const decoded = (data: `0x${string}`) =>
    Object.fromEntries(new SchemaEncoder(LICENSE_OFFER_SCHEMA_DEF).decodeData(data).map((f) => [f.name, f.value.value]))

  test('writes the terms, the SPDX id and zero for everything paid offers will use', () => {
    const fields = decoded(encodeLicenseOfferData({ termsHash: TERMS.toLowerCase(), spdx: 'CC-BY-4.0' }))
    expect(fields.terms_hash).toBe(TERMS.toLowerCase())
    expect(fields.spdx).toBe('CC-BY-4.0')
    expect(fields.legal_tx).toBe(`0x${'0'.repeat(64)}`)
    expect(BigInt(fields.price as bigint)).toBe(0n)
    expect(BigInt(fields.max_grants as bigint)).toBe(0n)
    expect(fields.gate_hook).toBe('0x0000000000000000000000000000000000000000')
  })

  test('writes the legal text transaction', () => {
    const fields = decoded(encodeLicenseOfferData({ termsHash: TERMS, spdx: 'CC0-1.0', legalTxId: TX }))
    expect(fields.legal_tx).toBe(arweaveTxIdToBytes32(TX))
  })
})

test('licenseOfferAttestation points at the batch Version by default and is marked', () => {
  const att = licenseOfferAttestation({ termsHash: TERMS, spdx: 'CC0-1.0' })
  expect(att.schema).toBe(LICENSE_OFFER_SCHEMA_UID as `0x${string}`)
  expect(att.data[0]!.refUID).toBe(`0x${'0'.repeat(64)}`)
  expect(att.data[0]!.revocable).toBe(true)
  expect(att._licenseOffer).toBe(true)
})

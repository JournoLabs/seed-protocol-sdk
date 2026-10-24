import { describe, expect, it } from 'vitest'
import { print } from 'graphql'
import {
  GET_DOMAIN_OWNERSHIPS,
  GET_PROPERTIES,
  GET_PUBLISH_AUTHORIZATIONS,
  GET_SEEDS,
  GET_VERSIONS,
} from '../src/queries.js'

/**
 * Sync reads `revocationTime` (EAS seconds) off revoked attestations to record when they were
 * revoked. Every query sync fetches with must select it, or the field is undefined at runtime.
 */
describe('sync queries select revocationTime', () => {
  it.each([
    ['GET_SEEDS', GET_SEEDS],
    ['GET_VERSIONS', GET_VERSIONS],
    ['GET_PROPERTIES', GET_PROPERTIES],
  ])('%s selects revoked and revocationTime', (_name, document) => {
    const text = print(document)
    expect(text).toMatch(/\brevoked\b/)
    expect(text).toMatch(/\brevocationTime\b/)
  })
})

/** assessDomainOwnership reports an expired claim from EAS `expirationTime`. */
describe('domain ownership query', () => {
  it('GET_DOMAIN_OWNERSHIPS selects expirationTime', () => {
    const text = print(GET_DOMAIN_OWNERSHIPS)
    expect(text).toMatch(/\bexpirationTime\b/)
    expect(text).toMatch(/\brevoked\b/)
  })
})

/** assessPublishAuthorization reports expired and revoked grants from these fields. */
describe('publish authorization query', () => {
  it('GET_PUBLISH_AUTHORIZATIONS selects expirationTime and revoked', () => {
    const text = print(GET_PUBLISH_AUTHORIZATIONS)
    expect(text).toMatch(/\bexpirationTime\b/)
    expect(text).toMatch(/\brevoked\b/)
  })
})

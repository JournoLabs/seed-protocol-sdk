import { describe, expect, it } from 'vitest'
import { print } from 'graphql'
import { GET_PROPERTIES, GET_SEEDS, GET_VERSIONS } from '../src/queries.js'

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

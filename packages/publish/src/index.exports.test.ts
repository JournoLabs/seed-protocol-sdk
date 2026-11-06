import { describe, expect, test } from 'bun:test'

describe('@seedprotocol/publish entry', () => {
  test('exports MissingSignedDataItemsError, so apps can match it with instanceof', async () => {
    const entry = await import('./index')
    const error = new entry.MissingSignedDataItemsError()
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('SIGNED_DATA_ITEMS_MISSING')
  })

  test('exports publishLockHolder, so a tab can tell whether it runs a publish', async () => {
    const entry = await import('./index')
    expect(await entry.publishLockHolder('seed-not-publishing')).toBeOneOf(['here', 'none'])
  })
})

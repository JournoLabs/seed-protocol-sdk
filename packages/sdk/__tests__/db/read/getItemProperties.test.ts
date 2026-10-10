import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { getItemProperties } from '@/db/read/getItemProperties'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const uid = (byte: string) => '0x' + byte.repeat(32)

/**
 * `edited` selects properties by their current value (the row readers show): `true` = a local edit
 * not yet attested (Item.getEditedProperties), `false` = published. ItemStorage rows sync derived
 * from a storage_transaction_id attestation count as published, as in getPublishPendingDiff.
 */
describe.sequential('getItemProperties edited filter', () => {
  const seedLocalId = 'gip-edited-seed'
  const versionLocalId = 'gip-edited-version'

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })

    const row = (
      localId: string,
      propertyName: string,
      propertyValue: string,
      at: number,
      extra: Partial<typeof metadata.$inferInsert> = {},
    ): typeof metadata.$inferInsert => ({
      localId,
      propertyName,
      propertyValue,
      seedLocalId,
      versionLocalId,
      modelType: 'gip_edited_post',
      createdAt: at,
      attestationCreatedAt: at,
      ...extra,
    })

    await BaseDb.getAppDb()
      .insert(metadata)
      .values([
        // Published, then edited locally: edited.
        row('gip-title-pub', 'title', 'published title', 1_000, { uid: uid('e1') }),
        row('gip-title-edit', 'title', 'edited title', 2_000),
        // Published only.
        row('gip-body-pub', 'body', 'published body', 1_000, { uid: uid('e2') }),
        // An old edit superseded by a newer publish: not edited.
        row('gip-summary-edit', 'summary', 'old edit', 1_000),
        row('gip-summary-pub', 'summary', 'published summary', 2_000, { uid: uid('e3') }),
        // Derived from a storage_transaction_id attestation: published, though it has no uid.
        row('gip-html-derived', 'html', 'tx-id', 1_000, { derivedFromUid: uid('e4') }),
      ])
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const names = async (edited?: boolean) =>
    (await getItemProperties({ seedLocalId, edited }))
      .map((p) => [p.propertyName, p.propertyValue])
      .sort((a, b) => a[0].localeCompare(b[0]))

  it('returns every property, at its current value, when edited is not set', async () => {
    expect(await names()).toEqual([
      ['body', 'published body'],
      ['html', 'tx-id'],
      ['summary', 'published summary'],
      ['title', 'edited title'],
    ])
  })

  it('edited: true returns only properties whose current value is a local edit', async () => {
    expect(await names(true)).toEqual([['title', 'edited title']])
  })

  it('edited: false returns only properties whose current value is published', async () => {
    expect(await names(false)).toEqual([
      ['body', 'published body'],
      ['html', 'tx-id'],
      ['summary', 'published summary'],
    ])
  })
})

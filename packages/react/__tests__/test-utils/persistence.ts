import { waitFor } from '@testing-library/react'
import { BaseDb, metadata } from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'

/**
 * Wait until the item's property values are in the database.
 *
 * Use this instead of a fixed sleep after creating or editing an item. For plain values Item.create
 * has already written the rows by the time it resolves, so this usually returns on the first poll;
 * values that go through a save pipeline (Image/File/Html) are written asynchronously and are
 * waited for here.
 */
export async function waitForItemPersisted(
  item: { seedLocalId: string },
  expected: Record<string, string>,
  timeout = 5000,
): Promise<void> {
  const seedLocalId = item.seedLocalId
  await waitFor(
    async () => {
      const db = BaseDb.getAppDb()
      const rows = await db
        .select({ propertyName: metadata.propertyName, propertyValue: metadata.propertyValue })
        .from(metadata)
        .where(eq(metadata.seedLocalId, seedLocalId))
      for (const [propertyName, propertyValue] of Object.entries(expected)) {
        const found = rows.some(
          (r: { propertyName: string | null; propertyValue: string | null }) =>
            r.propertyName === propertyName && r.propertyValue === propertyValue,
        )
        if (!found) {
          throw new Error(`${propertyName}=${JSON.stringify(propertyValue)} not persisted for ${seedLocalId}`)
        }
      }
    },
    { timeout },
  )
}

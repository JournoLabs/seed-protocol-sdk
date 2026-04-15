import { int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Links Image seeds materialized from Html `data:image/*` URIs to the parent Item seed for co-publish.
 * Rows are removed after a successful publish (see clearHtmlEmbeddedImageCoPublishRows).
 */
export const htmlEmbeddedImageCoPublish = sqliteTable(
  'html_embedded_image_co_publish',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    parentSeedLocalId: text('parent_seed_local_id').notNull(),
    htmlSeedLocalId: text('html_seed_local_id').notNull(),
    imageSeedLocalId: text('image_seed_local_id').notNull(),
    /** Stable dedup key (e.g. sha256 of data URI or normalized URI string). */
    stableKey: text('stable_key').notNull(),
    createdAt: int('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('html_embed_co_pub_parent_html_stable').on(
      t.parentSeedLocalId,
      t.htmlSeedLocalId,
      t.stableKey,
    ),
  ],
)

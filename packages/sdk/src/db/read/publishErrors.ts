import type { ValidationError } from '@/Schema/validation'

/** Validation error collected during publish payload building. */
export type PublishValidationError = Pick<ValidationError, 'field' | 'message'> & { code?: string }

/** Error thrown when publish validation fails. Includes all validation errors for user to fix. */
export class PublishValidationFailedError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: PublishValidationError[],
  ) {
    super(message)
    this.name = 'PublishValidationFailedError'
  }
}

/** Validation error code for a relation, list member or image/file ref to an unpublished seed. */
export const RELATED_ITEM_UNPUBLISHED_CODE = 'related_item_unpublished'

/** A seed a publish would reference although its seed attestation was revoked (unpublished). */
export type UnpublishedRelatedItem = {
  /** The referring property on the item being published (or on an item published with it). */
  propertyName: string
  /** Model of the referenced item (e.g. `Author`, `Image`). */
  modelName: string
  seedLocalId: string
  /** The revoked seed uid the reference would attest. */
  seedUid: string
}

export const describeUnpublishedRelatedItem = (r: UnpublishedRelatedItem): string =>
  `${r.propertyName} -> ${r.modelName} ${r.seedLocalId} (seed ${r.seedUid})`

/**
 * Thrown before anything is uploaded or attested when the item references items whose seed was
 * unpublished: the parent would attest a revoked seed uid. Republish those items (which gives
 * them a new seed uid) or remove the references, then publish again.
 * See docs/ATTESTATION_REVOCATION.md ("Republishing").
 *
 * A PublishValidationFailedError, so validateItemForPublish and the publish package's checking
 * step report it as validation errors (code `related_item_unpublished`, one per reference).
 */
export class RelatedItemUnpublishedError extends PublishValidationFailedError {
  readonly unpublishedRelatedItems: UnpublishedRelatedItem[]

  constructor(
    unpublishedRelatedItems: UnpublishedRelatedItem[],
    otherValidationErrors: PublishValidationError[] = [],
  ) {
    const lines = unpublishedRelatedItems.map(describeUnpublishedRelatedItem)
    const message =
      `Cannot publish: it references ${lines.length} unpublished item${lines.length === 1 ? '' : 's'} ` +
      `(their seed attestations were revoked). Republish them or remove the references, then publish again:\n` +
      lines.join('\n')
    super(message, [
      ...unpublishedRelatedItems.map((r) => ({
        field: r.propertyName,
        message:
          `${r.propertyName} references unpublished ${r.modelName} ${r.seedLocalId} (seed ${r.seedUid}). ` +
          `Republish it or remove the reference.`,
        code: RELATED_ITEM_UNPUBLISHED_CODE,
      })),
      ...otherValidationErrors,
    ])
    this.name = 'RelatedItemUnpublishedError'
    this.unpublishedRelatedItems = unpublishedRelatedItems
  }
}

export type ItemCreateProblem = {
  /** The key passed to Item.create. */
  property: string
  message: string
  /**
   * 'unknown_property', or the validation code: 'type', 'pattern', 'min_length',
   * 'max_length_exceeded', 'enum_violation', 'format', or another named code.
   */
  code: string
}

/**
 * Thrown by Item.create when values don't fit the model: unknown keys, wrong types, or values
 * that break the property's validation rules. Nothing is left written: most values are checked
 * before anything is written, and File/Image/Html/ItemStorage values, checked as they're saved,
 * have their draft removed.
 */
export class ItemCreateValidationError extends Error {
  readonly modelName: string
  readonly problems: ItemCreateProblem[]

  constructor(modelName: string, problems: ItemCreateProblem[]) {
    super(
      `Cannot create ${modelName}: ` + problems.map((p) => `${p.property}: ${p.message}`).join('; '),
    )
    this.name = 'ItemCreateValidationError'
    this.modelName = modelName
    this.problems = problems
    Object.setPrototypeOf(this, ItemCreateValidationError.prototype)
  }
}

export type ItemCreateErrorCode =
  /** The property's instance didn't load in time, so its value couldn't be saved. */
  | 'property_not_loaded'
  /** The property's save pipeline failed or was refused; `cause` holds its error. */
  | 'save_failed'

/**
 * Thrown by Item.create when a File/Image/Html/ItemStorage value couldn't be saved for a reason
 * other than its rules (those throw ItemCreateValidationError). The draft is removed, as for
 * ItemCreateValidationError. `cause` holds the save's own error, e.g. an OwnershipError.
 */
export class ItemCreateError extends Error {
  readonly code: ItemCreateErrorCode
  readonly modelName: string
  /** The key passed to Item.create. */
  readonly property: string
  /** The removed draft's seedLocalId. */
  readonly seedLocalId: string

  constructor(
    message: string,
    details: { code: ItemCreateErrorCode; modelName: string; property: string; seedLocalId: string; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'ItemCreateError'
    this.code = details.code
    this.modelName = details.modelName
    this.property = details.property
    this.seedLocalId = details.seedLocalId
    Object.setPrototypeOf(this, ItemCreateError.prototype)
  }
}

/** Thrown by Item.create when no model with that name exists (in the given schema, if any). */
export class UnknownModelError extends Error {
  readonly modelName: string
  readonly schemaName?: string

  constructor(modelName: string, schemaName?: string) {
    super(`Model "${modelName}" not found${schemaName ? ` in schema "${schemaName}"` : ''}.`)
    this.name = 'UnknownModelError'
    this.modelName = modelName
    this.schemaName = schemaName
    Object.setPrototypeOf(this, UnknownModelError.prototype)
  }
}

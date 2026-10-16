export type ItemCreateProblem = {
  /** The key passed to Item.create. */
  property: string
  message: string
  /** 'unknown_property', or the validation code (e.g. 'pattern', 'type'). */
  code: string
}

/**
 * Thrown by Item.create when values don't fit the model: unknown keys, wrong types, or values
 * that break the property's validation rules. Nothing is written.
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

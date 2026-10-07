/**
 * Thrown when a model name exists in more than one schema and nothing says which one is meant.
 * Model names are only unique within a schema; pass `schemaName` (or `modelFileId`) to choose.
 */
export class AmbiguousModelError extends Error {
  readonly modelName: string
  readonly schemaNames: string[]

  constructor(modelName: string, schemaNames: string[]) {
    const names = [...new Set(schemaNames)].sort()
    super(
      `Model "${modelName}" exists in schemas ${names.map((n) => `"${n}"`).join(', ')}; ` +
        `pass schemaName (or modelFileId) to choose one.`,
    )
    this.name = 'AmbiguousModelError'
    this.modelName = modelName
    this.schemaNames = names
  }
}

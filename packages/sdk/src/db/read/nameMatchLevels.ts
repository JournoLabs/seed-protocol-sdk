import { eq } from 'drizzle-orm'
import {
  compareNameMatchTiers,
  DEFAULT_NAME_MATCH_LEVEL,
  isNameMatchLevel,
  type NameMatchLevel,
} from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'

/**
 * How strictly names from EAS match each local model and property (ADR 0009). A schema file sets
 * `nameMatch` on a property, a model, or at its top level; the first one set wins, else
 * DEFAULT_NAME_MATCH_LEVEL. Only names from EAS are matched this way; local code's names are exact.
 */
export type NameMatchLevels = {
  /** The level for a model's own name. Tightest across schemas that define the name. */
  model: (modelName: string) => NameMatchLevel
  /**
   * The level for a property. With `modelFileId` (Model.id), that model's schema; otherwise the
   * tightest across schemas that define the model.
   */
  property: (modelName: string, propertyName: string, modelFileId?: string | null) => NameMatchLevel
}

type SchemaFileLevels = {
  nameMatch?: unknown
  models?: Record<string, { id?: string; nameMatch?: unknown; properties?: Record<string, { nameMatch?: unknown }> }>
}

type ModelLevels = { model: NameMatchLevel; properties: Map<string, NameMatchLevel> }

const level = (value: unknown): NameMatchLevel | undefined => (isNameMatchLevel(value) ? value : undefined)

const tighter = (a: NameMatchLevel | undefined, b: NameMatchLevel): NameMatchLevel =>
  a === undefined || compareNameMatchTiers(b, a) < 0 ? b : a

/** The levels in one schema file for one of its models, or undefined when the file lacks the model. */
const modelLevelsFromFile = (file: SchemaFileLevels, modelName: string): ModelLevels | undefined => {
  const modelDef = file.models?.[modelName]
  if (!modelDef) return undefined
  const model = level(modelDef.nameMatch) ?? level(file.nameMatch) ?? DEFAULT_NAME_MATCH_LEVEL
  const properties = new Map<string, NameMatchLevel>()
  for (const [propertyName, def] of Object.entries(modelDef.properties ?? {})) {
    properties.set(propertyName, level(def?.nameMatch) ?? model)
  }
  return { model, properties }
}

/**
 * Builds NameMatchLevels from the schema files that own each model row. Exported for tests;
 * use {@link nameMatchLevels}.
 */
export const nameMatchLevelsFromRows = (
  rows: { modelName: string; modelFileId: string | null; schemaData: string | null }[],
): NameMatchLevels => {
  const byFileId = new Map<string, ModelLevels>()
  const byName = new Map<string, ModelLevels>()
  const parsed = new Map<string, SchemaFileLevels | undefined>()
  for (const row of rows) {
    if (!row.schemaData) continue
    if (!parsed.has(row.schemaData)) {
      try {
        parsed.set(row.schemaData, JSON.parse(row.schemaData) as SchemaFileLevels)
      } catch {
        parsed.set(row.schemaData, undefined)
      }
    }
    const file = parsed.get(row.schemaData)
    const levels = file && modelLevelsFromFile(file, row.modelName)
    if (!levels) continue
    if (row.modelFileId) byFileId.set(row.modelFileId, levels)
    const seen = byName.get(row.modelName)
    if (!seen) {
      byName.set(row.modelName, { model: levels.model, properties: new Map(levels.properties) })
      continue
    }
    seen.model = tighter(seen.model, levels.model)
    for (const [name, value] of levels.properties) seen.properties.set(name, tighter(seen.properties.get(name), value))
  }
  return {
    model: (modelName) => byName.get(modelName)?.model ?? DEFAULT_NAME_MATCH_LEVEL,
    property: (modelName, propertyName, modelFileId) => {
      const levels = (modelFileId ? byFileId.get(modelFileId) : undefined) ?? byName.get(modelName)
      return levels?.properties.get(propertyName) ?? levels?.model ?? DEFAULT_NAME_MATCH_LEVEL
    },
  }
}

const DEFAULT_LEVELS: NameMatchLevels = {
  model: () => DEFAULT_NAME_MATCH_LEVEL,
  property: () => DEFAULT_NAME_MATCH_LEVEL,
}

let current: NameMatchLevels | undefined
let loading: Promise<NameMatchLevels> | undefined

type Db = ReturnType<typeof BaseDb.getAppDb>

/** Reads the levels from the schema files stored with each model's schema row (schemas.schema_data). */
export const loadNameMatchLevels = async (db: Db | undefined = BaseDb.getAppDb()): Promise<NameMatchLevels> => {
  if (!db) return DEFAULT_LEVELS
  const load = (async () => {
    const rows = (await db
      .select({ modelName: modelsTable.name, modelFileId: modelsTable.schemaFileId, schemaData: schemasTable.schemaData })
      .from(modelsTable)
      .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))) as {
      modelName: string
      modelFileId: string | null
      schemaData: string | null
    }[]
    return nameMatchLevelsFromRows(rows)
  })()
  loading = load
  try {
    const levels = await load
    if (loading === load) {
      current = levels
      previous = undefined
    }
    return levels
  } finally {
    if (loading === load) loading = undefined
  }
}

/** The levels, loaded once and reused until a schema write clears them. */
export const nameMatchLevels = async (db: Db | undefined = BaseDb.getAppDb()): Promise<NameMatchLevels> =>
  current ?? loading ?? loadNameMatchLevels(db)

/**
 * The last loaded levels, for synchronous callers (Model.findByModelType). Init loads them before
 * it reports ready. After a schema write clears them, this returns the levels from before the
 * write until the reload that clear starts finishes.
 */
export const currentNameMatchLevels = (): NameMatchLevels => current ?? previous ?? DEFAULT_LEVELS

let previous: NameMatchLevels | undefined
let reloadScheduled = false

/**
 * Called when a schema row or its models are written. The next {@link nameMatchLevels} read
 * reloads, and a reload starts on the next tick (one per burst of writes) for synchronous callers.
 */
export const clearNameMatchLevels = (): void => {
  if (current) previous = current
  current = undefined
  loading = undefined
  if (reloadScheduled) return
  reloadScheduled = true
  setTimeout(() => {
    reloadScheduled = false
    if (current || loading || !BaseDb.isAppDbReady()) return
    loadNameMatchLevels().catch(() => {
      // The next nameMatchLevels() read retries.
    })
  }, 0)
}

/**
 * `nameMatch` values in a schema file that aren't a level. They are ignored (the next level up
 * applies); schema loads warn about them.
 */
export const invalidNameMatchValues = (file: SchemaFileLevels & { metadata?: { name?: string } }): string[] => {
  const problems: string[] = []
  const check = (where: string, value: unknown) => {
    if (value !== undefined && !isNameMatchLevel(value)) {
      problems.push(`${where} nameMatch ${JSON.stringify(value)} is not 'exact', 'normalized' or 'fuzzy'`)
    }
  }
  check('schema', file.nameMatch)
  for (const [modelName, modelDef] of Object.entries(file.models ?? {})) {
    check(modelName, modelDef?.nameMatch)
    for (const [propertyName, def] of Object.entries(modelDef?.properties ?? {})) {
      check(`${modelName}.${propertyName}`, def?.nameMatch)
    }
  }
  return problems
}

/** Warns about {@link invalidNameMatchValues}. */
export const warnOnInvalidNameMatch = (file: SchemaFileLevels & { metadata?: { name?: string } }): string[] => {
  const problems = invalidNameMatchValues(file)
  for (const problem of problems) {
    console.warn(`[seed] schema ${file.metadata?.name ?? ''}: ${problem}; it is ignored.`)
  }
  return problems
}

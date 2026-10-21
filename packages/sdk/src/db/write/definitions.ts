/**
 * The writers of definition rows: `schemas`, `models`, `properties` and `model_schemas` (SDK audit
 * T9). One upsert per table. Every function takes the database to write, normally a transaction
 * from {@link inDefinitionsTransaction}, and reads only through it: in the browser a query on
 * `BaseDb.getAppDb()` waits for an open transaction to end.
 *
 * The lookups here decide which row a definition is (a schema by file id, then by name; a model by
 * file id, then an adoptable row of that name; a property by file id, then by name in its model).
 * The unique keys (`schema_file_id` on all three tables, `properties(name, model_id)`,
 * `model_schemas(model_id, schema_id)`) are enforced by the database, and inserts resolve a
 * conflict with ON CONFLICT instead of a second lookup.
 */
import { and, eq, inArray } from 'drizzle-orm'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties, type NewModelRecord, type NewPropertyRecord, type PropertyType } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas } from '@/seedSchema/SchemaSchema'
import { resolveModelRecord, resolveRefModelRecord, type ResolvedModelRecord } from '@/db/read/resolveModelRecord'
import { AmbiguousModelError } from '@/Model/errors'
import { normalizeDataType } from '@/helpers/property'
import { propertyDefinitionColumn } from '@/helpers/propertyDefinition'
import { clearNameMatchLevels } from '@/db/read/nameMatchLevels'

const logger = debug('seedSdk:db:write:definitions')

/** The app database or a transaction on it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefinitionsDb = any

/**
 * Runs one user action on definitions (an apply, a save, a rename) in one transaction. `fn` must
 * write through `tx` only and have no other side effects: it is retried whole when another tab
 * holds the database.
 */
export const inDefinitionsTransaction = <T>(fn: (tx: DefinitionsDb) => Promise<T>): Promise<T> =>
  BaseDb.transaction(fn)

// ---------------------------------------------------------------------------------------------
// model_schemas

/** Links a model to a schema. Returns true when this call inserted the link. */
export async function linkModelToSchemaRow(db: DefinitionsDb, modelId: number, schemaId: number): Promise<boolean> {
  const inserted = await db
    .insert(modelSchemas)
    .values({ modelId, schemaId })
    .onConflictDoNothing()
    .returning({ id: modelSchemas.id })
  return inserted.length > 0
}

// ---------------------------------------------------------------------------------------------
// schemas

export type SchemaRowInput = {
  name: string
  version: number
  createdAt?: number | null
  updatedAt?: number | null
  schemaFileId?: string
  /** Full schema content as JSON (SchemaFileFormat). Left out, the row's is kept. */
  schemaData?: string
  isDraft?: boolean
  isEdited?: boolean
  /** The applied file's hash (applySchemaFile). Left out, the row's is kept. */
  contentHash?: string | null
}

type SchemaRow = typeof schemas.$inferSelect

/**
 * Writes a schema row and returns it with `inserted` set when it is new.
 *
 * The row is the one with `schemaFileId`, else one of that name: a draft write takes a draft of
 * that name; a published write takes a published row, else a draft (which it publishes). A
 * published row keeps its schemaFileId against another id of the same version, and keeps its newer
 * version against an older version's file. With `rowId` that row is written, found by the caller
 * (a rename finds it by the old name), and takes `schemaFileId`.
 */
export async function upsertSchemaRow(
  db: DefinitionsDb,
  input: SchemaRowInput,
  options: { rowId?: number } = {},
): Promise<SchemaRow & { inserted: boolean }> {
  // The stored schema file may change its nameMatch levels (ADR 0009).
  clearNameMatchLevels()
  const { schemaFileId, schemaData, isDraft, isEdited, contentHash } = input

  const update = async (existing: SchemaRow, updates: Partial<typeof schemas.$inferInsert>) => {
    if (input.name && existing.name !== input.name) updates.name = input.name
    if (schemaData !== undefined) updates.schemaData = schemaData
    if (contentHash !== undefined && existing.contentHash !== contentHash) updates.contentHash = contentHash
    if (input.version !== undefined && existing.version !== input.version) updates.version = input.version
    if (isDraft !== undefined && existing.isDraft !== isDraft) updates.isDraft = isDraft
    if (isEdited !== undefined && existing.isEdited !== isEdited) updates.isEdited = isEdited
    if (input.updatedAt && existing.updatedAt !== input.updatedAt) updates.updatedAt = input.updatedAt
    if (Object.keys(updates).length > 0) {
      await db.update(schemas).set(updates).where(eq(schemas.id, existing.id))
    }
    return { ...existing, ...updates, inserted: false }
  }

  if (options.rowId !== undefined) {
    const [row] = await db.select().from(schemas).where(eq(schemas.id, options.rowId)).limit(1)
    if (!row) throw new Error(`Schema row ${options.rowId} not found`)
    return update(row, schemaFileId && row.schemaFileId !== schemaFileId ? { schemaFileId } : {})
  }

  if (schemaFileId) {
    const [byFileId] = await db.select().from(schemas).where(eq(schemas.schemaFileId, schemaFileId)).limit(1)
    if (byFileId) return update(byFileId, {})
  }

  if (isDraft === true) {
    const [byName] = await db.select().from(schemas).where(eq(schemas.name, input.name)).limit(1)
    if (byName?.isDraft === true) {
      const updates: Partial<typeof schemas.$inferInsert> = { updatedAt: input.updatedAt || Date.now() }
      if (schemaFileId && byName.schemaFileId !== schemaFileId) updates.schemaFileId = schemaFileId
      return update(byName, updates)
    }
  }

  // By name: a published write prefers a published row, then takes a draft of that name.
  let [existing] = await db
    .select()
    .from(schemas)
    .where(isDraft === false ? and(eq(schemas.name, input.name), eq(schemas.isDraft, false)) : eq(schemas.name, input.name))
    .limit(1)
  if (!existing && isDraft === false) {
    ;[existing] = await db
      .select()
      .from(schemas)
      .where(and(eq(schemas.name, input.name), eq(schemas.isDraft, true)))
      .limit(1)
  }

  if (existing) {
    // A complete schema file can bring a version under its own id (imported files may not keep it).
    const isOtherVersionFile =
      !!schemaFileId &&
      !!existing.schemaFileId &&
      existing.schemaFileId !== schemaFileId &&
      existing.isDraft !== true &&
      input.version !== undefined &&
      input.version !== existing.version
    if (isOtherVersionFile && input.version < existing.version) {
      // An older version's file: rolling the row back to it would leave the newer version's id
      // pointing at the older version's data.
      logger(`Keeping schema "${input.name}" at v${existing.version}; not replacing it with older v${input.version}`)
      return { ...existing, inserted: false }
    }
    const updates: Partial<typeof schemas.$inferInsert> = {}
    // A published row keeps its id unless this is a newer version's file; a draft or id-less row
    // takes the new one.
    if (
      schemaFileId &&
      existing.schemaFileId !== schemaFileId &&
      (existing.isDraft === true || !existing.schemaFileId || isOtherVersionFile)
    ) {
      updates.schemaFileId = schemaFileId
    }
    return update(existing, updates)
  }

  const [row] = await db
    .insert(schemas)
    .values({
      name: input.name,
      version: input.version,
      schemaFileId: schemaFileId || null,
      schemaData: schemaData || null,
      contentHash: contentHash ?? null,
      isDraft: isDraft ?? false,
      isEdited: isEdited ?? false,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .returning()
  return { ...row, inserted: true }
}

// ---------------------------------------------------------------------------------------------
// models

/**
 * Writes the models row with `schemaFileId`, or inserts a name-only row without one. An existing
 * row takes `name`; `isEdited` is set on insert only.
 */
export async function upsertModelRow(
  db: DefinitionsDb,
  input: { name: string; schemaFileId?: string | null; isEdited?: boolean },
): Promise<NewModelRecord> {
  const values = { name: input.name, schemaFileId: input.schemaFileId || null, isEdited: input.isEdited ?? false }
  if (!values.schemaFileId) {
    const [row] = await db.insert(modelsTable).values(values).returning()
    return row
  }
  const [row] = await db
    .insert(modelsTable)
    .values(values)
    .onConflictDoUpdate({ target: modelsTable.schemaFileId, set: { name: input.name } })
    .returning()
  return row
}

/** Name-only models rows for the names that have none yet. Returns every row of those names. */
export async function insertModelStubs(
  db: DefinitionsDb,
  modelNames: string[],
): Promise<Array<{ id: number; name: string; schemaFileId: string | null }>> {
  const columns = { id: modelsTable.id, name: modelsTable.name, schemaFileId: modelsTable.schemaFileId }
  const rows = modelNames.length
    ? await db.select(columns).from(modelsTable).where(inArray(modelsTable.name, modelNames))
    : []
  const missing = [...new Set(modelNames)].filter((name) => !rows.some((row: { name: string }) => row.name === name))
  if (missing.length > 0) {
    rows.push(...(await db.insert(modelsTable).values(missing.map((name) => ({ name }))).returning(columns)))
  }
  return rows
}

const isLinkedTo = async (db: DefinitionsDb, modelId: number, schemaId?: number) => {
  const links: Array<{ schemaId: number | null }> = await db
    .select({ schemaId: modelSchemas.schemaId })
    .from(modelSchemas)
    .where(eq(modelSchemas.modelId, modelId))
  return {
    any: links.length > 0,
    other: links.some((link) => link.schemaId !== schemaId),
  }
}

/**
 * Finds or creates the models row for `modelName` in a schema, by `modelFileId` (preferred) or
 * name. Model names are only unique per schema, so a same-name row is reused only when no other
 * schema claims it: a null-schemaFileId stub (from ref resolution or init), or for a ref without a
 * file id, this schema's row. A row with a file id that no schema links is a deleted schema's
 * leftover and is not adopted. An adopted row takes `modelFileId`.
 */
export async function findOrCreateModelRow(
  db: DefinitionsDb,
  modelName: string,
  modelFileId?: string,
  schemaId?: number,
): Promise<NewModelRecord> {
  if (modelFileId) {
    const [byFileId] = await db.select().from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId)).limit(1)
    if (byFileId) {
      if (byFileId.name === modelName) return byFileId
      await db.update(modelsTable).set({ name: modelName }).where(eq(modelsTable.id, byFileId.id))
      return { ...byFileId, name: modelName }
    }
  }

  const byName: NewModelRecord[] = await db.select().from(modelsTable).where(eq(modelsTable.name, modelName))
  let chosen: NewModelRecord | undefined
  if (byName.length > 0) {
    if (!modelFileId && schemaId && byName.length > 1) {
      for (const candidate of byName) {
        const links = await isLinkedTo(db, candidate.id!, schemaId)
        if (links.any && !links.other) {
          chosen = candidate
          break
        }
      }
    }
    chosen ??= byName.find((row) => !row.schemaFileId)
    if (!chosen && modelFileId) {
      // Every same-name row has another file id: adopt only one no other schema claims.
      for (const candidate of byName) {
        const links = await isLinkedTo(db, candidate.id!, schemaId)
        if (candidate.schemaFileId && !links.any) continue
        if (!links.other) {
          chosen = candidate
          break
        }
      }
    } else if (!chosen) {
      chosen = (byName.length === 1 ? byName[0] : undefined) || byName.find((row) => !!row.schemaFileId) || byName[0]
    }
  }

  if (chosen && modelFileId && chosen.schemaFileId !== modelFileId) {
    // Adopt a stub or an unclaimed same-name row by giving it this file id.
    await db.update(modelsTable).set({ schemaFileId: modelFileId, isEdited: false }).where(eq(modelsTable.id, chosen.id!))
    logger(`Adopted existing model "${modelName}" (id: ${chosen.id}) with schemaFileId "${modelFileId}"`)
    return { ...chosen, schemaFileId: modelFileId, isEdited: false }
  }
  if (chosen) return chosen
  return upsertModelRow(db, { name: modelName, schemaFileId: modelFileId })
}

/**
 * Finds or creates the models row a Relation property on `ownerModelId` points to: the ref model
 * in the owner's schema(s) first, since model names are only unique per schema.
 */
export async function findOrCreateRefModelRow(
  db: DefinitionsDb,
  refModelName: string,
  ownerModelId: number,
): Promise<{ id?: number | null }> {
  try {
    const ref = await resolveRefModelRecord(refModelName, { modelId: ownerModelId }, db)
    if (ref) return ref
  } catch (error) {
    // Not in the owner's schema and defined by several others: pick/create like an import does
    if (!(error instanceof AmbiguousModelError)) throw error
  }
  const [ownerLink] = await db
    .select({ schemaId: modelSchemas.schemaId })
    .from(modelSchemas)
    .where(eq(modelSchemas.modelId, ownerModelId))
    .limit(1)
  return findOrCreateModelRow(db, refModelName, undefined, ownerLink?.schemaId ?? undefined)
}

/**
 * Renames a model. With `schemaNameOrId` only that schema's model is renamed; without it the name
 * alone is used, which throws AmbiguousModelError when several schemas define it. When the new
 * name already exists in the scope that row is returned unchanged. Unscoped, a missing model is
 * inserted under the new name.
 */
export async function renameModelRow(
  db: DefinitionsDb,
  oldName: string,
  newName: string,
  schemaNameOrId?: string | number,
): Promise<NewModelRecord> {
  const scope =
    schemaNameOrId === undefined
      ? {}
      : typeof schemaNameOrId === 'number'
        ? { schemaId: schemaNameOrId, strict: true }
        : { schemaName: schemaNameOrId, strict: true }

  const model: ResolvedModelRecord | undefined = await resolveModelRecord(oldName, scope, db)
  if (!model) {
    if (schemaNameOrId !== undefined) throw new Error(`Model "${oldName}" not found in schema "${schemaNameOrId}"`)
    return upsertModelRow(db, { name: newName })
  }
  const existingWithNewName = await resolveModelRecord(newName, scope, db)
  if (existingWithNewName) return existingWithNewName as NewModelRecord
  await db.update(modelsTable).set({ name: newName }).where(eq(modelsTable.id, model.id))
  return { ...model, name: newName } as NewModelRecord
}

// ---------------------------------------------------------------------------------------------
// properties

export type PropertyStorageColumns = Pick<NewPropertyRecord, 'storageType' | 'localStorageDir' | 'filenameSuffix'>

export type PropertyRowInput = {
  modelId: number
  name: string
  /** Left out: an existing row keeps its data type. */
  dataType: string | undefined
  /** The property's id (schema_file_id). */
  schemaFileId?: string | null
  /** The name the row had before a rename, to find a row without a matching schema_file_id. */
  previousName?: string
  /** The Relation target's models row, when the caller resolved it. */
  refModelId?: number | null
  /** The Relation target's model name, resolved in the owner's schema (see findOrCreateRefModelRow). */
  refModelName?: string | null
  refValueType?: string | null
  /** Left out: an existing row keeps its value, a new row stores false. */
  required?: boolean
  /** Left out: an existing row keeps its storage columns, a new row stores none. */
  storage?: PropertyStorageColumns
  /** Left out: an existing row keeps its flag, a new row stores false. */
  isEdited?: boolean
  /**
   * The property's definition in any accepted shape, for the `definition` column. Merged over the
   * stored one (fields it lacks are kept: a payload without validation must not drop stored rules)
   * unless `replaceDefinition`. Left out: an existing row keeps its definition.
   */
  definition?: Record<string, any>
  /** The definition is the whole truth (a schema file's property): it replaces the stored one. */
  replaceDefinition?: boolean
}

export type PropertyRowOptions = {
  /** An existing row keeps its own schema_file_id; `schemaFileId` is used on insert only. */
  keepStoredSchemaFileId?: boolean
  /** Leave a row the user has edited (is_edited) as it is. Schema files use this. */
  keepEditedRow?: boolean
}

export type PropertyRowResult = {
  row: PropertyType | undefined
  /** True when this call inserted or changed the row. */
  changed: boolean
}

const propertyRowFields = [
  'name',
  'modelId',
  'dataType',
  'schemaFileId',
  'refModelId',
  'refValueType',
  'required',
  'isEdited',
  'storageType',
  'localStorageDir',
  'filenameSuffix',
  'definition',
] as const

/**
 * Writes the properties row for a property definition. The row is the one with `schemaFileId`,
 * else the one named `previousName` or `name` in the model. A row with that schema_file_id on
 * another model is left alone. The rules for fields the input leaves out are on
 * {@link PropertyRowInput}; an unchanged row is not written.
 */
export async function upsertPropertyRow(
  db: DefinitionsDb,
  input: PropertyRowInput,
  options: PropertyRowOptions = {},
): Promise<PropertyRowResult> {
  let existing: PropertyType | undefined
  if (input.schemaFileId) {
    ;[existing] = await db.select().from(properties).where(eq(properties.schemaFileId, input.schemaFileId)).limit(1)
    if (existing && existing.modelId !== input.modelId) {
      logger(`Property ${input.name} (${input.schemaFileId}) belongs to model row ${existing.modelId}, not ${input.modelId}; left as is`)
      return { row: existing, changed: false }
    }
  }
  for (const name of [input.previousName, input.name]) {
    if (existing || !name) continue
    ;[existing] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.name, name), eq(properties.modelId, input.modelId)))
      .limit(1)
  }

  if (existing && options.keepEditedRow && existing.isEdited === true) {
    logger(`Keeping locally edited property row ${existing.name} (id ${existing.id})`)
    return { row: existing, changed: false }
  }

  let refModelId = input.refModelId ?? null
  if (input.refModelName && input.refModelId == null) {
    refModelId = (await findOrCreateRefModelRow(db, input.refModelName, input.modelId)).id ?? null
  }

  const values: NewPropertyRecord = {
    name: input.name,
    modelId: input.modelId,
    dataType: input.dataType ? normalizeDataType(input.dataType) : (existing?.dataType ?? ''),
    schemaFileId:
      (options.keepStoredSchemaFileId && existing?.schemaFileId) || input.schemaFileId || existing?.schemaFileId || null,
    refModelId,
    refValueType: input.refValueType ? normalizeDataType(input.refValueType) : null,
    required: input.required ?? existing?.required ?? false,
    isEdited: input.isEdited ?? existing?.isEdited ?? false,
    storageType: input.storage ? (input.storage.storageType ?? null) : (existing?.storageType ?? null),
    localStorageDir: input.storage ? (input.storage.localStorageDir ?? null) : (existing?.localStorageDir ?? null),
    filenameSuffix: input.storage ? (input.storage.filenameSuffix ?? null) : (existing?.filenameSuffix ?? null),
    definition: input.definition
      ? propertyDefinitionColumn(input.definition, input.replaceDefinition ? null : existing?.definition)
      : (existing?.definition ?? null),
  }

  if (existing) {
    const unchanged = propertyRowFields.every((field) => (existing![field] ?? null) === (values[field] ?? null))
    if (unchanged) return { row: existing, changed: false }
    await db.update(properties).set(values).where(eq(properties.id, existing.id))
    return { row: { ...existing, ...values } as PropertyType, changed: true }
  }

  const { name, modelId, ...rest } = values
  const [row] = await db
    .insert(properties)
    .values(values)
    .onConflictDoUpdate(
      values.schemaFileId
        ? { target: properties.schemaFileId, set: { name, ...rest } }
        : { target: [properties.name, properties.modelId], set: rest },
    )
    .returning()
  return { row, changed: true }
}

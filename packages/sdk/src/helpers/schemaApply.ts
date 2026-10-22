/**
 * The one path between schema files and the database (ADR 0016, audit D5):
 *
 * - {@link applySchemaFile}: a schema file (any accepted shape) → its stored version file and the
 *   schema, model, property and link rows, in one transaction. Skipped when the row already
 *   records the file's id, version and content hash.
 * - {@link resolveSchemaRow}: a schema row → its definition.
 * - {@link writeNextSchemaVersion}: the previous version file + a patch → the next version file,
 *   then applied.
 *
 * Schema identity is the file id. Missing ids are assigned once, at first apply, and written into
 * the stored file.
 */
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { getContentHash, getDeterministicId } from '@/helpers/crypto'
import { isInternalSchema } from '@/helpers/constants'
import { ModelPropertyDataTypes, normalizePropertyRecordSchema } from '@/helpers/property'
import { refreshCachedProperties } from '@/helpers/cachedPropertyRefresh'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import {
  findLatestSchemaFile,
  getSchemaFilePath,
  listCompleteSchemaFiles,
  normalizeSchemaModels,
  readSchemaFile,
} from '@/helpers/schema'
import { warnOnInvalidNameMatch } from '@/db/read/nameMatchLevels'
import { inDefinitionsTransaction, upsertSchemaRow } from '@/db/write/definitions'
import { schemas as schemasTable, type SchemaType } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import type { JsonImportSchema, SchemaFileFormat, SchemaFileInput } from '@/types/import'
import type { ModelDefinitions, ModelClassType } from '@/types'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { easName } from '@seedprotocol/eas'
import { easPropertyNameForPublish } from '@/helpers/metadataPropertyNames'
import debug from 'debug'

const logger = debug('seedSdk:helpers:schemaApply')

export const SCHEMA_FILE_FORMAT = 'https://seedprotocol.org/schemas/data-model/v1'

type Db = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/** What a schema file can arrive as: complete, `config.schema`'s shape, or `{ name, models }`. */
export type SchemaFileSource = SchemaFileFormat | SchemaFileInput | JsonImportSchema

/**
 * A complete schema file from any accepted shape: models and properties as objects, `version`
 * 1, timestamps now, empty `enums` and `migrations` when missing. Ids are left as they are.
 */
export function toSchemaFile(source: SchemaFileSource): SchemaFileFormat {
  const data = JSON.parse(JSON.stringify(source)) as Record<string, any>
  const name: string | undefined = data.metadata?.name ?? data.name
  if (!name) {
    throw new Error('Schema name is required (either at top level or in metadata.name)')
  }
  const now = new Date().toISOString()
  const { name: _minimalName, ...rest } = data
  return {
    ...rest,
    $schema: data.$schema ?? SCHEMA_FILE_FORMAT,
    version: data.version ?? 1,
    metadata: {
      ...data.metadata,
      name,
      createdAt: data.metadata?.createdAt ?? now,
      updatedAt: data.metadata?.updatedAt ?? now,
    },
    models: normalizeSchemaModels(data.models),
    enums: data.enums ?? {},
    migrations: data.migrations ?? [],
  } as SchemaFileFormat
}

/** JSON with object keys sorted, so equal content gives equal text. */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  )

/** Hash of a schema file's content. The metadata timestamps don't count. */
export const schemaContentHash = (file: SchemaFileFormat): Promise<string> =>
  getContentHash(stableStringify({ ...file, metadata: { name: file.metadata.name } }))

/**
 * The id a schema, model or property gets when its file has none and no stored version of the
 * schema has one for that name: derived from the names, so it is the same on every device.
 */
export const deriveSchemaFileId = (...names: string[]): string => getDeterministicId(names.join('/'))

const propertyId = (prop: { id?: string; schemaFileId?: string } | undefined) => prop?.id ?? prop?.schemaFileId

/**
 * Fills in missing schema, model and property ids, in place. An id the stored schema (row by
 * this file's id, else by its name) already has for the same name is kept, so ids don't move once
 * assigned; anything new gets {@link deriveSchemaFileId}.
 */
async function assignSchemaIds(db: Db, file: SchemaFileFormat): Promise<void> {
  const models = Object.entries(file.models)
  const complete =
    !!file.id && models.every(([, model]) => model.id && Object.values(model.properties ?? {}).every((p) => p?.id))
  if (complete) return

  const [row] = file.id
    ? await db.select().from(schemasTable).where(eq(schemasTable.schemaFileId, file.id)).limit(1)
    : await db.select().from(schemasTable).where(eq(schemasTable.name, file.metadata.name)).orderBy(desc(schemasTable.version)).limit(1)
  const stored = row ? (await resolveSchemaRow(row, db))?.schema : undefined

  const schemaName = file.metadata.name
  file.id ??= stored?.id ?? deriveSchemaFileId(schemaName)
  for (const [modelName, model] of models) {
    const storedModel = stored?.models?.[modelName]
    model.id ??= storedModel?.id ?? deriveSchemaFileId(schemaName, modelName)
    model.properties ??= {}
    for (const [propName, prop] of Object.entries(model.properties)) {
      if (!prop || prop.id) continue
      prop.id = propertyId(storedModel?.properties?.[propName]) ?? deriveSchemaFileId(schemaName, modelName, propName)
    }
  }
}

/**
 * A schema file property as Model instances and property rows take it: the file's keys read by
 * {@link normalizePropertyRecordSchema} (`type` or `dataType`; a Relation's target from `model`,
 * `ref` or `refModelName`; storage as an object or as columns), reduced to the definition fields.
 */
export function schemaFilePropertyDefinition(
  modelName: string,
  propName: string,
  prop: Record<string, any>,
): Record<string, any> {
  const def = normalizePropertyRecordSchema(prop) as Record<string, any>
  const isList = def.dataType === ModelPropertyDataTypes.List
  if (isList && !def.refValueType) {
    const preview = JSON.stringify(prop).slice(0, 200)
    throw new Error(
      `List property "${propName}" in model "${modelName}" requires "refValueType" (e.g. refValueType: "Text" or refValueType: "Relation" with ref: "Tag"). ` +
        `Property has keys: [${Object.keys(prop).join(', ')}]. Raw property: ${preview}${preview.length >= 200 ? '...' : ''}`,
    )
  }
  const hasRef = isList || def.dataType === ModelPropertyDataTypes.Relation
  const id = propertyId(prop)
  return Object.fromEntries(
    Object.entries({
      id,
      dataType: def.dataType,
      ref: hasRef ? def.ref : undefined,
      refModelName: hasRef ? def.refModelName : undefined,
      refValueType: hasRef ? def.refValueType : undefined,
      storageType: def.storageType,
      localStorageDir: def.localStorageDir,
      filenameSuffix: def.filenameSuffix,
      required: def.required === undefined ? undefined : !!def.required,
      validation: def.validation && typeof def.validation === 'object' ? def.validation : undefined,
      htmlEmbeddedDataUriPolicy: def.htmlEmbeddedDataUriPolicy,
    }).filter(([, value]) => value !== undefined),
  )
}

/**
 * Every model's property definitions ({@link schemaFilePropertyDefinition}), by model name.
 * The property rows' columns are written from these; their `definition` column from the file's
 * property objects.
 */
export function schemaFilePropertyDefinitions(file: SchemaFileFormat): Map<string, { [propName: string]: any }> {
  return new Map(
    Object.entries(file.models).map(([modelName, model]) => [
      modelName,
      Object.fromEntries(
        Object.entries(model.properties ?? {}).map(([propName, prop]) => [
          propName,
          schemaFilePropertyDefinition(modelName, propName, prop ?? {}),
        ]),
      ),
    ]),
  )
}

/**
 * Model instances for a schema's models, from its definition. Their rows are already written
 * (by {@link applySchemaFile} or an earlier run), so each new instance adopts its row instead of
 * writing one; a model already cached is returned as it is.
 */
export async function createModelsForSchemaFile(file: SchemaFileFormat): Promise<ModelDefinitions> {
  const { Model } = await import('@/Model/Model')
  const definitions = schemaFilePropertyDefinitions(file)
  const result: ModelDefinitions = {}
  for (const [modelName, model] of Object.entries(file.models)) {
    const modelFileId = model.id
    // No hold: a loaded Schema holds its models (loadOrCreateSchema)
    result[modelName] = Model.create(modelName, file.metadata.name, {
      modelFileId,
      id: modelFileId,
      properties: definitions.get(modelName) ?? {},
      waitForReady: false,
      persistedBy: Promise.resolve(),
      hold: false,
    }) as unknown as ModelClassType
  }
  return result
}

/**
 * Warns when two models, or two properties of one model, have the same EAS name (ADR 0008): they
 * would publish to the same EAS schema (`HTMLPage` and `HtmlPage` are both `html_page`). A warning,
 * not an error, so schema files that already load keep loading.
 */
export function warnOnEasNameCollisions(schemaFile: Pick<SchemaFileFormat, 'models'> & { metadata?: { name?: string } }): string[] {
  const warnings: string[] = []
  const collisions = (names: [string, string][]) => {
    const byEasName = new Map<string, string[]>()
    for (const [name, eas] of names) byEasName.set(eas, [...(byEasName.get(eas) ?? []), name])
    return [...byEasName.entries()].filter(([, group]) => group.length > 1)
  }
  const models = Object.entries(schemaFile.models ?? {})
  for (const [eas, group] of collisions(models.map(([name]) => [name, easName(name)]))) {
    warnings.push(`models ${group.join(', ')} all publish as "bytes32 ${eas}"`)
  }
  for (const [modelName, model] of models) {
    const properties = Object.entries((model as { properties?: Record<string, any> })?.properties ?? {})
    const named = properties.map(([key, def]): [string, string] => [
      key,
      easPropertyNameForPublish(key, { ...def, dataType: def?.dataType ?? def?.type, name: key }),
    ])
    for (const [eas, group] of collisions(named)) {
      warnings.push(`${modelName} properties ${group.join(', ')} all publish as "${eas}"`)
    }
  }
  for (const warning of warnings) {
    console.warn(`[seed] schema ${schemaFile.metadata?.name ?? ''}: ${warning}; EAS can't tell them apart.`)
  }
  return warnings
}

/** Writes a schema version file under its `<id>_<name>_v<n>.json` name and returns the path. */
async function writeSchemaFile(file: SchemaFileFormat): Promise<string> {
  const filePath = getSchemaFilePath(file.id!, file.metadata.name, file.version)
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getWorkingDir())
  await BaseFileManager.saveFile(filePath, JSON.stringify(file, null, 2))
  return filePath
}

export type ApplySchemaFileOptions = {
  /** Model renames (old name → new name) this version makes; their rows are renamed, not added. */
  modelRenames?: Map<string, string>
  /**
   * Keep the file as the version file `<id>_<name>_v<n>.json`. Default true; never for the
   * internal schema.
   */
  store?: boolean
  /**
   * A stored version file with this id and version but other content: `'throw'` (default),
   * `'replace'` it (an app's `config.schema` is canonical), or store this one as the next version
   * (`'bump'`, for minimal `{ name, models }` imports).
   */
  onChangedContent?: 'throw' | 'replace' | 'bump'
}

export type AppliedSchemaFile = {
  /** The file as stored and applied, ids included. */
  schemaFile: SchemaFileFormat
  /** Its version file; undefined for the internal schema. */
  filePath?: string
  schemaRecord: SchemaType
  /** The row already recorded this file id, version and content hash, so nothing was written. */
  skipped: boolean
  models: ModelDefinitions
}

/** Names of models the stored published schema has and the file drops (a model keeping its id was renamed). */
async function getModelsDroppedFromStoredSchema(row: SchemaType | undefined, file: SchemaFileFormat): Promise<string[]> {
  if (!row || row.isDraft || !row.schemaData || row.version > file.version) return []
  let storedModels: SchemaFileFormat['models']
  try {
    storedModels = normalizeSchemaModels((JSON.parse(row.schemaData) as SchemaFileFormat).models ?? {})
  } catch {
    return []
  }
  const modelIds = new Set(Object.values(file.models).map((model) => model.id).filter(Boolean))
  return Object.entries(storedModels)
    .filter(([name, model]) => !(name in file.models) && !(model.id && modelIds.has(model.id)))
    .map(([name]) => name)
}

/**
 * Applies a schema file: assigns missing ids ({@link assignSchemaIds}), stores the version file,
 * and writes the schema row, model rows, property rows and model_schemas links in one
 * transaction. The row records the file's id, version and content hash; a file whose three match
 * the row (and whose models are all linked) is not written again. Returns the schema's Model
 * instances either way.
 */
export async function applySchemaFile(
  source: SchemaFileSource,
  options: ApplySchemaFileOptions = {},
): Promise<AppliedSchemaFile> {
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not found')

  const file = toSchemaFile(source)
  const internal = isInternalSchema(file.metadata.name, file.id)
  await assignSchemaIds(db, file)

  let filePath: string | undefined
  if (options.store !== false && !internal) {
    filePath = await storeSchemaFile(file, options.onChangedContent ?? 'throw')
  }

  const contentHash = await schemaContentHash(file)
  const [row] = await db.select().from(schemasTable).where(eq(schemasTable.schemaFileId, file.id!)).limit(1)
  let schemaRecord: SchemaType | undefined
  if (row && !row.isDraft && row.version === file.version && row.contentHash === contentHash) {
    const [{ linked }] = await db
      .select({ linked: count() })
      .from(modelSchemas)
      .where(eq(modelSchemas.schemaId, row.id))
    if (Number(linked) >= Object.keys(file.models).length) schemaRecord = row
  }
  const skipped = !!schemaRecord

  if (!schemaRecord) {
    warnOnEasNameCollisions(file)
    warnOnInvalidNameMatch(file)
    const { addModelsToDb, broadcastSchemasInvalidate } = await import('./db')
    const modelFileIds = new Map(Object.entries(file.models).map(([name, model]) => [name, model.id!]))
    const propertyDefinitions = schemaFilePropertyDefinitions(file)
    const propertyFileIds = new Map(
      [...propertyDefinitions].map(([modelName, defs]) => [
        modelName,
        new Map(Object.entries(defs).map(([propName, def]) => [propName, def.id as string])),
      ]),
    )
    const dropped = await getModelsDroppedFromStoredSchema(
      row ?? (await db.select().from(schemasTable).where(eq(schemasTable.name, file.metadata.name)).limit(1))[0],
      file,
    )

    let updatedPropertyFileIds: string[] = []
    let inserted = false
    schemaRecord = await inDefinitionsTransaction(async (tx: Db) => {
      const { inserted: isNew, ...record } = await upsertSchemaRow(tx, {
        name: file.metadata.name,
        version: file.version,
        createdAt: new Date(file.metadata.createdAt).getTime(),
        updatedAt: new Date(file.metadata.updatedAt).getTime(),
        schemaFileId: file.id,
        schemaData: JSON.stringify(file, null, 2),
        isDraft: false,
        contentHash,
      })
      inserted = isNew
      updatedPropertyFileIds = await addModelsToDb(
        {},
        record,
        options.modelRenames,
        {
          schemaFileId: file.id,
          modelFileIds,
          propertyFileIds,
          propertyDefinitions,
          propertyFileDefinitions: new Map(Object.entries(file.models).map(([name, model]) => [name, model.properties ?? {}])),
        },
        { db: tx },
      )
      if (dropped.length > 0) await unlinkModelsFromSchema(tx, record.id, dropped)
      return record
    })
    if (inserted) broadcastSchemasInvalidate()
    // A cached instance is otherwise never re-read from its row (createById returns it as is)
    await refreshCachedProperties(updatedPropertyFileIds)
    logger(`Applied schema ${file.metadata.name} v${file.version} (${file.id})`)
  } else {
    logger(`Schema ${file.metadata.name} v${file.version} (${file.id}) already applied`)
  }

  const models = await createModelsForSchemaFile(file)
  // Callers use the models next (an item create reads their properties): wait until each has them.
  // A model stopped meanwhile (its schema evicted) ends the wait at once.
  await Promise.all(
    Object.values(models).map((model) =>
      waitForEntityReady(model as unknown as Parameters<typeof waitForEntityReady>[0], { throwOnError: false }),
    ),
  )
  return { schemaFile: file, filePath, schemaRecord: schemaRecord!, skipped, models }
}

/**
 * Stores the file as its version file. A stored file of the same id and version is kept when its
 * content is the same; otherwise `onChangedContent` decides.
 */
async function storeSchemaFile(
  file: SchemaFileFormat,
  onChangedContent: NonNullable<ApplySchemaFileOptions['onChangedContent']>,
): Promise<string> {
  const versions = (await listCompleteSchemaFiles()).filter((info) => info.schemaFileId === file.id)
  const sameVersion = versions.find((info) => info.version === file.version)
  if (!sameVersion) return writeSchemaFile(file)

  const stored = await readSchemaFile(sameVersion.filePath)
  if (stored && stored.id === undefined) stored.id = file.id
  if (stored && (await schemaContentHash(stored)) === (await schemaContentHash(file))) {
    // Same content: the stored file's timestamps stand
    file.metadata = stored.metadata
    return sameVersion.filePath
  }
  if (onChangedContent === 'throw') {
    throw new Error(
      `Schema ${file.metadata.name} v${file.version} already exists with different content ` +
        `(schema id ${file.id}). Bump the schema's version, or delete the existing file first.`,
    )
  }
  if (onChangedContent === 'bump') {
    file.version = Math.max(...versions.map((info) => info.version)) + 1
    logger(`Schema ${file.metadata.name} content changed, storing it as v${file.version}`)
    return writeSchemaFile(file)
  }
  console.warn(
    `[seed] schema ${file.metadata.name} v${file.version}: content changed but id ` +
      `${file.id} and version did not; replacing the stored schema file. Bump "version" when the schema changes.`,
  )
  const filePath = await writeSchemaFile(file)
  if (sameVersion.filePath !== filePath) {
    const fs = await BaseFileManager.getFs()
    await fs.promises.unlink(sameVersion.filePath).catch(() => {})
  }
  return filePath
}

/** Delete the model_schemas rows linking the named models to the schema. The models and their items stay. */
async function unlinkModelsFromSchema(db: Db, schemaId: number, modelNames: string[]): Promise<void> {
  const links = await db
    .select({ id: modelSchemas.id })
    .from(modelSchemas)
    .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
    .where(and(eq(modelSchemas.schemaId, schemaId), inArray(modelsTable.name, modelNames)))
  if (links.length === 0) return
  await db.delete(modelSchemas).where(inArray(modelSchemas.id, links.map((link: { id: number }) => link.id)))
  logger(`Unlinked models dropped from the schema (schema id ${schemaId}): ${modelNames.join(', ')}`)
}

/**
 * A schema row's definition. A draft row's is its `schema_data`; a published row's is its
 * (schema_file_id, version) file, else its `schema_data`; a row with neither starts empty. The
 * internal schema has no stored file (applySchemaFile skips it), so its row reads `schema_data`. The
 * row's name and id win over the file's, and the models linked to the row are merged in
 * (`mergeDbModelsIntoSchemaModels`: the rows decide which models and properties exist; the file
 * keeps what only it holds). Reads only.
 */
export async function resolveSchemaRow(
  row: SchemaType,
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<{ schema: SchemaFileFormat; filePath?: string }> {
  const fromData = (): SchemaFileFormat | undefined => {
    if (!row.schemaData) return undefined
    try {
      const data = JSON.parse(row.schemaData) as SchemaFileFormat
      return { ...data, models: normalizeSchemaModels(data.models) }
    } catch (error) {
      logger(`Could not parse schema_data of ${row.name}:`, error)
      return undefined
    }
  }

  const internal = isInternalSchema(row.name, row.schemaFileId ?? undefined)
  let schema = row.isDraft || internal ? fromData() : undefined
  let filePath: string | undefined
  if (!schema && row.schemaFileId && !internal) {
    filePath = getSchemaFilePath(row.schemaFileId, row.name, row.version)
    schema = await readSchemaFile(filePath)
    if (!schema) {
      // The file of that version may carry another name
      const info = (await listCompleteSchemaFiles()).find(
        (file) => file.schemaFileId === row.schemaFileId && file.version === row.version,
      )
      filePath = info?.filePath
      schema = filePath ? await readSchemaFile(filePath) : undefined
    }
    if (!schema) filePath = undefined
  }
  schema ??= fromData()
  schema ??= {
    $schema: SCHEMA_FILE_FORMAT,
    version: row.version,
    metadata: {
      name: row.name,
      createdAt: new Date(row.createdAt ?? Date.now()).toISOString(),
      updatedAt: new Date(row.updatedAt ?? Date.now()).toISOString(),
    },
    models: {},
    enums: {},
    migrations: [],
  }
  schema = {
    ...schema,
    ...(row.schemaFileId ? { id: row.schemaFileId } : {}),
    metadata: { ...schema.metadata, name: row.name },
  }

  if (row.id && db) {
    const { loadModelsFromDbForSchema, mergeDbModelsIntoSchemaModels } = await import('./db')
    const dbModels = await loadModelsFromDbForSchema(row.id, db)
    if (Object.keys(dbModels).length > 0) {
      schema.models = mergeDbModelsIntoSchemaModels(schema.models, dbModels)
    }
  }
  return { schema, filePath }
}

/**
 * Merges a schema built from instances into the previous version file, by id then name. The
 * instance's structure wins (type, ref, list element type, storage, required); everything else
 * the file holds stays (validation, htmlEmbeddedDataUriPolicy, descriptions, indexes, nameMatch,
 * enums). Models and properties the instance doesn't have are dropped.
 */
export function mergeSchemaFiles(previous: SchemaFileFormat, built: SchemaFileFormat): SchemaFileFormat {
  const STRUCTURE_KEYS = [
    'type', 'dataType', 'model', 'ref', 'refModelName', 'refValueType', 'items',
    'storage', 'storageType', 'localStorageDir', 'filenameSuffix', 'required',
  ]
  const byIdThenName = <T extends { id?: string }>(entries: Record<string, T>, id: string | undefined, name: string) =>
    (id ? Object.values(entries).find((entry) => propertyId(entry) === id) : undefined) ?? entries[name]

  const models: SchemaFileFormat['models'] = {}
  for (const [modelName, builtModel] of Object.entries(built.models ?? {})) {
    const previousModel = byIdThenName(previous.models ?? {}, builtModel.id, modelName)
    const properties: SchemaFileFormat['models'][string]['properties'] = {}
    for (const [propName, builtProp] of Object.entries(builtModel.properties ?? {})) {
      const previousProp = byIdThenName(previousModel?.properties ?? {}, propertyId(builtProp), propName) ?? {}
      const kept = Object.fromEntries(Object.entries(previousProp).filter(([key]) => !STRUCTURE_KEYS.includes(key)))
      properties[propName] = { ...kept, ...builtProp }
    }
    models[modelName] = { ...previousModel, ...builtModel, properties }
  }
  return { ...previous, ...built, metadata: { ...previous.metadata, ...built.metadata }, models }
}

export type SchemaVersionChange = {
  description: string
  changes: any[]
  /** Model renames this version makes (see {@link ApplySchemaFileOptions.modelRenames}). */
  modelRenames?: Map<string, string>
  /** Apply the new version to the rows. Default true. */
  apply?: boolean
}

/**
 * Writes the next version file of a schema (by file id, else by name): `patch` gets a copy of
 * the latest version file (the row's definition when it has none) and returns the next one's
 * content. The id, version, `metadata.updatedAt` and a `migrations` entry are set here. Then the
 * file is applied ({@link applySchemaFile}) unless `change.apply` is false.
 */
export async function writeNextSchemaVersion(
  schemaNameOrId: string,
  patch: (previous: SchemaFileFormat) => SchemaFileFormat | Promise<SchemaFileFormat>,
  change: SchemaVersionChange,
): Promise<{ schemaFile: SchemaFileFormat; filePath: string }> {
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')
  let [row] = await db.select().from(schemasTable).where(eq(schemasTable.schemaFileId, schemaNameOrId)).limit(1)
  row ??= (
    await db.select().from(schemasTable).where(eq(schemasTable.name, schemaNameOrId)).orderBy(desc(schemasTable.version)).limit(1)
  )[0]
  if (!row?.schemaFileId) {
    throw new Error(`Schema ${schemaNameOrId} not found in database or missing schemaFileId`)
  }

  const latest = await findLatestSchemaFile(row.schemaFileId)
  const previousFile = latest ? await readSchemaFile(latest.filePath) : undefined
  const previous = previousFile ?? (await resolveSchemaRow(row, db)).schema
  // A draft row with no file yet becomes its own version; otherwise the version after the newest
  const version = previousFile ? previousFile.version + 1 : row.isDraft ? row.version : row.version + 1

  const next = await patch(JSON.parse(JSON.stringify(previous)) as SchemaFileFormat)
  const now = new Date().toISOString()
  const schemaFile: SchemaFileFormat = {
    ...next,
    id: row.schemaFileId,
    version,
    metadata: { ...next.metadata, updatedAt: now },
    migrations: [
      ...(previous.migrations ?? []),
      { version, timestamp: now, description: change.description, changes: change.changes },
    ],
  }
  const filePath = await writeSchemaFile(schemaFile)
  logger(`Wrote schema ${schemaFile.metadata.name} v${version} at ${filePath}`)

  if (change.apply !== false) {
    await applySchemaFile(schemaFile, { store: false, modelRenames: change.modelRenames })
  }
  return { schemaFile, filePath }
}

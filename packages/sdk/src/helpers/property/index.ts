import { Static, Type } from '@sinclair/typebox'
import { PropertyDataType, StorageType } from '@/types'
import { TValidationRules, type ValidationError } from '@/Schema/validation'

/**
 * Enum for all property data types
 */
export enum ModelPropertyDataTypes {
  Text = 'Text',
  Number = 'Number',
  List = 'List',
  Relation = 'Relation',
  Image = 'Image',
  Json = 'Json',
  File = 'File',
  Boolean = 'Boolean',
  Date = 'Date',
  Html = 'Html',
}

/** Known data types in lowercase for normalization */
const DATA_TYPE_LOWER_MAP: Record<string, string> = {
  text: 'Text',
  string: 'Text', // JSON Schema convention
  number: 'Number',
  list: 'List',
  relation: 'Relation',
  image: 'Image',
  json: 'Json',
  file: 'File',
  boolean: 'Boolean',
  date: 'Date',
  html: 'Html',
}

/**
 * Normalize dataType to canonical PascalCase form.
 * Accepts lowercase (e.g. 'text') or mixed case and returns 'Text'.
 * Use when ingesting dataType from JSON schema files.
 */
export function normalizeDataType(value: string | undefined): string {
  if (!value || typeof value !== 'string') return value ?? ''
  const lower = value.toLowerCase().trim()
  return DATA_TYPE_LOWER_MAP[lower] ?? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

/** Whether `value` is one of {@link ModelPropertyDataTypes}, in any case. */
export function isKnownDataType(value: string | null | undefined): boolean {
  if (!value) return false
  return (Object.values(ModelPropertyDataTypes) as string[]).includes(normalizeDataType(value))
}

const STRING_RULES = ['pattern', 'minLength', 'maxLength'] as const

/**
 * Problems with a property's `validation` rules for its type, shared by the structure check and
 * schema-file loading. `pattern`, `minLength` and `maxLength` apply only to Text and Html (for a
 * List, its element type), so they are errors elsewhere (decision D19). `custom` is not supported
 * and is ignored, with a warning (decision D5).
 */
export function validationRuleProblems(
  dataType: string | undefined,
  refValueType: string | undefined,
  rules: Record<string, unknown> | undefined | null,
): ValidationError[] {
  if (!rules || typeof rules !== 'object') return []
  const problems: ValidationError[] = []
  const valueType = normalizeDataType(
    isDataType(dataType, ModelPropertyDataTypes.List) ? refValueType : dataType,
  )
  const isStringType = valueType === ModelPropertyDataTypes.Text || valueType === ModelPropertyDataTypes.Html
  if (!isStringType) {
    const set = STRING_RULES.filter((rule) => rules[rule] !== undefined && rules[rule] !== null)
    if (set.length > 0) {
      problems.push({
        field: 'validation',
        message: `validation.${set.join(', validation.')} only apply to Text and Html properties (this one is ${valueType || 'untyped'}). Remove ${set.length > 1 ? 'them' : 'it'} or use enum.`,
        code: 'rule_not_applicable',
        severity: 'error',
      })
    }
  }
  if (rules.custom) {
    problems.push({
      field: 'validation.custom',
      message: `Custom validators are not supported (validation.custom: "${String(rules.custom)}"); it is ignored. Use pattern, minLength, maxLength or enum.`,
      code: 'custom_validation_unsupported',
      severity: 'warning',
    })
  }
  return problems
}

/**
 * Case-insensitive dataType check. Use instead of `dataType === 'List'` so schemas
 * (or existing DB rows) with lowercase types like "list" still match.
 */
export function isDataType(
  value: string | null | undefined,
  expected: ModelPropertyDataTypes | `${ModelPropertyDataTypes}`,
): boolean {
  if (!value) return false
  return normalizeDataType(value) === expected
}

/**
 * Normalize a property definition to the internal shape ItemProperty reads (`dataType`,
 * `refValueType`, `ref`, `storageType`, ...). Accepts schema-file shape (`type`, `model`,
 * `items`, `storage`) and any casing. Mirrors the conversion in imports/json createModelFromJson
 * for the fallback paths that read schema-file properties directly.
 */
export function normalizePropertyRecordSchema<T>(def: T): T {
  if (!def || typeof def !== 'object') return def
  const src = def as Record<string, any>
  const out: Record<string, any> = { ...src }

  const rawType = src.dataType ?? src.type
  if (typeof rawType === 'string' && rawType) out.dataType = normalizeDataType(rawType)

  const ref = src.ref ?? src.refModelName ?? src.items?.model ?? src.model
  if (ref && !out.ref) out.ref = ref
  if (ref && !out.refModelName) out.refModelName = ref

  const rawRefValueType = src.refValueType ?? src.items?.type
  if (typeof rawRefValueType === 'string' && rawRefValueType) {
    out.refValueType = normalizeDataType(rawRefValueType)
  } else if (out.dataType === ModelPropertyDataTypes.List && ref) {
    out.refValueType = ModelPropertyDataTypes.Relation
  }

  if (src.storage && typeof src.storage === 'object' && !out.storageType) {
    out.storageType = src.storage.type === 'ItemStorage' ? 'ItemStorage' : 'PropertyStorage'
    if (src.storage.path !== undefined && out.localStorageDir === undefined) out.localStorageDir = src.storage.path
    if (src.storage.extension !== undefined && out.filenameSuffix === undefined) out.filenameSuffix = src.storage.extension
  }

  return out as T
}

// String literals, not enum members: PropertyDataType must accept plain strings
// such as `{ dataType: 'Text' }`. ModelPropertyDataTypes members still fit.
export const TPropertyDataType = Type.Union([
  Type.Literal('Text'),
  Type.Literal('Number'),
  Type.Literal('List'),
  Type.Literal('Relation'),
  Type.Literal('Image'),
  Type.Literal('Json'),
  Type.Literal('File'),
  Type.Literal('Boolean'),
  Type.Literal('Date'),
  Type.Literal('Html'),
])

export const TStorageType = Type.Union([
  Type.Literal('ItemStorage'), // Looks for a storageTransactionId property on the item
  Type.Literal('PropertyStorage'), // Looks for a storageTransactionId value on the property
])

/** How publish handles `data:image/*` URIs inside Html storage. Only applies when `dataType === 'Html'`. */
export const THtmlEmbeddedDataUriPolicy = Type.Union([
  Type.Literal('materialize'),
  Type.Literal('preserve'),
])
export type HtmlEmbeddedDataUriPolicy = Static<typeof THtmlEmbeddedDataUriPolicy>

export const TProperty = Type.Object({
  id: Type.Optional(Type.String()), // schemaFileId (string) - public ID
  _dbId: Type.Optional(Type.Number()), // Database integer ID - internal only
  name: Type.Optional(Type.String()),
  dataType: TPropertyDataType,
  ref: Type.Optional(Type.String()),
  // modelId: string (modelFileId) in code; number only for DB foreign keys when resolved
  modelId: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  modelName: Type.Optional(Type.String()),
  refModelId: Type.Optional(Type.Number()),
  refModelName: Type.Optional(Type.String()),
  refValueType: Type.Optional(TPropertyDataType),
  storageType: Type.Optional(TStorageType),
  localStorageDir: Type.Optional(Type.String()),
  filenameSuffix: Type.Optional(Type.String()),
  validation: Type.Optional(TValidationRules),
  required: Type.Optional(Type.Boolean()),
  /** When set on an Html property: `materialize` uploads embedded images as Image seeds and rewrites src; `preserve` leaves data URIs. */
  htmlEmbeddedDataUriPolicy: Type.Optional(THtmlEmbeddedDataUriPolicy),
})

export const TPropertyConstructor = Type.Function(
  [
    Type.Optional(Type.Union([Type.String(), TStorageType, Type.Undefined()])),
    Type.Optional(Type.Union([Type.String(), TPropertyDataType])),
    Type.Optional(Type.Union([Type.String(), Type.Boolean()])),
  ],
  TProperty,
)

export const TPropertyDefs = Type.Record(
  TPropertyDataType,
  TPropertyConstructor,
)

function htmlPropertyFactory(opts?: { htmlEmbeddedDataUriPolicy?: HtmlEmbeddedDataUriPolicy }) {
  return {
    dataType: ModelPropertyDataTypes.Html,
    ...(opts?.htmlEmbeddedDataUriPolicy
      ? { htmlEmbeddedDataUriPolicy: opts.htmlEmbeddedDataUriPolicy }
      : {}),
  } satisfies Static<typeof TProperty>
}

export const Property = {
  Text: (
    storageType?: StorageType,
    localStorageDir?: string,
    filenameSuffix?: string,
  ) => ({
    dataType: ModelPropertyDataTypes.Text,
    storageType,
    localStorageDir,
    filenameSuffix,
    TObject: Type.String(),
  }),
  Json: () => ({ dataType: ModelPropertyDataTypes.Json }),
  File: () => ({ dataType: ModelPropertyDataTypes.File }),
  Number: () => ({ dataType: ModelPropertyDataTypes.Number }),
  /**
   * Create a List property. refValueType is required; ref is required only for list of relations.
   * @param refValueType - Element type: 'Text', 'Number', 'Relation', etc.
   * @param ref - Model name when refValueType is 'Relation' (optional for primitives)
   * @example List('Text') - list of strings
   * @example List('Relation', 'Tag') - list of relations to Tag model
   */
  List: (refValueType: PropertyDataType, ref?: string) => ({
    dataType: ModelPropertyDataTypes.List,
    ref,
    refValueType,
  }),
  Relation: (ref?: string, refValueType?: PropertyDataType, required?: boolean) => ({
    dataType: ModelPropertyDataTypes.Relation,
    ref,
    refValueType,
    required,
  }),
  Image: () => ({ dataType: ModelPropertyDataTypes.Image }),
  Boolean: () => ({ dataType: ModelPropertyDataTypes.Boolean }),
  Date: () => ({ dataType: ModelPropertyDataTypes.Date }),
  Html: htmlPropertyFactory,
} satisfies Record<PropertyDataType, (...args: never[]) => Static<typeof TProperty>>

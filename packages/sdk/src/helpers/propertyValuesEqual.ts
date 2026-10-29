import { or, eq } from 'drizzle-orm'
import { resolveSeedIdsFromRefString } from '@seedprotocol/arweave'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'

type Db = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/** What the comparison needs from a property definition (or an op's copy of it). */
export type PropertyValueDefinition = {
  dataType?: string
  refValueType?: string
}

const SEED_REF_TYPES = new Set<string>([
  ModelPropertyDataTypes.Relation,
  ModelPropertyDataTypes.Image,
  ModelPropertyDataTypes.File,
  ModelPropertyDataTypes.Html,
  ModelPropertyDataTypes.Json,
])

const isEmpty = (value: string | null | undefined): boolean => value == null || value.trim() === ''

/** The local seed a ref (local id or uid) names, else the ref itself (lowercased when it's a uid). */
async function seedKey(ref: string, db: Db): Promise<string> {
  const trimmed = ref.trim()
  const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(trimmed)
  if (!seedLocalId && !seedUid) return trimmed
  const [row] = await db
    .select({ localId: seeds.localId })
    .from(seeds)
    .where(seedLocalId ? eq(seeds.localId, seedLocalId) : or(eq(seeds.uid, seedUid!), eq(seeds.uid, seedUid!.toLowerCase())))
    .limit(1)
  return row?.localId ?? seedLocalId ?? seedUid!.toLowerCase()
}

/**
 * Whether two stored values of a property (as in `metadata.property_value`) hold the same value.
 * Relations, and Image, File, Html and Json values, compare by the seed they name, so a local id
 * equals the uid of the same seed: a publish records relations as the seed uids it attested, while
 * a draft can hold local ids. Lists compare member by member in order, since the order is
 * attested. An empty value (null or blank) equals another empty value. Anything else compares as
 * stored. Reads through `db` (pass a transaction to read inside it).
 */
export async function propertyValuesEqual(
  definition: PropertyValueDefinition,
  a: string | null | undefined,
  b: string | null | undefined,
  db: Db | null = BaseDb.getAppDb(),
): Promise<boolean> {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b)
  if (a === b) return true

  const dataType = normalizeDataType(definition.dataType)
  if (dataType === ModelPropertyDataTypes.List) {
    const left = parseListPropertyValueFromStorage(a!)
    const right = parseListPropertyValueFromStorage(b!)
    if (left.length !== right.length) return false
    // Members that differ as stored can still name the same seed. An op's copy of the definition
    // doesn't say whether the list holds seeds, but a member that names no local seed compares as
    // stored, so this check is safe for a list of plain values too.
    for (let i = 0; i < left.length; i++) {
      if (left[i] === right[i]) continue
      if (!db || (await seedKey(left[i]!, db)) !== (await seedKey(right[i]!, db))) return false
    }
    return true
  }
  if (SEED_REF_TYPES.has(dataType) && db) {
    return (await seedKey(a!, db)) === (await seedKey(b!, db))
  }
  return false
}

import { ZERO_BYTES32 } from '@/helpers/constants'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import {
  isPublishedSeedRef,
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '@/helpers/relationSeedRef'
import type { IItem, IItemProperty } from '@/interfaces'
import { findRelatedSeedRow } from '@/db/read/resolveRelatedSeedRef'
import { isSeedRevoked } from '@/db/read/isSeedRevoked'

/**
 * The draft items a publish of an item carries along, and how it walks to them.
 *
 * A publish attests the item and every draft item (no seed uid yet) reachable from it through
 * relation and list-of-relation properties, each with its full property set. Already-published
 * targets are referenced by their current uid and not walked into; revoked ones stop the publish
 * (RelatedItemUnpublishedError). getPublishPayload, getPublishUploads, getPublishUploadData (publish
 * package), summarizePublishWork and the Html-embedded image co-publish all walk this graph in the
 * same order: depth first, properties in item order (relations, then lists), list members in order.
 *
 * Cycles: an item can only attest the uid of a seed published before it in the same publish, so a
 * ref back to an item still being walked (an ancestor that gets a new seed in this publish) can't be
 * attested. Such a property is deferred: left out of this publish (it keeps no uid, so the next
 * publish of its item attests it, with the target's uid). For A ↔ B reached from A, A attests B's
 * uid and B's relation to A is deferred.
 */

/** Relation properties that point at model items (not Image/File/Html/Json storage seeds). */
export function draftWalkProperties(segmented: {
  itemRelationProperties: IItemProperty<any>[]
  itemImageProperties: IItemProperty<any>[]
  itemListProperties: IItemProperty<any>[]
}): { relationProperties: IItemProperty<any>[]; listProperties: IItemProperty<any>[] } {
  const storage = new Set(segmented.itemImageProperties)
  return {
    relationProperties: segmented.itemRelationProperties.filter((p) => !storage.has(p)),
    listProperties: segmented.itemListProperties,
  }
}

const propertyContext = (prop: IItemProperty<any>): Record<string, unknown> | null => {
  const snapshot = prop.getService().getSnapshot()
  return snapshot && 'context' in snapshot
    ? ((snapshot as { context?: Record<string, unknown> }).context ?? null)
    : null
}

/** Seed refs held by a relation property (one) or a list property (each member). */
export function propertySeedRefs(prop: IItemProperty<any>, isList: boolean): string[] {
  const context = propertyContext(prop)
  if (!context) return []
  let value = context.propertyValue
  if (isList) {
    if (typeof value === 'string') value = parseListPropertyValueFromStorage(value)
    const arr = Array.isArray(value) ? value : value != null ? [value] : []
    return arr
      .map((v) =>
        v && typeof v === 'object'
          ? normalizeRelationPropertyValue(
              (v as { seedLocalId?: string; localId?: string }).seedLocalId ??
                (v as { localId?: string }).localId ??
                (v as { seedUid?: string }).seedUid ??
                (v as { uid?: string }).uid,
            )
          : normalizeRelationPropertyValue(v),
      )
      .filter((v): v is string => !!v)
  }
  const ref = normalizeRelationPropertyValue(value)
  return ref ? [ref] : []
}

const isZeroUid = (uid: string | undefined | null): boolean => !uid || uid === ZERO_BYTES32

/** The item gets a new seed attestation in this publish: a draft, or a revoked seed published again. */
export async function getsNewSeed(item: IItem<any>): Promise<boolean> {
  return isZeroUid(item.seedUid) || (await isSeedRevoked(item.seedLocalId))
}

/** Local seed id a ref points at (also for a republished seed's old uid), or undefined. */
export async function resolveRefSeedLocalId(ref: string): Promise<string | undefined> {
  const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(ref)
  if (!seedLocalId && !seedUid) return undefined
  const row = await findRelatedSeedRow({ seedLocalId, seedUid })
  return row?.seedLocalId ?? seedLocalId
}

export type PublishDraftGraphNode = {
  item: IItem<any>
  /** The relation or list property the walk first reached the item through. */
  via: IItemProperty<any>
  viaList: boolean
}

export type PublishDraftGraph = {
  /** Draft items reachable from the root (root excluded), in the order the walk finishes them. */
  drafts: PublishDraftGraphNode[]
  /** Properties pointing back at an item still being walked; left out of this publish. */
  deferredProperties: Set<IItemProperty<any>>
  /** For each deferred property, the seeds (local ids) of its back references. */
  backReferences: Map<IItemProperty<any>, Set<string>>
}

export type GetPublishDraftGraphOptions = {
  /** `new_version` / republish: properties that already have a uid are attested (and walked) again. */
  forceFullSnapshot?: boolean
  /**
   * Throw like getPublishUploads always did when a relation holds an invalid value or a local id
   * with no local item. Otherwise such refs are skipped (getPublishPayload reports them).
   */
  strict?: boolean
}

/** Would the publish attest this property (so walk its refs)? Same rule as getPublishPayload. */
function walksProperty(prop: IItemProperty<any>, forceFullSnapshot: boolean): boolean {
  if (prop.uid && !forceFullSnapshot) return false
  const ctx = propertyContext(prop)
  const value = ctx?.propertyValue
  return value != null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

async function loadItem(seedLocalId: string): Promise<IItem<any> | undefined> {
  const { getItem } = await import('./getItem')
  try {
    return (await getItem({ seedLocalId })) ?? undefined
  } catch {
    return undefined
  }
}

export async function getPublishDraftGraph(
  root: IItem<any>,
  options?: GetPublishDraftGraphOptions,
): Promise<PublishDraftGraph> {
  const forceFullSnapshot = options?.forceFullSnapshot === true
  const strict = options?.strict === true
  const drafts: PublishDraftGraphNode[] = []
  const deferredProperties = new Set<IItemProperty<any>>()
  const backReferences = new Map<IItemProperty<any>, Set<string>>()
  const visited = new Set<string>([root.seedLocalId])
  const inProgress = new Set<string>()
  if (await getsNewSeed(root)) inProgress.add(root.seedLocalId)

  /** Draft target of a ref, or undefined (published, revoked, unknown). */
  const draftTarget = async (
    prop: IItemProperty<any>,
    ref: string,
    isList: boolean,
  ): Promise<{ seedLocalId: string; item?: IItem<any> } | undefined> => {
    const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(ref)
    if (!seedLocalId && !seedUid) {
      if (strict && !isList) {
        throw new Error(`Invalid relation value for ${prop.propertyName}: expected local seed id or 0x uid`)
      }
      return undefined
    }
    const row = await findRelatedSeedRow({ seedLocalId, seedUid })
    const targetLocalId = row?.seedLocalId ?? seedLocalId
    if (!targetLocalId) return undefined
    // An item getting a new seed in this publish, still being walked (also the root when it is a
    // revoked seed published again): a back edge, whatever its current uid.
    if (inProgress.has(targetLocalId)) return { seedLocalId: targetLocalId }
    // Published (live or revoked): referenced by uid / reported, never walked into.
    if (row && !isZeroUid(row.seedUid)) return undefined
    if (visited.has(targetLocalId)) return { seedLocalId: targetLocalId }
    const item = await loadItem(targetLocalId)
    if (!item) {
      if (strict && !isList && !isPublishedSeedRef(ref)) {
        throw new Error(`No relatedItem found for ${prop.propertyName}`)
      }
      return undefined
    }
    if (!isZeroUid(item.seedUid)) return undefined
    return { seedLocalId: targetLocalId, item }
  }

  const visit = async (item: IItem<any>): Promise<void> => {
    const segmented = await getSegmentedItemProperties(item)
    const { relationProperties, listProperties } = draftWalkProperties(segmented)
    const walk = async (prop: IItemProperty<any>, isList: boolean) => {
      if (!walksProperty(prop, forceFullSnapshot)) return
      const targets: { seedLocalId: string; item?: IItem<any> }[] = []
      for (const ref of propertySeedRefs(prop, isList)) {
        const t = await draftTarget(prop, ref, isList)
        if (t) targets.push(t)
      }
      const back = targets.filter((t) => inProgress.has(t.seedLocalId)).map((t) => t.seedLocalId)
      if (back.length > 0) {
        deferredProperties.add(prop)
        backReferences.set(prop, new Set(back))
      }
      for (const t of targets) {
        if (!t.item || visited.has(t.seedLocalId)) continue
        visited.add(t.seedLocalId)
        inProgress.add(t.seedLocalId)
        await visit(t.item)
        inProgress.delete(t.seedLocalId)
        drafts.push({ item: t.item, via: prop, viaList: isList })
      }
    }
    for (const prop of relationProperties) await walk(prop, false)
    for (const prop of listProperties) await walk(prop, true)
  }

  await visit(root)
  return { drafts, deferredProperties, backReferences }
}

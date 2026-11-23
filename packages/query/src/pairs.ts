import {
  INCLUSION_SCHEMA_UID,
  STAFF_SCHEMA_UID,
  VERSION_SCHEMA_UID,
  decodeInclusionHalf,
  decodeStaffHalf,
  type PairHalfAttestation,
} from '@seedprotocol/eas'
import { initializeQueryPlatform } from './bootstrap.js'
import type { SeedDependencies } from './assembleSeeds.js'
import { getQueryCacheManager } from './cache/index.js'
import { checkedAtFor, checkWindowAged, findChangedItems, nowSeconds, type ItemChangeCheck } from './cache/changes.js'
import type { CachedPairData } from './cache/types.js'
import { getRemoteQueryDataSource } from './source/index.js'
import type { QueryDataSource } from './source/types.js'
import type { AttestationLike, VersionPin } from './types.js'

/**
 * A live Inclusion of a post in a publication (see {@link getInclusions}). `pin` is the post's
 * state the owner pinned, ready for `getSeeds(uids, { pins })`.
 */
export type Inclusion = {
  postUid: string
  /** The Version of the post the newest owner half names. */
  versionUid: string
  /** The newest owner half's `timeCreated` (unix seconds). */
  pinTime: number
  ownerHalfUid: string
  authorHalfUid: string
  pin: VersionPin
}

/** A publication a post is live in (see {@link inclusionsForPosts}). */
export type PostInclusion = {
  publicationUid: string
  versionUid: string
  pinTime: number
}

/** Options for the pair reads. They always read EAS (there is no local source for halves). */
export type PairReadOptions = {
  /**
   * Use the query cache when it is enabled. A cached answer is checked against EAS before it is
   * returned: a new or revoked half by or addressed to the seed's attester, or a change to a seed
   * or pinned post it depends on, reads it again. Default: follow the cache config.
   */
  cache?: boolean
}

/** A decoded half: `publication` is the owner side's seed, `other` the post or identity. */
type Half = PairHalfAttestation & {
  publication: string
  other: string
  /** Inclusion only: the pinned Version (zero on an author half). */
  version?: string
}

type PairKind = 'inclusion' | 'staff'

/** A live pair. */
type LivePair = {
  publicationUid: string
  otherUid: string
  owner: Half
  other: Half
}

const BYTES32 = /^0x[0-9a-f]{64}$/
const ZERO = '0x' + '0'.repeat(64)

const isRevoked = (half: PairHalfAttestation): boolean => half.revoked || half.revocationTime > 0

/** The newest half: latest `timeCreated`, then the greater uid. */
function newest(halves: Half[]): Half | undefined {
  let best: Half | undefined
  for (const half of halves) {
    if (!best || half.timeCreated > best.timeCreated || (half.timeCreated === best.timeCreated && half.id > best.id)) {
      best = half
    }
  }
  return best
}

const linked = (a: Half, b: Half): boolean => a.refUID === b.id || b.refUID === a.id

/**
 * The pair rules shared by Inclusion and Staff, before Inclusion's pinned-Version check. `halves`
 * are every half naming this publication and post (or identity), revoked ones included, by
 * anyone; only halves by `ownerAttester` (the publication seed's) and `otherAttester` (the post or
 * identity seed's) count. Seeds with the same attester form no pair.
 *
 * With O the newest owner half and X the newest half of the other side, the pair is live when
 * neither is revoked and they are linked. For Staff, X (the person half) must answer O. For
 * Inclusion, either may answer the other, and no owner half linked to X may be revoked.
 */
function evaluatePair(
  kind: PairKind,
  halves: Half[],
  ownerAttester: string,
  otherAttester: string,
): { owner: Half; other: Half } | null {
  if (ownerAttester === otherAttester) return null
  const ownerHalves = halves.filter((half) => half.attester === ownerAttester)
  const owner = newest(ownerHalves)
  const other = newest(halves.filter((half) => half.attester === otherAttester))
  if (!owner || !other || isRevoked(owner) || isRevoked(other)) return null
  if (kind === 'staff') return other.refUID === owner.id ? { owner, other } : null
  if (!linked(owner, other)) return null
  if (ownerHalves.some((half) => isRevoked(half) && linked(half, other))) return null
  return { owner, other }
}

function decodeHalf(kind: PairKind, half: PairHalfAttestation): Half | null {
  if (kind === 'inclusion') {
    const data = decodeInclusionHalf(half)
    return data ? { ...half, publication: data.publication, other: data.post, version: data.version } : null
  }
  const data = decodeStaffHalf(half)
  return data ? { ...half, publication: data.publication, other: data.identity } : null
}

/** Which side of the pair the requested seeds are on. */
type Side = 'publication' | 'other'

const SCHEMA: Record<PairKind, string> = { inclusion: INCLUSION_SCHEMA_UID, staff: STAFF_SCHEMA_UID }

/** Attester (lowercase) by seed uid, for the seeds EAS returns live. */
async function seedAttesters(source: QueryDataSource, uids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (uids.length === 0) return out
  for (const seed of await source.getSeedsByUids(uids)) {
    if (seed.attester && !seed.revoked) out.set(seed.id.toLowerCase(), seed.attester.toLowerCase())
  }
  return out
}

/**
 * Whether `versionUid` is a live Version of `postUid` by `postAttester` created by `at`. A pin to
 * anything else would name a state `getSeeds` can't show (ADR 0011).
 */
function pinnable(versions: AttestationLike[], versionUid: string, postUid: string, postAttester: string, at: number): boolean {
  return versions.some(
    (version) =>
      version.id.toLowerCase() === versionUid &&
      version.refUID.toLowerCase() === postUid &&
      version.schemaId.toLowerCase() === VERSION_SCHEMA_UID &&
      version.attester?.toLowerCase() === postAttester &&
      !version.revoked &&
      version.timeCreated <= at,
  )
}

/**
 * The live pairs of each of `uids` (lowercase, on `side`), and what each answer depends on. One
 * request for the seeds, one for the halves by or addressed to their attesters, one for the
 * counterpart seeds and, for Inclusion, one for the posts' Versions.
 */
async function readLivePairs(
  source: QueryDataSource,
  kind: PairKind,
  side: Side,
  uids: string[],
): Promise<Map<string, { pairs: LivePair[]; dependencies: SeedDependencies }>> {
  if (!source.listPairHalves) throw new Error('This query source cannot list pair halves.')
  const schemaId = SCHEMA[kind]
  const attesters = await seedAttesters(source, uids)
  const addresses = [...new Set(attesters.values())]
  const raw =
    addresses.length === 0
      ? []
      : await source.listPairHalves({ schemaUids: [schemaId], attesters: addresses, recipients: addresses })

  const requested = new Set(uids)
  const halves: Half[] = []
  for (const half of raw) {
    const decoded = decodeHalf(kind, half)
    if (!decoded) continue
    if (!requested.has(side === 'publication' ? decoded.publication : decoded.other)) continue
    halves.push(decoded)
  }

  const counterpartUids = [
    ...new Set(halves.map((half) => (side === 'publication' ? half.other : half.publication))),
  ].filter((uid) => !attesters.has(uid))
  for (const [uid, attester] of await seedAttesters(source, counterpartUids)) attesters.set(uid, attester)

  const byPair = new Map<string, Half[]>()
  for (const half of halves) {
    const key = `${half.publication}:${half.other}`
    const group = byPair.get(key)
    if (group) group.push(half)
    else byPair.set(key, [half])
  }

  const candidates: LivePair[] = []
  for (const group of byPair.values()) {
    const { publication, other } = group[0]!
    const ownerAttester = attesters.get(publication)
    const otherAttester = attesters.get(other)
    if (!ownerAttester || !otherAttester) continue
    const live = evaluatePair(kind, group, ownerAttester, otherAttester)
    if (live) candidates.push({ publicationUid: publication, otherUid: other, ...live })
  }

  let pairs = candidates
  if (kind === 'inclusion' && candidates.length > 0) {
    const postUids = [...new Set(candidates.map((pair) => pair.otherUid))]
    const versions = await source.getVersionsForSeeds(postUids)
    pairs = candidates.filter((pair) =>
      pinnable(versions, pair.owner.version ?? ZERO, pair.otherUid, attesters.get(pair.otherUid)!, pair.owner.timeCreated),
    )
  }

  const out = new Map<string, { pairs: LivePair[]; dependencies: SeedDependencies }>()
  for (const uid of uids) {
    const own = halves.filter((half) => (side === 'publication' ? half.publication : half.other) === uid)
    const counterparts = [...new Set(own.map((half) => (side === 'publication' ? half.other : half.publication)))]
    const posts = kind === 'inclusion' ? (side === 'publication' ? counterparts : [uid]) : []
    const attester = attesters.get(uid)
    out.set(uid, {
      pairs: pairs.filter((pair) => (side === 'publication' ? pair.publicationUid : pair.otherUid) === uid),
      dependencies: {
        // A new or revoked Version of a post decides its pin.
        refUIDs: posts,
        // The seed itself and every counterpart, created or revoked.
        ids: [uid, ...counterparts],
        // Every half on either side is by, or addressed to, this seed's attester.
        ...(attester && { halves: { schemaIds: [schemaId], addresses: [attester] } }),
      },
    })
  }
  return out
}

const answerKey = (kind: PairKind, side: Side, uid: string) => `${kind}:${side}:${uid}`

/**
 * Live pairs for each of `uids`, from the cache where an answer is unchanged, else from EAS. The
 * returned map is keyed by the uids as given; a uid that isn't a 32-byte hex uid gets no pairs.
 */
async function pairsFor(
  kind: PairKind,
  side: Side,
  uids: readonly string[],
  options: PairReadOptions | undefined,
): Promise<Map<string, LivePair[]>> {
  await initializeQueryPlatform({ source: 'remote' })
  const source = getRemoteQueryDataSource()
  const cache = getQueryCacheManager()
  const useCache = options?.cache !== false && cache.enabled

  const wanted = [...new Set(uids.map((uid) => uid.trim().toLowerCase()).filter((uid) => BYTES32.test(uid)))]
  const answers = new Map<string, LivePair[]>()

  if (useCache) {
    const checks = new Map<string, ItemChangeCheck>()
    const cachedByUid = new Map<string, CachedPairData<LivePair[]>>()
    for (const uid of wanted) {
      const cached = cache.getPairAnswer<LivePair[]>(answerKey(kind, side, uid))
      if (!cached) continue
      cachedByUid.set(uid, cached)
      checks.set(uid, cached)
    }
    if (checks.size > 0) {
      const startedAt = nowSeconds()
      const found = await findChangedItems(source, checks)
      for (const [uid, cached] of cachedByUid) {
        if (!found || found.changed.has(uid)) {
          cache.clearPairAnswer(answerKey(kind, side, uid))
          continue
        }
        if (checkWindowAged(cached, startedAt)) {
          cache.setPairAnswer(answerKey(kind, side, uid), {
            ...cached,
            checkedAt: checkedAtFor(startedAt),
            seenChangeKeys: found.seenChangeKeys.get(uid) ?? [],
          })
        }
        answers.set(uid, cached.answer)
      }
    }
  }

  const missing = wanted.filter((uid) => !answers.has(uid))
  if (missing.length > 0) {
    const startedAt = nowSeconds()
    const read = await readLivePairs(source, kind, side, missing)
    for (const [uid, { pairs, dependencies }] of read) {
      answers.set(uid, pairs)
      if (useCache) {
        cache.setPairAnswer(answerKey(kind, side, uid), {
          answer: pairs,
          dependencies,
          checkedAt: checkedAtFor(startedAt),
          seenChangeKeys: [],
          lastUpdated: startedAt,
        })
      }
    }
  }

  const out = new Map<string, LivePair[]>()
  for (const uid of uids) out.set(uid, answers.get(uid.trim().toLowerCase()) ?? [])
  return out
}

/** Newest owner half first, then the greater uid. */
const byPinTime = (a: LivePair, b: LivePair) =>
  b.owner.timeCreated - a.owner.timeCreated || (a.owner.id < b.owner.id ? 1 : -1)

/** When a Staff pair became live: its later half's `timeCreated`. Newest first. */
const byAgreed = (a: LivePair, b: LivePair) =>
  Math.max(b.owner.timeCreated, b.other.timeCreated) - Math.max(a.owner.timeCreated, a.other.timeCreated) ||
  (a.otherUid < b.otherUid ? 1 : -1)

/**
 * The posts live in each publication, newest pin first. An Inclusion of post S in publication P
 * is live when, with A the newest author half (by S's attester) and O the newest owner half (by
 * P's attester), revoked or not: neither is revoked; one's `refUID` is the other's uid; no owner
 * half linked to A is revoked; and O's `version` is a live Version of S by S's attester, created
 * by O's `timeCreated`. Halves by anyone else don't count. A post whose seed has the same attester
 * as the publication's forms no pair and isn't listed. Keyed by the uids as given.
 */
export async function getInclusions(
  publicationUids: readonly string[],
  options?: PairReadOptions,
): Promise<Map<string, Inclusion[]>> {
  const pairs = await pairsFor('inclusion', 'publication', publicationUids, options)
  return new Map(
    [...pairs].map(([uid, live]) => [
      uid,
      [...live].sort(byPinTime).map((pair) => ({
        postUid: pair.otherUid,
        versionUid: pair.owner.version!,
        pinTime: pair.owner.timeCreated,
        ownerHalfUid: pair.owner.id,
        authorHalfUid: pair.other.id,
        pin: { versionUid: pair.owner.version!, asOf: pair.owner.timeCreated },
      })),
    ]),
  )
}

/** The publications each post is live in, newest pin first, by the rules of {@link getInclusions}. */
export async function inclusionsForPosts(
  postUids: readonly string[],
  options?: PairReadOptions,
): Promise<Map<string, PostInclusion[]>> {
  const pairs = await pairsFor('inclusion', 'other', postUids, options)
  return new Map(
    [...pairs].map(([uid, live]) => [
      uid,
      [...live].sort(byPinTime).map((pair) => ({
        publicationUid: pair.publicationUid,
        versionUid: pair.owner.version!,
        pinTime: pair.owner.timeCreated,
      })),
    ]),
  )
}

/**
 * The identities on each publication's staff, newest agreement first. Staff for identity I in
 * publication P is live when the newest owner half (by P's attester) and the newest person half
 * (by I's attester), revoked or not, are both unrevoked and the person half's `refUID` is the
 * owner half. Halves by anyone else don't count; an identity whose seed has the same attester as
 * the publication's forms no pair. Keyed by the uids as given.
 */
export async function getStaff(
  publicationUids: readonly string[],
  options?: PairReadOptions,
): Promise<Map<string, string[]>> {
  const pairs = await pairsFor('staff', 'publication', publicationUids, options)
  return new Map([...pairs].map(([uid, live]) => [uid, [...live].sort(byAgreed).map((pair) => pair.otherUid)]))
}

/** The publications whose staff the identity is on, newest agreement first, by the rules of {@link getStaff}. */
export async function mastheadsForIdentity(identityUid: string, options?: PairReadOptions): Promise<string[]> {
  const pairs = await pairsFor('staff', 'other', [identityUid], options)
  return [...(pairs.get(identityUid) ?? [])].sort(byAgreed).map((pair) => pair.publicationUid)
}

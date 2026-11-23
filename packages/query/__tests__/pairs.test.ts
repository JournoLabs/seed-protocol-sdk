import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import {
  BaseEasClient,
  BaseQueryClient,
  INCLUSION_SCHEMA_UID,
  STAFF_SCHEMA_UID,
  VERSION_SCHEMA_UID,
} from '@seedprotocol/eas'
import {
  getInclusions,
  getStaff,
  inclusionsForPosts,
  mastheadsForIdentity,
  pendingFor,
  resetQueryCacheManager,
} from '../src/index'

/**
 * Pair reads against a fake EAS indexer: every request's `where` is evaluated over an in-memory
 * list of attestations, so the reads run through the real EAS request code.
 */
type Att = {
  id: string
  schemaId: string
  attester: string
  recipient: string
  refUID: string
  decodedDataJson: string
  timeCreated: number
  revoked: boolean
  revocationTime: number
}

const ZERO = '0x' + '0'.repeat(64)
const OWNER = '0x' + '1'.repeat(40) // attests publication P
const AUTHOR = '0x' + '2'.repeat(40) // attests post S
const PERSON = '0x' + '3'.repeat(40) // attests identity I
const STRANGER = '0x' + '4'.repeat(40)
const SEED_SCHEMA = '0x' + 'e'.repeat(64)

const NOW = Math.floor(Date.now() / 1000)
const T0 = NOW - 100_000

let attestations: Att[] = []
let requests: string[] = []
let next = 1

const newUid = () => '0x' + (next++).toString(16).padStart(64, '0')

function attest(fields: Partial<Att> & Pick<Att, 'attester' | 'schemaId' | 'timeCreated'>): string {
  const id = newUid()
  attestations.push({ id, recipient: ZERO.slice(0, 42), refUID: ZERO, decodedDataJson: '[]', revoked: false, revocationTime: 0, ...fields })
  return id
}

function revoke(uid: string, at: number) {
  const a = attestations.find((x) => x.id === uid)!
  a.revoked = true
  a.revocationTime = at
}

const data = (fields: Record<string, string>) =>
  JSON.stringify(
    Object.entries(fields).map(([name, value]) => ({
      name,
      type: 'bytes32',
      signature: `bytes32 ${name}`,
      value: { name, type: 'bytes32', value },
    })),
  )

const seed = (attester: string, t = T0) => attest({ attester, schemaId: SEED_SCHEMA, timeCreated: t })
const version = (seedUid: string, attester: string, t: number) =>
  attest({ attester, schemaId: VERSION_SCHEMA_UID, refUID: seedUid, timeCreated: t })

/** An Inclusion half. Author halves name no Version. */
const inclusionHalf = (o: { by: string; to: string; p: string; s: string; version?: string; ref?: string; t: number }) =>
  attest({
    attester: o.by,
    recipient: o.to,
    schemaId: INCLUSION_SCHEMA_UID,
    refUID: o.ref ?? ZERO,
    decodedDataJson: data({ publication: o.p, post: o.s, version: o.version ?? ZERO }),
    timeCreated: o.t,
  })

const staffHalf = (o: { by: string; to: string; p: string; i: string; ref?: string; t: number }) =>
  attest({
    attester: o.by,
    recipient: o.to,
    schemaId: STAFF_SCHEMA_UID,
    refUID: o.ref ?? ZERO,
    decodedDataJson: data({ publication: o.p, identity: o.i }),
    timeCreated: o.t,
  })

const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v)

function matches(a: Record<string, unknown>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Record<string, any>[]).every((c) => matches(a, c))
    if (key === 'OR') return (cond as Record<string, any>[]).some((c) => matches(a, c))
    const value = lower(a[key])
    if ('equals' in cond) return value === lower(cond.equals)
    if ('in' in cond) return (cond.in as unknown[]).map(lower).includes(value)
    if ('notIn' in cond) return !(cond.notIn as unknown[]).map(lower).includes(value)
    if ('gt' in cond) return (value as number) > cond.gt
    throw new Error(`unsupported where ${key}`)
  })
}

const RESULT_KEY: Record<string, string> = {
  GetSeedsLean: 'itemSeeds',
  GetVersions: 'itemVersions',
  GetPairHalves: 'halves',
  GetAttestationChanges: 'changes',
}

beforeEach(() => {
  attestations = []
  requests = []
  next = 1
  BaseQueryClient.configure({
    getQueryClient: () => ({
      fetchQuery: ({ queryFn }: { queryFn: () => unknown }) => queryFn(),
      getQueryData: () => undefined,
      removeQueries: async () => {},
    }),
  } as never)
  BaseEasClient.configure({
    getEasClient: () =>
      ({
        request: async (doc: any, vars: { where: Record<string, any> }) => {
          const name = doc.definitions[0].name.value as string
          requests.push(name)
          if (name === 'GetSchemas') return { schemas: [] }
          const key = RESULT_KEY[name]
          if (!key) throw new Error(`unexpected request ${name}`)
          return {
            [key]: attestations
              .filter((a) => matches(a, vars.where))
              .sort((a, b) => b.timeCreated - a.timeCreated),
          }
        },
      }) as never,
  })
  process.env.CACHE_ENABLED = 'false'
  resetQueryCacheManager()
})

afterEach(() => {
  delete process.env.CACHE_ENABLED
  delete process.env.CACHE_TTL
  resetQueryCacheManager()
})

/** A publication P by OWNER and a post S by AUTHOR with Versions V1 (T0+100) and V2 (T0+200). */
function publicationAndPost() {
  const P = seed(OWNER)
  const S = seed(AUTHOR)
  const V1 = version(S, AUTHOR, T0 + 100)
  const V2 = version(S, AUTHOR, T0 + 200)
  return { P, S, V1, V2 }
}

const live = async (P: string) => (await getInclusions([P])).get(P)!

describe('getInclusions', () => {
  it('lists a post once the owner accepts its offer, pinned to the owner half', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    expect(await live(P)).toEqual([])

    const O = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    expect(await live(P)).toEqual([
      {
        postUid: S,
        versionUid: V1,
        pinTime: T0 + 400,
        ownerHalfUid: O,
        authorHalfUid: A,
        pin: { versionUid: V1, asOf: T0 + 400 },
      },
    ])
    expect((await inclusionsForPosts([S])).get(S)).toEqual([{ publicationUid: P, versionUid: V1, pinTime: T0 + 400 }])
  })

  it('lists a post once the author agrees to the owner’s ask', async () => {
    const { P, S, V2 } = publicationAndPost()
    const O = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V2, t: T0 + 300 })
    expect(await live(P)).toEqual([])

    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, ref: O, t: T0 + 400 })
    expect((await live(P)).map((row) => [row.postUid, row.versionUid, row.authorHalfUid])).toEqual([[S, V2, A]])
  })

  it('pins the newer Version when the owner accepts it', async () => {
    const { P, S, V1, V2 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    const O2 = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V2, ref: A, t: T0 + 500 })

    expect(await live(P)).toEqual([
      expect.objectContaining({ versionUid: V2, ownerHalfUid: O2, pin: { versionUid: V2, asOf: T0 + 500 } }),
    ])
  })

  it('stays out after a Remove until both sides attest again', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A1 = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    const O1 = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A1, t: T0 + 400 })
    revoke(O1, T0 + 500)
    expect(await live(P)).toEqual([])

    const A2 = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 600 })
    expect(await live(P)).toEqual([])

    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A2, t: T0 + 700 })
    expect((await live(P)).map((row) => row.authorHalfUid)).toEqual([A2])
  })

  it('stays out when the author withdraws', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    revoke(A, T0 + 500)
    expect(await live(P)).toEqual([])
  })

  it("can't be revived through an older owner half", async () => {
    const { P, S, V1, V2 } = publicationAndPost()
    const O0 = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, t: T0 + 300 })
    const A1 = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, ref: O0, t: T0 + 400 })
    const O1 = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V2, ref: A1, t: T0 + 500 })
    revoke(O1, T0 + 600)

    // The author answers the owner's first ask again; the owner's newest half is still revoked.
    inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, ref: O0, t: T0 + 700 })
    expect(await live(P)).toEqual([])
  })

  it('ends when the owner revokes a superseded half linked to the author half', async () => {
    const { P, S, V1, V2 } = publicationAndPost()
    const O0 = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, t: T0 + 300 })
    const A1 = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, ref: O0, t: T0 + 400 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V2, ref: A1, t: T0 + 500 })
    expect(await live(P)).toHaveLength(1)

    revoke(O0, T0 + 600)
    expect(await live(P)).toEqual([])
  })

  it('skips a post whose seed has the publication’s attester', async () => {
    const P = seed(OWNER)
    const S = seed(OWNER)
    const V = version(S, OWNER, T0 + 100)
    const A = inclusionHalf({ by: OWNER, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: OWNER, p: P, s: S, version: V, ref: A, t: T0 + 400 })
    expect(await live(P)).toEqual([])
    expect((await inclusionsForPosts([S])).get(S)).toEqual([])
  })

  it('ignores halves by anyone else, even with a refUID to a real half', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    // A stranger "accepts" the offer for the owner.
    inclusionHalf({ by: STRANGER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    expect(await live(P)).toEqual([])

    // Once the owner accepts, a stranger's newer half doesn't displace either side.
    const O = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 500 })
    inclusionHalf({ by: STRANGER, to: OWNER, p: P, s: S, ref: O, t: T0 + 600 })
    expect((await live(P)).map((row) => row.ownerHalfUid)).toEqual([O])
  })

  it('leaves out a pin to a revoked, foreign or later Version', async () => {
    const { P, S } = publicationAndPost()
    const revokedV = version(S, AUTHOR, T0 + 150)
    revoke(revokedV, T0 + 160)
    const foreignV = version(S, STRANGER, T0 + 150)
    const laterV = version(S, AUTHOR, T0 + 900)

    for (const [i, pinned] of [revokedV, foreignV, laterV].entries()) {
      const p = seed(OWNER)
      const A = inclusionHalf({ by: AUTHOR, to: OWNER, p, s: S, t: T0 + 300 + i })
      inclusionHalf({ by: OWNER, to: AUTHOR, p, s: S, version: pinned, ref: A, t: T0 + 400 + i })
      expect(await live(p)).toEqual([])
    }
    expect(await live(P)).toEqual([])
  })

  it('lists nothing for a revoked publication or post', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    revoke(S, T0 + 500)
    expect(await live(P)).toEqual([])
  })

  it('keys the result by the uids as given', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    const upper = '0x' + P.slice(2).toUpperCase()
    const result = await getInclusions([upper, 'not-a-uid'])
    expect(result.get(upper)).toHaveLength(1)
    expect(result.get('not-a-uid')).toEqual([])
  })
})

describe('getStaff', () => {
  function publicationAndIdentity() {
    return { P: seed(OWNER), I: seed(PERSON) }
  }

  it('lists an identity once the person agrees to the owner’s ask', async () => {
    const { P, I } = publicationAndIdentity()
    const O = staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 300 })
    expect((await getStaff([P])).get(P)).toEqual([])

    staffHalf({ by: PERSON, to: OWNER, p: P, i: I, ref: O, t: T0 + 400 })
    expect((await getStaff([P])).get(P)).toEqual([I])
    expect(await mastheadsForIdentity(I)).toEqual([P])
  })

  it('needs the person half to answer the newest owner half', async () => {
    const { P, I } = publicationAndIdentity()
    // A person half with no ask behind it.
    staffHalf({ by: PERSON, to: OWNER, p: P, i: I, t: T0 + 300 })
    expect((await getStaff([P])).get(P)).toEqual([])

    const O1 = staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 400 })
    staffHalf({ by: PERSON, to: OWNER, p: P, i: I, ref: O1, t: T0 + 500 })
    expect((await getStaff([P])).get(P)).toEqual([I])

    // A new ask supersedes the one the person answered.
    staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 600 })
    expect((await getStaff([P])).get(P)).toEqual([])
  })

  it('drops an identity when either side revokes', async () => {
    const { P, I } = publicationAndIdentity()
    const O = staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 300 })
    const X = staffHalf({ by: PERSON, to: OWNER, p: P, i: I, ref: O, t: T0 + 400 })
    revoke(X, T0 + 500)
    expect((await getStaff([P])).get(P)).toEqual([])
    expect(await mastheadsForIdentity(I)).toEqual([])
  })

  it('ignores a stranger agreeing for the person, and same-attester pairs', async () => {
    const { P, I } = publicationAndIdentity()
    const O = staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 300 })
    staffHalf({ by: STRANGER, to: OWNER, p: P, i: I, ref: O, t: T0 + 400 })
    expect((await getStaff([P])).get(P)).toEqual([])

    const own = seed(OWNER)
    const O2 = staffHalf({ by: OWNER, to: OWNER, p: P, i: own, t: T0 + 500 })
    staffHalf({ by: OWNER, to: OWNER, p: P, i: own, ref: O2, t: T0 + 600 })
    expect((await getStaff([P])).get(P)).toEqual([])
  })
})

describe('pair read cache', () => {
  beforeEach(() => {
    process.env.CACHE_ENABLED = 'true'
    process.env.CACHE_TTL = '3600'
    resetQueryCacheManager()
  })

  const halfReads = () => requests.filter((name) => name === 'GetPairHalves').length

  it('reuses an unchanged answer after checking EAS for changes', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    expect(await live(P)).toHaveLength(1)
    expect(halfReads()).toBe(1)

    requests = []
    expect(await live(P)).toHaveLength(1)
    expect(requests).toEqual(['GetAttestationChanges', 'GetAttestationChanges', 'GetAttestationChanges'])
  })

  it('sees a new offer and its acceptance, though neither references anything cached', async () => {
    const { P, S, V1 } = publicationAndPost()
    expect(await live(P)).toEqual([])
    expect(await inclusionsForPosts([S])).toEqual(new Map([[S, []]]))

    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: NOW })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: NOW })
    expect(await live(P)).toHaveLength(1)
    expect((await inclusionsForPosts([S])).get(S)).toHaveLength(1)
  })

  it('sees a revoked half on either side', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    expect(await live(P)).toHaveLength(1)
    expect((await inclusionsForPosts([S])).get(S)).toHaveLength(1)

    revoke(A, NOW)
    expect(await live(P)).toEqual([])
    expect((await inclusionsForPosts([S])).get(S)).toEqual([])

    const { P: P2, S: S2, V1: V } = publicationAndPost()
    const A2 = inclusionHalf({ by: AUTHOR, to: OWNER, p: P2, s: S2, t: T0 + 300 })
    const O2 = inclusionHalf({ by: OWNER, to: AUTHOR, p: P2, s: S2, version: V, ref: A2, t: T0 + 400 })
    expect(await live(P2)).toHaveLength(1)
    revoke(O2, NOW)
    expect(await live(P2)).toEqual([])
  })

  it('sees the pinned Version revoked', async () => {
    const { P, S, V1 } = publicationAndPost()
    const A = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: A, t: T0 + 400 })
    expect(await live(P)).toHaveLength(1)

    revoke(V1, NOW)
    expect(await live(P)).toEqual([])
  })

  it('sees a person agreeing to a cached ask', async () => {
    const P = seed(OWNER)
    const I = seed(PERSON)
    const O = staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 300 })
    expect((await getStaff([P])).get(P)).toEqual([])
    expect(await mastheadsForIdentity(I)).toEqual([])

    staffHalf({ by: PERSON, to: OWNER, p: P, i: I, ref: O, t: NOW })
    expect((await getStaff([P])).get(P)).toEqual([I])
    expect(await mastheadsForIdentity(I)).toEqual([P])
  })
})

describe('pendingFor', () => {
  const uids = (rows: { uid: string }[]) => rows.map((row) => row.uid)

  it('lists offers to a publication, and asks waiting on an attester', async () => {
    const { P, S, V1 } = publicationAndPost()
    const I = seed(PERSON)
    const offer = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    const ask = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, t: T0 + 400 })
    const staffAsk = staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 500 })

    expect(await pendingFor({ publicationUids: [P] })).toEqual([
      {
        kind: 'inclusion',
        half: 'author',
        uid: offer,
        schemaUid: INCLUSION_SCHEMA_UID,
        attester: AUTHOR,
        recipient: OWNER,
        timeCreated: T0 + 300,
        publicationUid: P,
        postUid: S,
      },
    ])
    expect(await pendingFor({ attester: AUTHOR })).toEqual([
      {
        kind: 'inclusion',
        half: 'owner',
        uid: ask,
        schemaUid: INCLUSION_SCHEMA_UID,
        attester: OWNER,
        recipient: AUTHOR,
        timeCreated: T0 + 400,
        publicationUid: P,
        postUid: S,
        versionUid: V1,
      },
    ])
    expect(await pendingFor({ attester: PERSON.toUpperCase().replace('0X', '0x') })).toEqual([
      {
        kind: 'staff',
        half: 'owner',
        uid: staffAsk,
        schemaUid: STAFF_SCHEMA_UID,
        attester: OWNER,
        recipient: PERSON,
        timeCreated: T0 + 500,
        publicationUid: P,
        identityUid: I,
      },
    ])
  })

  it('drops a half once the other side answers it, and doesn’t bring it back after a Remove', async () => {
    const { P, S, V1 } = publicationAndPost()
    const offer = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    const accept = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: offer, t: T0 + 400 })
    expect(await pendingFor({ publicationUids: [P] })).toEqual([])
    // The owner's answer references the offer, so it isn't waiting on the author either.
    expect(await pendingFor({ attester: AUTHOR })).toEqual([])

    revoke(accept, T0 + 500)
    expect(await pendingFor({ publicationUids: [P] })).toEqual([])

    const again = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 600 })
    expect(uids(await pendingFor({ publicationUids: [P] }))).toEqual([again])
  })

  it('drops a Staff ask once the person agrees, even after they leave', async () => {
    const P = seed(OWNER)
    const I = seed(PERSON)
    const ask = staffHalf({ by: OWNER, to: PERSON, p: P, i: I, t: T0 + 300 })
    expect(uids(await pendingFor({ attester: PERSON }))).toEqual([ask])

    const agree = staffHalf({ by: PERSON, to: OWNER, p: P, i: I, ref: ask, t: T0 + 400 })
    revoke(agree, T0 + 500)
    expect(await pendingFor({ attester: PERSON })).toEqual([])
  })

  it('ignores answers by anyone but the other side’s attester', async () => {
    const { P, S } = publicationAndPost()
    const offer = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    inclusionHalf({ by: STRANGER, to: AUTHOR, p: P, s: S, ref: offer, t: T0 + 400 })
    expect(uids(await pendingFor({ publicationUids: [P] }))).toEqual([offer])
  })

  it('leaves out withdrawn halves, halves not by their seed’s attester, and answers with no ask', async () => {
    const { P, S } = publicationAndPost()
    const I = seed(PERSON)
    const withdrawn = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    revoke(withdrawn, T0 + 400)
    // A stranger offering someone else's post.
    inclusionHalf({ by: STRANGER, to: OWNER, p: P, s: S, t: T0 + 500 })
    // A person half that answers nothing is not a request.
    staffHalf({ by: PERSON, to: OWNER, p: P, i: I, t: T0 + 600 })
    expect(await pendingFor({ publicationUids: [P] })).toEqual([])
    expect(await pendingFor({ attester: OWNER })).toEqual([])
  })

  it('leaves out same-attester pairs and halves naming a revoked seed', async () => {
    const P = seed(OWNER)
    const own = seed(OWNER)
    inclusionHalf({ by: OWNER, to: OWNER, p: P, s: own, t: T0 + 300 })
    const S = seed(AUTHOR)
    inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 400 })
    revoke(S, T0 + 500)
    expect(await pendingFor({ publicationUids: [P] })).toEqual([])
  })

  it('narrows to the publications given', async () => {
    const { P, S, V1 } = publicationAndPost()
    const P2 = seed(OWNER)
    const toP = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
    const toP2 = inclusionHalf({ by: AUTHOR, to: OWNER, p: P2, s: S, t: T0 + 400 })
    expect(uids(await pendingFor({ publicationUids: [P] }))).toEqual([toP])
    expect(uids(await pendingFor({ attester: OWNER }))).toEqual([toP2, toP])

    // With both: asks from P waiting on AUTHOR, not from elsewhere.
    const fromP = inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, t: T0 + 500 })
    inclusionHalf({ by: OWNER, to: AUTHOR, p: P2, s: S, version: V1, t: T0 + 600 })
    expect(uids(await pendingFor({ attester: AUTHOR, publicationUids: [P] }))).toEqual([fromP])
  })

  it('needs an attester or publications', async () => {
    await expect(pendingFor({})).rejects.toThrow(TypeError)
    expect(await pendingFor({ attester: 'nope' })).toEqual([])
    expect(await pendingFor({ publicationUids: ['nope'] })).toEqual([])
    expect(requests).toEqual([])
  })

  describe('with the cache', () => {
    beforeEach(() => {
      process.env.CACHE_ENABLED = 'true'
      process.env.CACHE_TTL = '3600'
      resetQueryCacheManager()
    })

    it('reuses an unchanged answer, and sees a new offer and its answer', async () => {
      const { P, S, V1 } = publicationAndPost()
      expect(await pendingFor({ publicationUids: [P] })).toEqual([])

      requests = []
      expect(await pendingFor({ publicationUids: [P] })).toEqual([])
      expect(requests.length).toBeGreaterThan(0)
      expect(requests.every((name) => name === 'GetAttestationChanges')).toBe(true)

      const offer = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: NOW })
      expect(uids(await pendingFor({ publicationUids: [P] }))).toEqual([offer])

      inclusionHalf({ by: OWNER, to: AUTHOR, p: P, s: S, version: V1, ref: offer, t: NOW })
      expect(await pendingFor({ publicationUids: [P] })).toEqual([])
    })

    it('sees a pending half withdrawn and its post revoked', async () => {
      const { P, S } = publicationAndPost()
      const offer = inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S, t: T0 + 300 })
      expect(uids(await pendingFor({ attester: OWNER }))).toEqual([offer])
      revoke(offer, NOW)
      expect(await pendingFor({ attester: OWNER })).toEqual([])

      const S2 = seed(AUTHOR)
      inclusionHalf({ by: AUTHOR, to: OWNER, p: P, s: S2, t: NOW })
      expect(await pendingFor({ attester: OWNER })).toHaveLength(1)
      revoke(S2, NOW)
      expect(await pendingFor({ attester: OWNER })).toEqual([])
    })
  })
})

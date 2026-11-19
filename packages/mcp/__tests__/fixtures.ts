import type { AttestationLike, QueryDataSource } from '@seedprotocol/query'

export const PUBLISHER = '0xabcdef0123456789abcdef0123456789abcdef01'
export const OTHER = '0x' + '9'.repeat(40)

const uid = (tag: string) => '0x' + tag.repeat(64 / tag.length)

export const POST = uid('a1')
export const POST_V1 = uid('b1')
export const POST_V2 = uid('b2')
export const BODY = uid('c1')
export const BODY_V = uid('c2')
export const OLDER_POST = uid('a2')
export const OLDER_POST_V = uid('b3')
export const SPAM_POST = uid('a3')
export const SPAM_POST_V = uid('b4')

export const TRANSACTION_ID = 'BodyTx'.padEnd(43, 'x')
export const BODY_HTML = '<h2>What happened</h2><p>The council <strong>voted</strong> on the budget.</p>'

export const POSTED_AT = 1_763_000_000
const ZERO = '0x' + '0'.repeat(64)

const seed = (id: string, model: string, timeCreated: number, attester = PUBLISHER): AttestationLike => ({
  id,
  refUID: ZERO,
  schemaId: `0xseed-${model}`,
  timeCreated,
  decodedDataJson: '',
  attester,
  schema: { schemaNames: [{ name: model }] },
})

const version = (id: string, seedUid: string, timeCreated: number, attester = PUBLISHER): AttestationLike => ({
  id,
  refUID: seedUid,
  schemaId: '0xversion',
  timeCreated,
  decodedDataJson: '',
  attester,
})

let n = 0
const property = (
  versionUid: string,
  type: string,
  name: string,
  value: unknown,
  timeCreated: number,
  attester = PUBLISHER,
): AttestationLike => ({
  id: '0xee' + (++n).toString(16).padStart(62, '0'),
  refUID: versionUid,
  schemaId: `0xschema-${type}-${name}`,
  timeCreated,
  decodedDataJson: JSON.stringify([{ name, type, value: { name, type, value } }]),
  attester,
})

/**
 * Two posts by PUBLISHER (the newer one has two versions and an Html body stored on Arweave) and
 * one by OTHER under the same schema.
 */
export function chain() {
  n = 0
  const seeds = [
    seed(POST, 'post', POSTED_AT),
    seed(OLDER_POST, 'post', POSTED_AT - 86_400),
    seed(SPAM_POST, 'post', POSTED_AT + 60, OTHER),
    seed(BODY, 'html', POSTED_AT),
  ]
  const versions = [
    version(POST_V1, POST, POSTED_AT + 1),
    version(POST_V2, POST, POSTED_AT + 3600),
    version(OLDER_POST_V, OLDER_POST, POSTED_AT - 86_399),
    version(SPAM_POST_V, SPAM_POST, POSTED_AT + 61, OTHER),
    version(BODY_V, BODY, POSTED_AT + 2),
  ]
  const properties = [
    property(POST_V1, 'string', 'title', 'Council meets', POSTED_AT + 2),
    property(POST_V2, 'string', 'title', 'Council passes budget', POSTED_AT + 3601),
    property(POST_V2, 'string', 'summary', 'The vote was 5 to 2.', POSTED_AT + 3602),
    property(POST_V2, 'bytes32', 'html', BODY, POSTED_AT + 3603),
    property(BODY_V, 'string', 'storage_transaction_id', TRANSACTION_ID, POSTED_AT + 3),
    property(OLDER_POST_V, 'string', 'title', 'Library hours change', POSTED_AT - 86_398),
    property(SPAM_POST_V, 'string', 'title', 'Buy now', POSTED_AT + 62, OTHER),
  ]
  return { seeds, versions, properties }
}

/** An in-memory local query source holding `chain()`; Arweave bodies come from `bodies`. */
export function localSource(data = chain(), bodies: Record<string, string> = { [TRANSACTION_ID]: BODY_HTML }): QueryDataSource {
  const seedByUid = (id: string) => data.seeds.find((s) => s.id.toLowerCase() === id.toLowerCase()) ?? null
  return {
    kind: 'local',
    getSeedByUid: async (id) => seedByUid(id),
    getSeedsByUids: async (ids) => ids.map(seedByUid).filter((s): s is AttestationLike => s !== null),
    listSeedsBySchemaName: async (schemaName, { limit, skip, attesters }) =>
      data.seeds
        .filter((s) => s.schema?.schemaNames?.[0]?.name.toLowerCase() === schemaName.toLowerCase())
        .filter((s) => !attesters || attesters.includes((s.attester ?? '').toLowerCase()))
        .sort((a, b) => b.timeCreated - a.timeCreated)
        .slice(skip, skip + limit),
    listSeedsBySchemaNameForMonth: async () => [],
    getVersionsForSeed: async (id) => data.versions.filter((v) => v.refUID === id),
    getVersionsForSeeds: async (ids) => data.versions.filter((v) => ids.includes(v.refUID)),
    getPropertiesForVersionUids: async (ids) => data.properties.filter((p) => ids.includes(p.refUID)),
    readStorageBody: async ({ value }) => {
      if (typeof value !== 'string') return null
      const tx = Object.keys(bodies).find((id) => value.includes(id))
      return tx ? bodies[tx]! : null
    },
  }
}

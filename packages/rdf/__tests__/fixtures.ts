import type { AttestationLike, QueryDataSource } from '@seedprotocol/query'

export const CHAIN_ID = 11155420
export const ATTESTER = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const OTHER = '0x' + '9'.repeat(40)

const uid = (tag: string) => '0x' + tag.repeat(64 / tag.length)

export const POST = uid('a1')
export const POST_V1 = uid('b1')
export const POST_V2 = uid('b2')
export const HTML = uid('c1')
export const HTML_V = uid('c2')
export const AUTHOR_1 = uid('d1')
export const AUTHOR_2 = uid('d2')

export const TITLE = 'Council "votes"\non budget, \\ok/ — §'
export const TRANSACTION_ID = 'Tx-123_abcDEF'
export const PUBLISHED_AT = 1760968991

const seed = (id: string, model: string, timeCreated: number): AttestationLike => ({
  id,
  refUID: '0x' + '0'.repeat(64),
  schemaId: `0xseed-${model}`,
  timeCreated,
  decodedDataJson: '',
  attester: ATTESTER,
  schema: { schemaNames: [{ name: model }] },
})

const version = (id: string, seedUid: string, timeCreated: number): AttestationLike => ({
  id,
  refUID: seedUid,
  schemaId: '0xversion',
  timeCreated,
  decodedDataJson: '',
  attester: ATTESTER,
})

let n = 0
const property = (
  versionUid: string,
  type: string,
  name: string,
  value: unknown,
  timeCreated: number,
  attester = ATTESTER,
): AttestationLike => ({
  id: '0xee' + (++n).toString(16).padStart(62, '0'),
  refUID: versionUid,
  schemaId: `0xschema-${type}-${name}`,
  timeCreated,
  decodedDataJson: JSON.stringify([{ name, type, value: { name, type, value } }]),
  attester,
})

/** A Post with a title, an Html body, two authors and a few scalar values, and its Html seed. */
export function chain() {
  n = 0
  const seeds = [seed(POST, 'post', PUBLISHED_AT), seed(HTML, 'html', PUBLISHED_AT)]
  const versions = [version(POST_V1, POST, 100), version(POST_V2, POST, 200), version(HTML_V, HTML, 150)]
  const properties = [
    property(POST_V1, 'string', 'title', 'From the old version', 101),
    property(POST_V2, 'string', 'title', 'Replaced in a patch', 201),
    property(POST_V2, 'string', 'title', TITLE, 210),
    // Anyone can attest against a Version; only the seed's attester counts.
    property(POST_V2, 'string', 'title', 'Not the attester', 220, OTHER),
    // Removed (ADR 0021)
    property(POST_V2, 'string', 'summary', '', 202),
    property(POST_V2, 'bytes32', 'html', HTML, 203),
    property(POST_V2, 'bytes32[]', 'author_identity_ids', [AUTHOR_1, AUTHOR_2], 204),
    property(POST_V2, 'bool', 'featured', true, 205),
    // A Number (ADR 0010): an EAS string
    property(POST_V2, 'string', 'word_count', '1e+21', 206),
    property(POST_V2, 'uint256', 'published_at', { type: 'BigNumber', hex: '0x' + PUBLISHED_AT.toString(16) }, 207),
    property(HTML_V, 'string', 'storage_transaction_id', TRANSACTION_ID, 151),
  ]
  return { seeds, versions, properties }
}

/** An in-memory local source holding `chain()`. */
export function localSource(data = chain()): QueryDataSource {
  return {
    kind: 'local',
    getSeedByUid: async (id) => data.seeds.find((s) => s.id === id) ?? null,
    getSeedsByUids: async (ids) => data.seeds.filter((s) => ids.includes(s.id)),
    listSeedsBySchemaName: async () => [],
    listSeedsBySchemaNameForMonth: async () => [],
    getVersionsForSeed: async (id) => data.versions.filter((v) => v.refUID === id),
    getVersionsForSeeds: async (ids) => data.versions.filter((v) => ids.includes(v.refUID)),
    getPropertiesForVersionUids: async (ids) => data.properties.filter((p) => ids.includes(p.refUID)),
  }
}

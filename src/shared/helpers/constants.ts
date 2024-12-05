export const SCHEMA_NJK = 'schema.njk'
export const SCHEMA_TS = 'schema.ts'

export const INTERNAL_DATA_TYPES = {
  Text: {
    eas: 'string',
  },
  Number: {
    eas: 'uint8',
  },
  ImageSrc: {
    eas: 'string',
  },
  Relation: {
    eas: 'bytes32',
  },
  List: {
    eas: 'bytes32[]',
  },
}

export const internalPropertyNames = [
  'localId',
  'uid',
  'seedLocalId',
  'seedUid',
  'schemaUid',
  'attestationCreatedAt',
  'createdAt',
  'updatedAt',
  'versionsCount',
  'lastVersionPublishedAt',
  'versionLocalId',
  'lastLocalUpdateAt',
  'storageTransactionId',
  'versionUid',
  'refSeedType',
  'refValueType',
  'resolvedValue',
  'resolvedDisplayValue',
]

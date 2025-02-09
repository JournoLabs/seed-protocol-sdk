import {
  AttestationRequestData,
  ZERO_BYTES,
  ZERO_BYTES32,
  ZERO_ADDRESS,
} from '@ethereum-attestation-service/eas-sdk'


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
  FileSrc: {
    eas: 'string',
  },
  Json: {
    eas: 'string',
  },
  Blob: {
    eas: 'bytes32',
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
  'latestVersionLocalId',
  'versionLocalId',
  'lastLocalUpdateAt',
  'storageTransactionId',
  'versionUid',
  'refSeedType',
  'refValueType',
  'refResolvedValue',
  'refResolvedDisplayValue',
  'type',
]

export const VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA =
  '0x13c0fd59d69dbce40501a41f8b37768d26dd2e2bb0cad64615334d84f7b9bdf6'

export const defaultAttestationData: AttestationRequestData = {
  recipient: ZERO_ADDRESS,
  revocable: true,
  value: BigInt(0),
  refUID: ZERO_BYTES32,
  expirationTime: BigInt(0),
  data: ZERO_BYTES,
}

export enum ImageSize {
  EXTRA_SMALL = 480,
  SMALL = 760,
  MEDIUM = 1024,
  LARGE = 1440,
  EXTRA_LARGE = 1920,
}

export const CLIENT_NOT_INITIALIZED = 'ClientManager is not initialized. Please call init() first.'

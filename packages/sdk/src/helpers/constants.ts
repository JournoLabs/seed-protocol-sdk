import {
  AttestationRequestData,
} from '@ethereum-attestation-service/eas-sdk'
import { ZeroAddress } from 'ethers'

// Define zero constants ourselves since they're not exported from eas-sdk in newer versions
export const ZERO_ADDRESS = ZeroAddress
export const ZERO_BYTES = '0x'
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'


export const SCHEMA_NJK = 'schema.njk'
// Primary config file name for Seed Protocol SDK
export const SEED_CONFIG_FILE = 'seed.config.ts'
// Fallback config file names (in order of preference)
export const SEED_CONFIG_FALLBACKS = ['seed.schema.ts', 'schema.ts']
// Legacy constant for backward compatibility
export const SCHEMA_TS = SEED_CONFIG_FILE

export const INTERNAL_DATA_TYPES = {
  Text: {
    eas: 'string',
  },
  Number: {
    eas: 'uint8',
  },
  Image: {
    eas: 'bytes32',
  },
  Relation: {
    eas: 'bytes32',
  },
  List: {
    eas: 'bytes32[]',
  },
  File: {
    eas: 'bytes32',
  },
  Json: {
    eas: 'bytes32',
  },
  Blob: {
    eas: 'bytes32',
  },
  Boolean: {
    eas: 'bool',
  },
  Date: {
    eas: 'uint256',
  },
  Html: {
    eas: 'bytes32',
  },
}

/** Full property names ending in `Id` that must not be stripped to a “base” name for `allProperties` keys. */
export const PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP = new Set<string>(['storageTransactionId'])

export const INTERNAL_PROPERTY_NAMES = [
  'localId',
  'uid',
  'seedLocalId',
  'seedUid',
  'schemaUid',
  'attestationCreatedAt',
  'attestationRaw',
  'createdAt',
  'updatedAt',
  'lastVersionPublishedAt',
  'latestVersionLocalId',
  'latestVersionUid',
  'lastLocalUpdateAt',
  'modelName',
  'refSeedType',
  'refValueType',
  'refResolvedValue',
  'refResolvedDisplayValue',
  'type',
  // Image
  'src',
  'alt',
  //
  'versionLocalId',
  'versionsCount',
  'versionUid',
  '_markedForDeletion',
  // SDK-internal: wallet address of attester; never publish as property attestation
  'publisher',
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

export const INIT_SCRIPT_SUCCESS_MESSAGE = '[Seed Protocol] Finished running init script'

export enum SeedModels {
  Seed = 'Seed',
  Metadata = 'Metadata',
  Version = 'Version',
}

// Internal SDK schema that should not be created in app's files directory
export const SEED_PROTOCOL_SCHEMA_NAME = 'Seed Protocol'
export const INTERNAL_SCHEMA_IDS = ['SEEDPROTOCOL'] as const

/** Default Arweave gateway host used across all packages */
export const DEFAULT_ARWEAVE_HOST = 'arweave.net'

/** Default Arweave gateway GraphQL endpoint (transaction / block queries). */
export const DEFAULT_ARWEAVE_GRAPHQL_URL = 'https://arweave.net/graphql'

/** Default Arweave gateways for fallback / metadata fetching (ordered by preference) */
export const DEFAULT_ARWEAVE_GATEWAYS = ['arweave.net', 'ar-io.net'] as const

/**
 * Check if a schema is an internal SDK schema that should not be created in app files
 */
export function isInternalSchema(schemaName: string, schemaId?: string): boolean {
  return schemaName === SEED_PROTOCOL_SCHEMA_NAME || 
         (schemaId !== undefined && INTERNAL_SCHEMA_IDS.includes(schemaId as any))
}

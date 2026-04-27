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

/** Default Arweave gateway host used across all packages (first in {@link DEFAULT_ARWEAVE_GATEWAYS}) */
export const DEFAULT_ARWEAVE_HOST = 'ar.seedprotocol.io'

/** Default Arweave gateway GraphQL endpoint (transaction / block queries). */
export const DEFAULT_ARWEAVE_GRAPHQL_URL = `https://${DEFAULT_ARWEAVE_HOST}/graphql`

/**
 * Default Arweave gateways for read fallback / metadata fetching (ordered by preference).
 * Override order with `ARWEAVE_READ_GATEWAYS` or `NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS` (comma-separated hosts).
 */
export const DEFAULT_ARWEAVE_GATEWAYS = ['ar.seedprotocol.io', 'arweave.net', 'arweave.dev', 'g8way.io', 'permagate.io', 'zigza.xyz',] as const

const READ_GATEWAYS_ENV_KEYS = ['ARWEAVE_READ_GATEWAYS', 'NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS'] as const

/** Ordered gateway hostnames for reads: env list if set, otherwise {@link DEFAULT_ARWEAVE_GATEWAYS}. */
export function getDefaultArweaveReadGatewayHostsOrdered(): string[] {
  if (typeof process === 'undefined' || !process.env) {
    return [...DEFAULT_ARWEAVE_GATEWAYS]
  }
  for (const key of READ_GATEWAYS_ENV_KEYS) {
    const raw = process.env[key]?.trim()
    if (raw) {
      return raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return [...DEFAULT_ARWEAVE_GATEWAYS]
}

/**
 * Deduped host list: primary first, then each default not already present (case-insensitive).
 */
export function mergePrimaryHostWithDefaults(primary: string, defaults: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const keyOf = (h: string) => h.trim().toLowerCase().replace(/\/$/, '')
  const add = (h: string) => {
    const t = h.trim().replace(/\/$/, '')
    if (!t) return
    const k = keyOf(t)
    if (seen.has(k)) return
    seen.add(k)
    out.push(t)
  }
  add(primary)
  for (const d of defaults) add(d)
  return out
}

/**
 * True if `hostname` looks like a public Arweave gateway used in stored URLs (hydration / RSS).
 */
export function isKnownArweaveGatewayHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  if (!h) return false
  if (h.endsWith('arweave.net')) return true
  if (h.endsWith('ar-io.net')) return true
  for (const g of DEFAULT_ARWEAVE_GATEWAYS) {
    const gl = g.toLowerCase()
    if (h === gl || h.endsWith(`.${gl}`)) return true
  }
  return false
}

/** Fired after `syncDbWithEas` persists EAS seeds/versions/metadata to SQLite (see `Item.rehydrateCachedItemsFromDbAfterEasSync`). */
export const EAS_SEED_DATA_SYNCED_TO_DB_EVENT = 'easSeedDataSyncedToDb' as const

/**
 * Check if a schema is an internal SDK schema that should not be created in app files
 */
export function isInternalSchema(schemaName: string, schemaId?: string): boolean {
  return schemaName === SEED_PROTOCOL_SCHEMA_NAME || 
         (schemaId !== undefined && INTERNAL_SCHEMA_IDS.includes(schemaId as any))
}

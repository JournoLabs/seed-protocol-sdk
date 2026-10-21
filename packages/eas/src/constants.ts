export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ZERO_BYTES = '0x'
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

/**
 * @deprecated Evaluated once at import and ignores SDK / publish chain config. Use `getEasEndpoint()`.
 */
export const EAS_ENDPOINT =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_EAS_ENDPOINT) ||
  (typeof process !== 'undefined' && process.env?.EAS_ENDPOINT) ||
  'https://optimism-sepolia.easscan.org/graphql'

/** Schema definition of the Version attestation (zero resolver, revocable). */
export const VERSION_SCHEMA_DEF = 'bytes32 version'

/**
 * UID of {@link VERSION_SCHEMA_DEF}. Schema UIDs hash the definition, resolver and revocable flag,
 * so this is the same on every chain; the schema must still be registered on each one.
 */
export const VERSION_SCHEMA_UID =
  '0x13c0fd59d69dbce40501a41f8b37768d26dd2e2bb0cad64615334d84f7b9bdf6'

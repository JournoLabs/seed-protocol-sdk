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

/**
 * Schema of a bag anchor (ADR 0029): refUID is the Version, attested by the Version's attester.
 * Revocable, zero resolver, like {@link VERSION_SCHEMA_DEF}.
 */
export const ARCHIVE_ANCHOR_SCHEMA_DEF =
  'uint64 covered_until,bytes32 manifest_tx,bytes32 tagmanifest_sha256'

/** UID of {@link ARCHIVE_ANCHOR_SCHEMA_DEF}, the same on every chain. */
export const ARCHIVE_ANCHOR_SCHEMA_UID =
  '0xf7f6e2f226f29542fa8bd1763d042d04f47a0a9c3647753f68cc113e26f1739e'

/** Schema #1 display name for {@link ARCHIVE_ANCHOR_SCHEMA_DEF}. */
export const ARCHIVE_ANCHOR_SCHEMA_NAME = 'seedprotocol.archiveAnchor'

/**
 * Schema of a user's encryption key registration (ADR 0033): the account attests its key id, the
 * key format, its three public keys, the binding key's signature that the key belongs to this
 * account on this chain, and the Arweave transaction of its keystore manifest. No refUID.
 * Revocable, zero resolver, like {@link VERSION_SCHEMA_DEF}.
 */
export const ENCRYPTION_KEY_SCHEMA_DEF =
  'bytes32 key_id,string suite,bytes recipient_key,bytes tag_key,bytes binding_key,bytes binding_signature,bytes32 keystore_tx'

/** UID of {@link ENCRYPTION_KEY_SCHEMA_DEF}, the same on every chain. */
export const ENCRYPTION_KEY_SCHEMA_UID =
  '0x45d5d330ae470f98abdd75dce77f388017d6765d49a0b6cbaf3de113433670e6'

/** Schema #1 display name for {@link ENCRYPTION_KEY_SCHEMA_DEF}. */
export const ENCRYPTION_KEY_SCHEMA_NAME = 'seedprotocol.encryptionKey'

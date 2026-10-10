## Unreleased

### Changed

- **Faster Version and property reads:** the `attestationFields` fragment (used by `GET_VERSIONS`, `GET_PROPERTIES`, `GET_ALL_PROPERTIES_FOR_ALL_VERSIONS`, `GET_FILES_METADATA`, `GET_IMAGE_VERSIONS`) no longer selects `schema { schemaNames }`. easscan resolves that join slowly (properties for ~170 versions: ~1.8 s with it, ~0.26 s without). Version and property attestations from these queries no longer carry `schema`; read `schemaId` instead.
- **`getSeedsBySchemaName`** fetches seeds without the schema join and sets `schema.schemaNames` to the requested name.

### Added

- **`GET_SEEDS_LEAN`**: `GET_SEEDS` without `schema { schemaNames }`.
- **`getSeedsByUidsFromEas({ uids, excludeRevoked })`**: seeds by UID, with `schema.schemaNames` attached from `schemaId`.
- **`getAttestationChangesSince({ refUIDs, ids, since })`** and **`GET_ATTESTATION_CHANGES`**: attestations created or revoked after `since` that reference one of `refUIDs` or are one of `ids` (one request per 400 UIDs). Used by `@seedprotocol/query` to check cached seeds for changes.
- **`getSchemaNamesBySchemaUids(schemaUids)`**: schema names by schema UID, cached per EAS endpoint for the process (`resetSchemaNamesCache` for tests).

- **Publish authorization helpers:** `PUBLISH_AUTHORIZATION_*`, `decodePublishAuthorizationData`, `assessPublishAuthorization`, and `getPublishAuthorizationFromEas` for the `seedprotocol.publishAuthorization` sidecar.
- **Domain ownership helpers:** `DOMAIN_OWNERSHIP_SCHEMA_*`, challenge/TXT builders, `hashDomainOwnershipChallenge`, `hashDomainRegistryFingerprint`, `decodeDomainOwnershipData`, `assessDomainOwnership`, and `getDomainOwnershipFromEas` for the `seedprotocol.domainOwnership` sidecar.

## 0.5.0

Initial release: EAS GraphQL read client, schema UID cache, and Node platform registration.

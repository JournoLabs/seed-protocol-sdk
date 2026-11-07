# 0035. Any wallet registers schemas; readers identify them by UID

- **Status:** Accepted
- **Date:** 2026-11-07
- **Scope:** `@seedprotocol/publish` schema registration (`ensure*Schema`, `ensureEasSchemasForModels`); `@seedprotocol/eas` and `@seedprotocol/query` reads

## Context

An EAS schema is registered with one call to the chain's `SchemaRegistry`:
`register(schema, resolver, revocable)`. Its UID is
`keccak256(abi.encodePacked(schema, resolver, revocable))`. The registering wallet isn't part of
the UID and gets no control over the schema; the chain isn't part of it either (see
`ENCRYPTION_KEY_SCHEMA_UID` and the other `*_SCHEMA_UID` constants in `@seedprotocol/eas`). A
second `register` call with the same three values reverts, so the first registration is the only
one, and everyone attests under it.

A schema's name is an attestation under EAS's naming schema
(`0x44d562ac1d7cd77e232978687fea027ace48f719cf1d58c7888e509663bb87fc`, `bytes32 schemaId,string
name`). Any wallet can name any schema, a schema can have several names, and several schemas can
share a name. On OP Sepolia two schemas are named `image`: Seed's `bytes32 image` and an unrelated
`string image` named by another wallet.

The Seed schemas already registered on OP Sepolia came from four wallets. `seedprotocol.publishAuthorization`
was registered by one wallet and named by another. Error messages told callers to use "the owner
wallet", which read as one privileged registrar; they meant any wallet but an automation session
key, which may call only the executor module.

## Decision

- Any wallet may register and name any Seed schema, fixed (`seedprotocol.*`, `version`) or a
  model's property schema. No wallet is the registrar, on testnets or mainnet. The only wallets
  that can't are automation session keys, because they can't call `SchemaRegistry`.
- Code identifies a schema by its UID, or by its definition, resolver and revocable flag, which
  give the UID. A name is a display label. Code doesn't trust a name alone to pick a schema,
  because anyone can attach the same name to a different schema.
- `ensure*Schema` functions name a schema in the same call that registers it. They don't add a
  second name to a schema someone else registered.

## Consequences

- Registering a schema needs no key held for the purpose: whoever first needs it pays the gas.
  Mainnet launch doesn't wait on a particular wallet.
- Explorers may show a Seed schema under a name some other wallet attested, or several names.
  That doesn't affect which attestations belong to it.
- Reads that filter attestations by schema name can return attestations under an unrelated schema
  that shares the name. Those reads should filter by schema UID, or by attester where the UID
  isn't known in advance. Moving the remaining name-based reads is follow-up work.

## Alternatives considered

- **One project wallet registers and names every schema.** It adds a key to guard and a step
  before each new chain or schema, and it doesn't stop anyone from attaching the same name to
  another schema, so readers would still have to check UIDs.
- **Trust names attested by a known wallet.** Readers would need a hard-coded attester list per
  chain, and the UID check gives the same answer without one.

# 0010. Number properties are published as decimal strings

- **Status:** Accepted
- **Date:** 2026-10-16
- **Scope:** `@seedprotocol/sdk` (data type constants, publish payload, EAS sync, local query
  source), `@seedprotocol/eas` (value decoding), `@seedprotocol/query` (seed assembly, changelog),
  `@seedprotocol/publish` (schema registration)

## Context

`INTERNAL_DATA_TYPES.Number.eas` is `'uint8'` (`sdk/src/helpers/constants.ts`). Every Number
property is registered as `uint8 <easName>` (`publish/.../ensureEasSchemas.ts`, and the draft
schema UID lookups in `createMetadata` and `updateMetadata`), and every value is ABI-encoded as a
uint8.

**What publishes today.** A Node test on `main` created items with a Number `wordCount` and called
`getPublishPayload`. Values are stored in `metadata.property_value` as text and read back as
strings, so the encoder always receives a string:

| assigned | stored and read back | `getPublishPayload` |
|---|---|---|
| `255`, `0` | `'255'`, `'0'` | attests |
| `256` | `'256'` | `PublishValidationFailedError`: `value out-of-bounds` |
| `-1` | `'-1'` | `value out-of-bounds` |
| `1.5` | `'1.5'` | `Cannot convert 1.5 to a BigInt` |
| `9007199254740993` | `'9007199254740992'` | `value out-of-bounds` (precision was already lost in JS) |
| `1e21` | `'1e+21'` | `Cannot convert 1e+21 to a BigInt` |
| `'256'` (a string) | not stored | `Item.create` rejects it: `Expected number` |

Every failure is at encode, in `getPublishPayload`: `SchemaEncoder.encodeData` throws, and the
error is reported as `publish_validation` with `Failed to encode property wordCount: ...`. Nothing
reaches the chain. Schema registration doesn't check values. Locally, `Type.Number()` accepts any
JS number, so a value the SDK saved without complaint can't be published.

The same encoder run on other types: `uint256` takes 0 to 2^256−1 but no negatives or
fractions, `int256` adds negatives, and `string` takes every value above. Both integer types also
reject a JS number of 2^53 or more (ethers throws `overflow` for unsafe integers), so large values
must go in as strings or BigInts.

**What comes back from EAS.** The OP Sepolia indexer returns `uint8` values in
`decodedDataJson` as a JSON number or a numeric string (`1`, `"4"`), and `uint256` values as
`{ "type": "BigNumber", "hex": "0x02" }`. Sync stores any non-string value with
`JSON.stringify` (`syncDbWithEas.ts`, near line 953), and query's `assembleSeeds` and `changelog`
do the same. Nothing decodes `BigNumber` hex. A `uint256` Number would sync as the text
`{"type":"BigNumber","hex":"0x0100"}`. Date is already `uint256`, so synced Date values are
probably stored this way today (from the code and the indexer response; not run end to end).

**Types aren't checked on read.** ADR 0008 says property types must agree, but
`resolveSyncedPropertyName` matches by name only, so `uint8 word_count` and `string word_count`
attestations both land on a local `wordCount`.

**What's on chain.** On OP Sepolia, the SDK's chain, the only single-field `uint8` schema with a
Seed-style name is `uint8 star_count`, with 0 attestations. PermaPress, the only consumer, has no
Number properties. Changing the encoding strands no data we know of.

**Other places the type matters.** `easTypeForDataType` and the `validEasTypes` allowlist in
`ensureEasSchemas.ts` (no `int*` types), the `"<type> <name>"` lookups in
`getSchemaForItemProperty`, `schemaUidCache` and `fetchEasSchemaUidBySchemaName`, and the local
query source, which reports `easDataType` or `'string'`. The cost estimate charges a flat 55,000
gas per attestation whatever its type (`gasHeuristics.ts`).

## Decision

### 1. Number publishes as `string <easName>`

`INTERNAL_DATA_TYPES.Number.eas` becomes `'string'`. A Number property `wordCount` registers and
attests under `string word_count`.

Before encoding, publish turns the value into the decimal string `decodeEasNumber` (section 2)
returns for it: integer strings stay exact, other finite numbers and numeric strings become
`String(Number(value))` (`'256'`, `'-1'`, `'1.5'`, `'1e+21'`). So publish writes the form readers
decode to. A value that isn't a
finite number (`'abc'`, `NaN`, `Infinity`, `''`) fails publish validation with the code
`publish_invalid_number`, naming the property. `0` and `false` are values and are attested;
`getPublishPayload` skips only a missing or empty value.

The local value, its storage as text and its validation don't change. Reading values back as
numbers is a separate item (batch 1).

### 2. Reading accepts every numeric encoding

`decodeEasNumber(value)` in `@seedprotocol/eas` (`easValues.ts`) returns the value's decimal
string, or `undefined` if it isn't numeric. It accepts a finite JSON number, a decimal or `0x`
string, a bigint, and `{ type: 'BigNumber', hex }` (or `{ _hex }`). `isNumericEasType` says
whether an EAS type is `uint*` or `int*`.

Sync uses it for every property whose local type is Number. So `uint8 word_count` attestations
already on chain, and `uint256` or `int256` ones from other SDKs, sync into `wordCount` as
`'42'`. A Date from a numeric field is decoded the same way, then turned from Unix seconds into an
ISO string, which fixes the `BigNumber` text above for Date. Any other integer value that isn't a
string is stored as its decimal string instead of JSON.

Query's `assembleSeeds` and `changelog` don't know local types, so they decode any non-string
value from a `uint*` or `int*` field to its decimal string. A Date comes back from them as Unix
seconds. The local query source needs no change: it returns what sync stored.

### 3. Sync checks types, as ADR 0008 requires

`resolveSyncedPropertyName` takes the attestation's EAS type and accepts a match only if it fits
the local property's type:

| local type | accepted EAS types |
|---|---|
| Number | `string` (if `decodeEasNumber` returns a value), `uint8`–`uint256`, `int8`–`int256` |
| Date | `uint256` |
| Text | `string` |
| Boolean | `bool` |
| Relation, Image, File, Html, Json, Blob | `bytes32` |
| List of relations | `bytes32[]` |

An attestation whose type doesn't fit is skipped with a warning. Like a refused `nameMatch` match,
it isn't stored under a name of its own. A `string word_count` attestation with the value
`'many'`, from an app whose `wordCount` is Text, is skipped for a Number `wordCount` and accepted
for a Text one.

### 4. Old and new attestations on one version

A version that has both a `uint8 word_count` and a `string word_count` attestation has two
canonical property attestations (`easPropertyCanonical` picks one per schema UID), and both
are stored as `wordCount` rows. Which one the item reads is the existing rule for two rows of one
property on one version, which this ADR doesn't change. A version gets both only if one publisher
attests the same version twice, across SDK versions.

An item published with `uint8` keeps that attestation until the property changes. Its next
publish attests the changed value under `string word_count`. Unchanged properties aren't
republished.

## Consequences

- Every finite JS number publishes, including negatives, fractions and values above 255. Values
  at or above 2^53 still lose precision when they're assigned, because the local type is a JS
  number; on chain they're stored exactly as saved.
- Number and Text properties with the same name share one EAS schema (`string word_count`). The
  name rule in ADR 0008 is unchanged. Type agreement on read (section 3) keeps a Text value from
  landing in a Number property, by parsing the value rather than reading the EAS type.
- Contracts and resolvers can't compare Number values on chain without parsing a string. No Seed
  contract or resolver does.
- A string costs more to store than a `uint256`: its ABI encoding is 96 bytes instead of 32, and
  EAS keeps attestation data in contract storage. By slot arithmetic that's about two more 32-byte
  slots per Number attestation, roughly 40,000 gas, not measured. The cost estimate's flat
  per-attestation figure doesn't change.
- `nameMatch` is unaffected: names don't change, and type agreement applies at every level.
- **Breaking:** Number properties register a new EAS schema, `string <name>`, so published
  Number values from this version on are under a different schema UID than earlier ones. Readers
  on older SDK versions treat `string word_count` as a plain value and store it as text, which is
  what they do with `uint8` values today, so they keep working.
- **Breaking:** sync drops attestations whose EAS type doesn't fit the local property. Before,
  they were stored whatever their type.

### Migration and changelog notes

No data migration. Sync only inserts attestations it hasn't stored, so rows synced before the
change stay as they are, including a Date stored as `BigNumber` text. Removing such a row lets the
next sync store it decoded.

`## Unreleased` notes, to add with the implementation:

- `@seedprotocol/sdk`: "**Breaking:** Number properties are published as `string <name>` instead
  of `uint8 <name>`, so values above 255, negatives and decimals publish. A non-numeric value fails
  publish validation with `publish_invalid_number`. Sync still reads `uint8`, other integer and
  string attestations into Number properties. Items published before keep their `uint8`
  attestations until the property changes." And: "**Breaking:** sync skips a property attestation
  whose EAS type doesn't fit the local property's type (ADR 0008, ADR 0010). Synced Date values
  are decoded from Unix seconds instead of being stored as `BigNumber` JSON."
- `@seedprotocol/eas`: "`decodeEasNumber` turns an indexer value (number, numeric string, bigint
  or `BigNumber` hex) into a decimal string."
- `@seedprotocol/query`: "Values from `uint*`/`int*` attestations come back as decimal strings
  instead of the indexer's `BigNumber` JSON."
- `@seedprotocol/publish`: "Number properties register `string <name>` EAS schemas instead of
  `uint8 <name>` (through `@seedprotocol/sdk`'s data types)."

## Alternatives considered

- **`uint256`.** Fixes values above 255, with the same 32-byte cost as today. Negatives and
  decimals still fail at publish, after the SDK has saved them locally. Avoiding that needs
  save-time integer and sign checks, which makes Number something other than a JS number.
- **`int256`.** Adds negatives. Decimals still fail, so it has the same problem. A fixed-point
  scale (the `precision` field in `protocol/schema.json`, which nothing reads) would make the
  on-chain value mean different things to apps with different scales, since the scale lives in a
  local schema file and not on chain.
- **A per-property choice in the schema file** (`"eas": { "type": "int256" }`). It lets a
  developer pick an on-chain numeric type when a contract needs one. It adds a second dimension to
  ADR 0008's one-schema-per-property rule: two apps choosing differently split one property's
  seeds over several schema UIDs. Nobody needs on-chain numeric comparisons now. If someone does,
  a later ADR can add it as an opt-in. `decodeEasNumber` already reads every numeric type, so
  reading wouldn't change.
- **Keep `uint8` and validate the range locally.** Honest, but Number would mean "0 to 255",
  which no developer expects.

/**
 * Modular executor module events (0x043462…).
 * CreatedAttestation matches publisher; SeedPublished uses typed bytes32 args.
 */
export const executorEventsAbi = [
  {
    type: 'event',
    name: 'CreatedAttestation',
    inputs: [
      {
        name: 'result',
        type: 'tuple',
        indexed: false,
        components: [
          { name: 'schemaUid', type: 'bytes32' },
          { name: 'attestationUid', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'SeedPublished',
    inputs: [
      { name: 'seedUid', type: 'bytes32', indexed: false },
      { name: 'versionUid', type: 'bytes32', indexed: false },
    ],
  },
] as const

const attestationDataComponents = [
  { name: 'recipient', type: 'address' },
  { name: 'expirationTime', type: 'uint64' },
  { name: 'revocable', type: 'bool' },
  { name: 'refUID', type: 'bytes32' },
  { name: 'data', type: 'bytes' },
  { name: 'value', type: 'uint256' },
] as const

/**
 * SeedProtocolExecutor (ERC-7579 executor module) calls and errors.
 * `multiPublish` takes `PublishRequestData` (selector 0x2a29fadc), which differs from the
 * ManagedAccount extension's `PublishRequestDataLegacy`: bytes32 fields are ordered
 * seedUid, versionUid, seedSchemaUid, versionSchemaUid, and propertiesToUpdate uses a
 * uint256 `publishIndex` instead of a string `publishLocalId`.
 */
export const executorModuleAbi = [
  {
    type: 'function',
    name: 'multiPublish',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'requests',
        type: 'tuple[]',
        components: [
          { name: 'localId', type: 'string' },
          { name: 'seedUid', type: 'bytes32' },
          { name: 'versionUid', type: 'bytes32' },
          { name: 'seedSchemaUid', type: 'bytes32' },
          { name: 'versionSchemaUid', type: 'bytes32' },
          { name: 'seedIsRevocable', type: 'bool' },
          {
            name: 'listOfAttestations',
            type: 'tuple[]',
            components: [
              { name: 'schema', type: 'bytes32' },
              { name: 'data', type: 'tuple[]', components: attestationDataComponents },
            ],
          },
          {
            name: 'propertiesToUpdate',
            type: 'tuple[]',
            components: [
              { name: 'publishIndex', type: 'uint256' },
              { name: 'propertySchemaUid', type: 'bytes32' },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    type: 'function',
    name: 'isInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getEAS',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  { type: 'error', name: 'AlreadyInitialized', inputs: [{ name: 'account', type: 'address' }] },
  { type: 'error', name: 'NotInitialized', inputs: [{ name: 'account', type: 'address' }] },
  { type: 'error', name: 'InvalidEASAddress', inputs: [] },
  { type: 'error', name: 'AttestationFailed', inputs: [] },
  { type: 'error', name: 'MultiAttestFailed', inputs: [] },
] as const

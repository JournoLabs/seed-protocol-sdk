/** Attestation request tuple shared by multiPublish variants. */
const attestationDataComponents = [
  { name: 'recipient', type: 'address' },
  { name: 'expirationTime', type: 'uint64' },
  { name: 'revocable', type: 'bool' },
  { name: 'refUID', type: 'bytes32' },
  { name: 'data', type: 'bytes' },
  { name: 'value', type: 'uint256' },
] as const

const listOfAttestationsComponents = [
  { name: 'schema', type: 'bytes32' },
  {
    name: 'data',
    type: 'tuple[]',
    components: attestationDataComponents,
  },
] as const

/** multiPublish with string localIds (selector 0x31e19cb8). */
export const multiPublishAbi = [
  {
    type: 'function',
    name: 'multiPublish',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'requests',
        type: 'tuple[]',
        components: [
          { name: 'localId', type: 'string' },
          { name: 'seedUid', type: 'bytes32' },
          { name: 'seedSchemaUid', type: 'bytes32' },
          { name: 'versionUid', type: 'bytes32' },
          { name: 'versionSchemaUid', type: 'bytes32' },
          { name: 'seedIsRevocable', type: 'bool' },
          {
            name: 'listOfAttestations',
            type: 'tuple[]',
            components: listOfAttestationsComponents,
          },
          {
            name: 'propertiesToUpdate',
            type: 'tuple[]',
            components: [
              { name: 'publishLocalId', type: 'string' },
              { name: 'propertySchemaUid', type: 'bytes32' },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: 'bytes32[]' }],
  },
] as const

/** multiPublish with uint256 localId indices (selector 0xd688e801). */
export const multiPublishIntegerAbi = [
  {
    type: 'function',
    name: 'multiPublish',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'requests',
        type: 'tuple[]',
        components: [
          { name: 'localIdIndex', type: 'uint256' },
          { name: 'seedUid', type: 'bytes32' },
          { name: 'seedSchemaUid', type: 'bytes32' },
          { name: 'versionUid', type: 'bytes32' },
          { name: 'versionSchemaUid', type: 'bytes32' },
          { name: 'seedIsRevocable', type: 'bool' },
          {
            name: 'listOfAttestations',
            type: 'tuple[]',
            components: listOfAttestationsComponents,
          },
          {
            name: 'propertiesToUpdate',
            type: 'tuple[]',
            components: [
              { name: 'publishLocalIdIndex', type: 'uint256' },
              { name: 'propertySchemaUid', type: 'bytes32' },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: 'bytes32[]' }],
  },
] as const

export const publisherReadWriteAbi = [
  {
    type: 'function',
    name: 'getEas',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'setEas',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_eas', type: 'address' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'isActiveSigner',
    stateMutability: 'view',
    inputs: [{ name: 'signer', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

/** Extension / ManagedAccount publisher events. */
export const publisherEventsAbi = [
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
    inputs: [{ name: 'returnedDataFromEAS', type: 'bytes', indexed: false }],
  },
] as const

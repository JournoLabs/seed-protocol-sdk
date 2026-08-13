/**
 * EAS contract ABI fragments + custom errors for revert decoding.
 */

export const EAS_ERRORS_ABI = [
  { type: 'error' as const, name: 'AccessDenied', inputs: [] },
  { type: 'error' as const, name: 'AlreadyRevoked', inputs: [] },
  { type: 'error' as const, name: 'InvalidRevocation', inputs: [] },
  { type: 'error' as const, name: 'InvalidRevocations', inputs: [] },
  { type: 'error' as const, name: 'InvalidSchema', inputs: [] },
  { type: 'error' as const, name: 'Irrevocable', inputs: [] },
  { type: 'error' as const, name: 'NotFound', inputs: [] },
  { type: 'error' as const, name: 'NotPayable', inputs: [] },
  { type: 'error' as const, name: 'InsufficientValue', inputs: [] },
  { type: 'error' as const, name: 'InvalidLength', inputs: [] },
] as const

const attestationRequestData = [
  { name: 'recipient', type: 'address' },
  { name: 'expirationTime', type: 'uint64' },
  { name: 'revocable', type: 'bool' },
  { name: 'refUID', type: 'bytes32' },
  { name: 'data', type: 'bytes' },
  { name: 'value', type: 'uint256' },
] as const

export const easAbi = [
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple',
            components: attestationRequestData,
          },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'multiAttest',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'requests',
        type: 'tuple[]',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple[]',
            components: attestationRequestData,
          },
        ],
      },
    ],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    type: 'function',
    name: 'multiRevoke',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'multiRequests',
        type: 'tuple[]',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple[]',
            components: [
              { name: 'uid', type: 'bytes32' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Attested',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'attester', type: 'address', indexed: true },
      { name: 'uid', type: 'bytes32', indexed: false },
      { name: 'schemaUID', type: 'bytes32', indexed: true },
    ],
  },
  ...EAS_ERRORS_ABI,
] as const

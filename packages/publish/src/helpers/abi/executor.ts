import { multiPublishAbi } from './publisher'

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

/**
 * SeedProtocolExecutor (ERC-7579 executor module) calls and errors.
 * `multiPublish` takes the same `PublishRequestData` as the ManagedAccount extension (selector
 * 0x2a29fadc), so it shares `multiPublishAbi`'s entry.
 */
export const executorModuleAbi = [
  multiPublishAbi[0],
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
  {
    type: 'event',
    name: 'ModuleInitialized',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'eas', type: 'address', indexed: true },
    ],
  },
  { type: 'error', name: 'AlreadyInitialized', inputs: [{ name: 'account', type: 'address' }] },
  { type: 'error', name: 'NotInitialized', inputs: [{ name: 'account', type: 'address' }] },
  { type: 'error', name: 'InvalidEASAddress', inputs: [] },
  { type: 'error', name: 'AttestationFailed', inputs: [] },
  { type: 'error', name: 'MultiAttestFailed', inputs: [] },
] as const

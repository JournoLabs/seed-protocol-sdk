import { multiPublishAbi } from './publisher'

/**
 * SeedProtocolExecutor (ERC-7579 executor module) calls and errors.
 * `multiPublish` takes the same `PublishRequestData` as the ManagedAccount extension (selector
 * 0xa1263421), so it shares `multiPublishAbi`'s entry.
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

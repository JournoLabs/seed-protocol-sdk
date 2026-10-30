/**
 * `SeedExecutorRouterExtension`, routed on ManagedAccounts by the factory
 * (seed-protocol contracts/SeedExecutorRouterExtension.sol). Installs the Seed executor on a
 * Router account.
 */
export const seedExecutorRouterAbi = [
  { type: 'function', name: 'installSeedExecutor', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'getSeedExecutor',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'executor', type: 'address' },
      { name: 'eas', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [
      { name: 'moduleTypeId', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'additionalContext', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'SeedExecutorInstalled',
    inputs: [{ name: 'executor', type: 'address', indexed: true }],
  },
  { type: 'error', name: 'Unauthorized', inputs: [{ name: 'caller', type: 'address' }] },
  { type: 'error', name: 'SeedExecutorAlreadyInstalled', inputs: [] },
  { type: 'error', name: 'SeedExecutorNotInstalled', inputs: [] },
] as const

/** ERC-7579 module type id for executors. */
export const MODULE_TYPE_EXECUTOR = 2n

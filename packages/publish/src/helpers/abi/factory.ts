/** Thirdweb ManagedAccount factory ABI (see `MANAGED_ACCOUNT_FACTORY_ADDRESSES` for deployments). */
export const managedAccountFactoryAbi = [
  {
    type: 'function',
    name: 'getAddress',
    stateMutability: 'view',
    inputs: [
      { name: '_adminSigner', type: 'address' },
      { name: '_data', type: 'bytes' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'createAccount',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_admin', type: 'address' },
      { name: '_data', type: 'bytes' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'getImplementationForFunction',
    stateMutability: 'view',
    inputs: [{ name: '_functionSelector', type: 'bytes4' }],
    outputs: [{ type: 'address' }],
  },
] as const

/** Thirdweb ManagedAccount factory (0x76f47…) on Optimism Sepolia. */
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
] as const

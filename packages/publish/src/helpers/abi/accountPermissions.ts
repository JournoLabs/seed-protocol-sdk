/**
 * Thirdweb's `AccountPermissions` extension, routed on ManagedAccounts
 * (@thirdweb-dev/contracts extension/upgradeable/AccountPermissions.sol). `setPermissionsForSigner`
 * has no caller check: it applies any request an admin of the account signed.
 */
const signerPermissionRequestComponents = [
  { name: 'signer', type: 'address' },
  { name: 'isAdmin', type: 'uint8' },
  { name: 'approvedTargets', type: 'address[]' },
  { name: 'nativeTokenLimitPerTransaction', type: 'uint256' },
  { name: 'permissionStartTimestamp', type: 'uint128' },
  { name: 'permissionEndTimestamp', type: 'uint128' },
  { name: 'reqValidityStartTimestamp', type: 'uint128' },
  { name: 'reqValidityEndTimestamp', type: 'uint128' },
  { name: 'uid', type: 'bytes32' },
] as const

/** EIP-712 types for a request; the domain is `{ name: 'Account', version: '1' }` on the account. */
export const signerPermissionRequestTypes = {
  SignerPermissionRequest: signerPermissionRequestComponents,
} as const

export const accountPermissionsAbi = [
  {
    type: 'function',
    name: 'setPermissionsForSigner',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_req', type: 'tuple', components: signerPermissionRequestComponents },
      { name: '_signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getPermissionsForSigner',
    stateMutability: 'view',
    inputs: [{ name: 'signer', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'signer', type: 'address' },
          { name: 'approvedTargets', type: 'address[]' },
          { name: 'nativeTokenLimitPerTransaction', type: 'uint256' },
          { name: 'startTimestamp', type: 'uint128' },
          { name: 'endTimestamp', type: 'uint128' },
        ],
      },
    ],
  },
] as const

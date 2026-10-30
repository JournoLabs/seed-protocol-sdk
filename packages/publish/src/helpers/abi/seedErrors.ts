/**
 * Custom errors a publish call can revert with on the ManagedAccount stack: SeedPublishLib,
 * the Seed protocol extensions, SeedAccountAuth and the Seed executor router extension.
 * The executor module's own errors are in `executorModuleAbi`, EAS's in `easAbi`.
 */
export const seedErrorsAbi = [
  // SeedPublishLib
  {
    type: 'error',
    name: 'PublishIndexOutOfBounds',
    inputs: [
      { name: 'targetIndex', type: 'uint256' },
      { name: 'length', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'EmptyAttestationData',
    inputs: [
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'PropertyToUpdateNotFound',
    inputs: [
      { name: 'requestIndex', type: 'uint256' },
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'AmbiguousPropertyToUpdate',
    inputs: [
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRelationEncoding',
    inputs: [
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidListEncoding',
    inputs: [
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'ListElementOutOfBounds',
    inputs: [
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
      { name: 'elementIndex', type: 'uint256' },
      { name: 'length', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ElementIndexOnSingleRelation',
    inputs: [
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'PlaceholderMismatch',
    inputs: [
      { name: 'requestIndex', type: 'uint256' },
      { name: 'targetIndex', type: 'uint256' },
      { name: 'propertySchemaUid', type: 'bytes32' },
      { name: 'found', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'PublishValueMismatch',
    inputs: [
      { name: 'required', type: 'uint256' },
      { name: 'sent', type: 'uint256' },
    ],
  },
  // SeedProtocolExtensionBase (the executor module's AttestationFailed() has no argument)
  { type: 'error', name: 'InvalidEAS', inputs: [{ name: 'eas', type: 'address' }] },
  { type: 'error', name: 'AttestationFailed', inputs: [{ name: 'schemaUid', type: 'bytes32' }] },
  // SeedAccountAuth
  { type: 'error', name: 'Unauthorized', inputs: [{ name: 'caller', type: 'address' }] },
  // SeedExecutorRouterExtension
  { type: 'error', name: 'InvalidAddress', inputs: [{ name: 'addr', type: 'address' }] },
  { type: 'error', name: 'SeedExecutorAlreadyInstalled', inputs: [] },
  { type: 'error', name: 'SeedExecutorNotInstalled', inputs: [] },
  { type: 'error', name: 'NotSeedExecutor', inputs: [{ name: 'caller', type: 'address' }] },
  { type: 'error', name: 'UnsupportedExecutionMode', inputs: [{ name: 'mode', type: 'bytes32' }] },
  { type: 'error', name: 'TargetNotAllowed', inputs: [{ name: 'target', type: 'address' }] },
  { type: 'error', name: 'SelectorNotAllowed', inputs: [{ name: 'selector', type: 'bytes4' }] },
  {
    type: 'error',
    name: 'ValueMismatch',
    inputs: [
      { name: 'encodedValue', type: 'uint256' },
      { name: 'sentValue', type: 'uint256' },
    ],
  },
] as const

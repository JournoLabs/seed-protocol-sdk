/**
 * Optional Thirdweb adapter entry for `@seedprotocol/publish/thirdweb`.
 * Import from here when using ConnectButton / in-app wallets / ModularCore bootstrap.
 */
export { fromThirdwebAccount, asThirdwebPublishWallet, asSeedSignerFromThirdweb } from './helpers/adapters/thirdwebAccount'

export {
  getClient,
  getManagedAccountWallet,
  getModularAccountWallet,
  getWalletsForConnectButton,
  getConnectedModularAccount,
  getConnectedAccount,
  getConnectedManagedAccountAddress,
  resolveSmartWalletForPublish,
  isSmartWalletDeployed,
  pollSmartWalletDeployed,
  deploySmartWalletContract,
  deployManagedAccountViaFactory,
  getSmartWalletAddressForAdmin,
  appMetadata,
  wallets,
  ExternalWalletsForDeploy,
  getSharedPublishInAppWalletStorage,
  useActiveSmartWalletContract,
  useLocalWalletAccount,
} from './helpers/thirdweb'

export { default as ConnectButton } from './react/ConnectButton'
export { default as PublishProvider, usePublishConfig } from './react/PublishProvider.thirdweb'
export type { PublishProviderProps } from './react/PublishProvider'

export {
  ensureSmartWalletThenPublish,
  type EnsureSmartWalletResult,
} from './helpers/ensureSmartWalletThenPublish'
export { ensureExecutorModuleInstalled } from './helpers/ensureExecutorModule'
export {
  ensureManagedAccountReady,
  tryDeployManagedAccount,
  runModularExecutorPublishPrep,
  type EnsureManagedAccountReadyResult,
  type ModularExecutorPublishPrepResult,
} from './helpers/ensureManagedAccountReady'
export { ensureEip7702ModularAccountReady } from './helpers/ensureEip7702ModularAccountReady'
export { ensureManagedSignerSessionKey } from './helpers/ensureManagedSignerSessionKey'
export { ensureModularPublishBootstrap } from './helpers/ensureModularPublishBootstrap'
export { defaultApprovedTargetsForModularPublish } from './helpers/defaultApprovedTargetsForModularPublish'
export { approvedTargetsForAutomationPublish } from './helpers/approvedTargetsForAutomationPublish'
export {
  ensureAutomationSessionKey,
  removeAutomationSessionKey,
  isAutomationSessionActive,
} from './helpers/ensureAutomationSessionKey'
export {
  PUBLISH_AUTOMATION_SCOPES,
  buildAutomationSessionKeyPermissions,
  hashAutomationSessionKeyPermissions,
  toThirdwebSessionKeyPermissions,
  type AutomationSessionKeyPermissions,
} from './helpers/automationSessionKeyPermissions'
export {
  enrollPublishAutomation,
  revokePublishAutomation,
  type EnrollPublishAutomationParams,
  type EnrollPublishAutomationResult,
  type RevokePublishAutomationParams,
} from './helpers/enrollPublishAutomation'
export {
  assertStorageBoundToIdentity,
  type AssertStorageBoundToIdentityParams,
  type AssertStorageBoundToIdentityResult,
} from './helpers/assertStorageBoundToIdentity'

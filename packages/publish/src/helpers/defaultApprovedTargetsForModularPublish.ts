import { approvedTargetsForAutomationPublish } from './approvedTargetsForAutomationPublish'

/**
 * Allowlisted call targets for a modular session signer: only the Seed executor module.
 *
 * Never the ManagedAccount (a key could then make any self-call, which the account trusts) and
 * never EAS (a direct EAS target bypasses the Seed extension's forced revocability).
 *
 * @deprecated Interactive publishing is a UserOp from the ManagedAccount itself and needs no
 * session key; automation keys use {@link approvedTargetsForAutomationPublish}, which this now
 * returns. `managedAddress` is ignored.
 * @throws if `modularAccountModuleContract` is unset or invalid
 */
export function defaultApprovedTargetsForModularPublish(_managedAddress?: string): `0x${string}`[] {
  return approvedTargetsForAutomationPublish()
}

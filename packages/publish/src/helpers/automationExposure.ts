import type { Address } from 'viem'
import { entryPoint06Address } from 'viem/account-abstraction'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { isContractDeployed } from './chainClient'
import { readAccountEntryPoint, readEntryPointDeposit, readEthBalance } from './contracts'

const DEFAULT_MAX_AUTOMATION_EXPOSURE_WEI = 10n ** 15n

function maxExposureWei(): bigint {
  return getPublishConfig().maxAutomationExposureWei ?? DEFAULT_MAX_AUTOMATION_EXPOSURE_WEI
}

/** The account's ETH: its balance plus its deposit in the EntryPoint it reports. */
async function readAccountEthWei(account: Address): Promise<bigint> {
  // An undeployed account can already hold both, and can't report its EntryPoint yet.
  const entryPoint = (await isContractDeployed(account))
    ? await readAccountEntryPoint(account)
    : entryPoint06Address
  const [balance, deposit] = await Promise.all([
    readEthBalance(account),
    readEntryPointDeposit(entryPoint, account),
  ])
  return balance + deposit
}

/**
 * Refuses an account holding more ETH than {@link PublishConfig.maxAutomationExposureWei}, or whose
 * ETH can't be read.
 *
 * @throws ManagedAccountPublishError `AUTOMATION_ACCOUNT_FUNDED`
 */
export async function assertAutomationExposureAllowed(managedAddress: string): Promise<void> {
  const max = maxExposureWei()
  let held: bigint
  try {
    held = await readAccountEthWei(managedAddress as Address)
  } catch (cause) {
    throw new ManagedAccountPublishError(
      `Could not read the ETH held by ${managedAddress}, so no automation session key was added.`,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }
  if (held > max) {
    throw new ManagedAccountPublishError(
      `${managedAddress} holds ${held} wei across its balance and EntryPoint deposit, above maxAutomationExposureWei (${max}). Withdraw it, or raise maxAutomationExposureWei to enroll this account.`,
      'AUTOMATION_ACCOUNT_FUNDED',
      managedAddress,
    )
  }
}

/** Warns when the account holds more than enroll would allow. A failed read warns nothing. */
export async function warnOnAutomationExposure(managedAddress: string): Promise<void> {
  try {
    const max = maxExposureWei()
    const held = await readAccountEthWei(managedAddress as Address)
    if (held > max) {
      console.warn(
        `@seedprotocol/publish: ${managedAddress} has an automation session key and holds ${held} wei, above maxAutomationExposureWei (${max}).`,
      )
    }
  } catch {
    // A publish doesn't depend on this read.
  }
}

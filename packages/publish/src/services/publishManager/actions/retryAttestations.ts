import type { SeedSigner } from '~/helpers/seedSigner'
import type { Account } from 'thirdweb/wallets'
import { asSeedSigner, isSeedSigner } from '~/helpers/seedSigner'

export const retryAttestations = ({
  context,
  event,
}: {
  context: {
    publishProcesses: Map<string, { send: (event: { type: string; account?: SeedSigner }) => void }>
  }
  event: unknown
}) => {
  const ev = event as { seedLocalId: string; account?: Account | SeedSigner }
  const { seedLocalId, account } = ev
  const publishProcess = context.publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`)
    return
  }
  const signer =
    account == null ? undefined : isSeedSigner(account) ? account : asSeedSigner(account)
  publishProcess.send({ type: 'retry', account: signer })
}

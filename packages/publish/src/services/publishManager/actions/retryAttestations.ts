import {
  isPublishWallet,
  type PublishWallet,
} from '~/helpers/seedSigner'
import { getPublishWallet } from '~/helpers/publishWalletRegistry'

export const retryAttestations = ({
  context,
  event,
}: {
  context: {
    publishProcesses: Map<
      string,
      { send: (event: { type: string; account?: PublishWallet; wallet?: PublishWallet }) => void }
    >
  }
  event: unknown
}) => {
  const ev = event as { seedLocalId: string; account?: unknown }
  const { seedLocalId, account } = ev
  const publishProcess = context.publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`)
    return
  }
  const wallet =
    account == null
      ? getPublishWallet() ?? undefined
      : isPublishWallet(account)
        ? account
        : undefined
  if (account != null && !wallet) {
    console.warn(
      '[retryAttestations] account must be a PublishWallet. Use fromThirdwebAccount / fromEip1193Provider / fromEthersWallet.',
    )
  }
  publishProcess.send({ type: 'retry', account: wallet, wallet })
}

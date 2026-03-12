import type { Account } from 'thirdweb/wallets'

export const retryAttestations = ({
  context,
  event,
}: {
  context: { publishProcesses: Map<string, { send: (event: { type: string; account?: Account }) => void }> }
  event: unknown
}) => {
  const ev = event as { seedLocalId: string; account?: Account }
  const { seedLocalId, account } = ev
  const publishProcess = context.publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`)
    return
  }
  publishProcess.send({ type: 'retry', account })
}

/** Forwards `giveUp` to the seed's publish. With no publish for the seed there is nothing to end. */
export const giveUpPublish = ({
  context,
  event,
}: {
  context: { publishProcesses: Map<string, { send: (event: { type: 'giveUp' }) => void }> }
  event: unknown
}) => {
  const { seedLocalId } = event as { seedLocalId: string }
  context.publishProcesses.get(seedLocalId)?.send({ type: 'giveUp' })
}

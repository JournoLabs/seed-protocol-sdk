// Dynamic import to break circular dependency with globalMachine
type PublishItemRequestEvent = {
  seedLocalId: string
}

type PublishItemRequestHandler = (
  event: PublishItemRequestEvent,
) => Promise<void>

export const publishItemRequestHandler: PublishItemRequestHandler = async ({
  seedLocalId,
}) => {
  // Use dynamic import to break circular dependency
  const { getGlobalService } = await import('@/services/global/globalMachine')
  const globalService = getGlobalService()
  globalService.subscribe((snapshot) => {
    if (
      !snapshot ||
      !snapshot.context ||
      !snapshot.context.publishItemService
    ) {
      return
    }
  })
  globalService.send({
    type: 'publishItemRequest',
    seedLocalId,
  })
}

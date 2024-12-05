import { getGlobalService } from '@/browser/services/global'

type PublishItemRequestEvent = {
  modelName?: string
  seedLocalId: string
}

type PublishItemRequestHandler = (
  event: PublishItemRequestEvent,
) => Promise<void>

export const publishItemRequestHandler: PublishItemRequestHandler = async ({
  modelName,
  seedLocalId,
}) => {
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
    modelName,
    seedLocalId,
  })
}

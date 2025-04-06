import { getGlobalService } from '@/services/global/globalMachine'

import { saveAppState } from '@/db/write/saveAppState'

type SaveServiceEvent = {
  modelName: string
}

export const saveServiceHandler = async (event: SaveServiceEvent) => {
  const globalService = getGlobalService()

  if (!globalService || !globalService.getSnapshot().context) {
    return
  }

  const { modelName } = event

  const nameOfService: string = `${modelName}Service`

  const service = globalService.getSnapshot().context[nameOfService]

  if (!service) {
    return
  }

  await saveAppState(
    `snapshot__${modelName}`,
    JSON.stringify(service.getPersistedSnapshot()),
  )
}

import { getGlobalService } from '@/browser/services/global'
import { writeAppState } from '@/browser/db/write'

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

  await writeAppState(
    `snapshot__${modelName}`,
    JSON.stringify(service.getPersistedSnapshot()),
  )
}

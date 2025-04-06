import { ModelRecordType, models } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'

type GetModels = () => Promise<ModelRecordType[]>

export const getModels: GetModels = async () => {

  const appDb = BaseDb.getAppDb()

  const modelsData = await appDb.select().from(models)

  return modelsData || []
}

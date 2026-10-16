// Dynamic import to break circular dependency: Model -> BaseItem -> ... -> getModelSchemas -> Model
// import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, modelUids } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import pluralize from 'pluralize'
import { easName, matchEasName } from '@seedprotocol/eas'
import { nameMatchLevels } from '@/db/read/nameMatchLevels'

type ModelRecord = {
  id: number
  name: string
  uid: string | null
  tableName?: string
}

const schemaStringToModelRecord = new Map<string, ModelRecord>()

type GetModelSchemasReturn = {
  schemaStringToModelRecord: Map<string, ModelRecord>
  modelRecords: ModelRecord[]
  /**
   * The local model an EAS model schema (`bytes32 <name>`) stands for, matched as ADR 0008
   * matches names: `bytes32 htmlpage` (an older SDK's name) finds HTMLPage, unless HTMLPage's
   * nameMatch is `exact` (ADR 0009). Undefined when nothing matches, or several models match
   * equally well.
   */
  matchModelRecord: (schemaString: string) => ModelRecord | undefined
}

type GetModelSchemas = () => Promise<GetModelSchemasReturn>

export const getModelSchemas: GetModelSchemas = async () => {
  // Dynamic import to break circular dependency
  const modelMod = await import('../../Model/Model')
  const { Model } = modelMod
  const allModels = await Model.all()
  const modelRecords: ModelRecord[] = []

  const appDb = BaseDb.getAppDb()

  for (const model of allModels) {
    const modelName = model.modelName
    if (!modelName) continue
    const foundModelQuery = await appDb
      .select({
        id: modelsTable.id,
        name: modelsTable.name,
        uid: modelUids.uid,
      })
      .from(modelsTable)
      .leftJoin(modelUids, eq(modelsTable.id, modelUids.modelId))
      // Model names are only unique per schema: use this model's own row
      .where(model.id ? eq(modelsTable.schemaFileId, model.id) : eq(modelsTable.name, modelName))
      .limit(1)

    if (!foundModelQuery[0]) {
      console.error(
        `[item/events] [syncDbWithEas] model ${modelName} not found in SDK DB`,
      )
      continue
    }

    const foundModel: ModelRecord = {
      id: foundModelQuery[0].id,
      name: foundModelQuery[0].name,
      uid: foundModelQuery[0].uid,
      tableName: pluralize(foundModelQuery[0].name).toLowerCase(),
    }

    modelRecords.push(foundModel)

    if (modelName === 'Seed') {
      continue
    }

    const schemaString = `bytes32 ${easName(modelName)}`

    schemaStringToModelRecord.set(schemaString, foundModel)
  }

  // One candidate per name: same-named models in several schemas share one EAS schema.
  const byName = new Map<string, ModelRecord>()
  for (const record of modelRecords) {
    if (record.name !== 'Seed') byName.set(record.name, record)
  }
  // ADR 0009: each model's name matches at its own nameMatch level.
  const levels = await nameMatchLevels(appDb)
  const candidates = [...byName.values()].map((record) => ({
    value: record,
    name: record.name,
    level: levels.model(record.name),
  }))
  const matchModelRecord = (schemaString: string): ModelRecord | undefined => {
    if (!schemaString.startsWith('bytes32 ')) return undefined
    const match = matchEasName(schemaString.slice('bytes32 '.length), candidates)
    return match.kind === 'match' ? match.value : undefined
  }

  return {
    schemaStringToModelRecord,
    modelRecords,
    matchModelRecord,
  }
}

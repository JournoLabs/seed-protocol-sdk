export type ModelClassType = {
  originalConstructor: () => void
  schema: ModelSchema
  schemaUid?: string
  create: <T>(values: ModelValues<T>) => Promise<Item<T>>
}

export type ModelValues<T> = Item<T> & {
  schema: ModelSchema
  [key: string & keyof T]: PropertyValue
}

export type ModelDefinitions = {
  [modelName: string]: ModelClassType
}

export type ModelSchema = Partial<Static<typeof TModelSchema>>

export type ModelConstructor = <
  T extends { new (...args: any[]): IModelClass },
>(
  constructor: T,
) => T & IModelClass

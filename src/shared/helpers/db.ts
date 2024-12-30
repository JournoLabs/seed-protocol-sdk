import {
  appState,
  models as modelsTable,
  NewModelRecord,
  NewPropertyRecord,
  properties,
} from 'src/shared/seedSchema'
import { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { DbQueryResult, ModelDefinitions, ResultObject } from '@/types'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'
import { and, eq, isNull, SQL } from 'drizzle-orm'

import { getAppDb } from '@/browser/db/sqlWasmClient'

export const escapeSqliteString = (value: string): string => {
  if (typeof value !== 'string') {
    throw new Error(
      `Value must be a string, instead got: ${JSON.stringify(value)}`,
    )
  }
  return value.replace(/'/g, "''")
}
export const getObjectForRow = (row: any): ResultObject => {
  const obj: ResultObject = {}

  row.columnNames.forEach((colName, index) => {
    const value = row.row[index]
    if (typeof value !== 'string') {
      obj[colName] = row.row[index]
      return
    }

    // Try to parse the value as JSON
    try {
      obj[colName] = JSON.parse(value)
    } catch (e) {
      // If it fails, just set the value as a string
      obj[colName] = value
    }
  })

  return obj
}
export const getSqlResultObject = (
  queryResult: DbQueryResult,
): ResultObject | ResultObject[] | undefined => {
  if (!queryResult || !queryResult.rows || queryResult.rows.length === 0) {
    return
  }

  let obj: ResultObject | ResultObject[] | undefined

  if (queryResult.rows.length === 1) {
    obj = getObjectForRow(queryResult.rows[0])
  }

  if (queryResult.rows.length > 1) {
    obj = queryResult.rows.reduce((acc, row) => {
      const rowObj = getObjectForRow(row)

      acc.push(rowObj)
      return acc
    }, [] as ResultObject[])
  }

  return obj
}
export const createOrUpdate = async <T>(
  db: BetterSQLite3Database | SqliteRemoteDatabase,
  table: SQLiteTableWithColumns<any>,
  values: Partial<Record<keyof T, T[keyof T]>>,
) => {
  const startTime = Date.now()

  const valueFilters: SQL[] = []

  const propertiesToExcludeFromDb = ['ref']

  const safeValues = Object.keys(values).reduce(
    (acc, key) => {
      if (!propertiesToExcludeFromDb.includes(key)) {
        acc[key] = values[key as string & keyof T]
      }
      return acc
    },
    {} as Record<string, unknown>,
  )

  for (const [key, value] of Object.entries(safeValues)) {
    let finalValue = value
    if (key === 'TObject') {
      continue
    }
    if (typeof value === 'object') {
      finalValue = JSON.stringify(value)
    }
    const column = table[key]
    if (!column) {
      throw new Error(`Column not found for ${key}`)
    }
    if (typeof finalValue === 'undefined') {
      finalValue = null
    }
    if (finalValue === null) {
      valueFilters.push(isNull(table[key]))
      continue
    }
    valueFilters.push(eq(table[key], finalValue))
  }

  const doneWithFilters = Date.now()

  // console.log('valueFilters:', valueFilters)

  // for ( const filter of valueFilters ) {
  //   console.log('filter:', Object.keys(filter))
  // }

  // Build a query to find the record based on properties
  const existingRecords = await db
    .select()
    .from(table)
    .where(and(...valueFilters))

  const doneWithExistingRecords = Date.now()

  if (existingRecords.length > 1) {
    throw new Error('Multiple records found')
  }

  if (existingRecords.length > 0) {
    // If record exists, update it
    await db
      .update(table)
      .set(safeValues)
      .where(and(...valueFilters))

    const doneWithUpdate = Date.now()

    return existingRecords[0] as T
  } else {
    // If no record exists, create a new one
    const newRecord = await db.insert(table).values(safeValues).returning()
    return newRecord[0] as T
  }
}
export const addModelsToInternalDb = async (
  db: BetterSQLite3Database<any> | SqliteRemoteDatabase<any>,
  models: ModelDefinitions,
) => {
  for (const [modelName, modelClass] of Object.entries(models)) {
    const modelRecord = await createOrUpdate<NewModelRecord>(db, modelsTable, {
      name: modelName,
    })

    for (let [propertyName, propertyValues] of Object.entries(
      modelClass.schema,
    )) {
      if (!propertyValues) {
        throw new Error(`Property values not found for ${propertyName}`)
      }
      propertyValues.name = propertyName
      propertyValues.modelId = modelRecord.id!
      for (let [key, value] of Object.entries(propertyValues)) {
        if (key === 'ref') {
          const refModel = await createOrUpdate<NewModelRecord>(
            db,
            modelsTable,
            {
              name: value,
            },
          )
          // delete propertyValues.ref
          propertyValues.refModelId = refModel.id
        }
      }

      const propertyRecord = await createOrUpdate<NewPropertyRecord>(
        db,
        properties,
        propertyValues,
      )
    }
  }
}
export const getAddressesFromDb = async (): Promise<string[]> => {
  const appDb = getAppDb()

  if (!appDb) {
    return new Promise((resolve) => {
      setTimeout(async () => {
        const addresses = await getAddressesFromDb()
        resolve(addresses)
      }, 500)
    })
  }

  const appStatesRecords = await appDb!
    .select()
    .from(appState)
    .where(eq(appState.key, 'addresses'))
    .limit(1)

  if (!appStatesRecords || appStatesRecords.length === 0) {
    throw new Error('No appStatesRecords for addresses found')
  }

  const addressRecord = appStatesRecords[0]

  const addressArrayString = addressRecord.value

  if (!addressArrayString) {
    throw new Error('No addresses found')
  }

  return JSON.parse(addressArrayString)
}

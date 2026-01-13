// import SeedImage from './browser/react/SeedImage'
// import { enableMapSet } from 'immer'

export {
  // Property,
  // Image,
  // List,
  // Text,
  // Json,
  // Relation,
  // Boolean,
  // Number,
  // Date,
  ModelPropertyDataTypes,
} from './Schema'

export { BaseItem as Item } from './Item/BaseItem'
export { BaseItemProperty as ItemProperty } from './ItemProperty/BaseItemProperty'
export { ModelProperty } from './ModelProperty/ModelProperty'
export { Schema, type SchemaAllOptions } from './Schema/Schema'
export { Model } from './Model/Model'

export {
  useItems,
  useItem,
  useItemProperties,
  useCreateItem,
  useItemProperty,
  useDeleteItem,
  useModels,
  useModel,
  useSchema,
  useSchemas,
  useCreateSchema,
  useAllSchemaVersions,
  useModelProperties,
  useModelProperty,
//   useGlobalServiceStatus,
//   usePublishItem,
//   usePersistedSnapshots,
//   useServices,
//   useService,
} from './browser/react'


// export { SeedImage }

export type { IItemProperty } from './interfaces/IItemProperty'

export { BaseFileManager as FileManager } from './helpers'
export { BaseEasClient as EasClient } from './helpers'
// export {FileManager as FileManagerBrowser} from './browser/helpers/FileManager'
// export {Db as DbBrowser} from './browser/db/Db'

// export {models, versions, seeds, metadata, appState, config, modelUids, } from './seedSchema'

// Model access - use Model static methods instead:
// - Model.getAll() - get all models
// - Model.getById(modelFileId) - get model by ID
// - Model.getByName(modelName, schemaName?) - get model by name
// - Model.getByNameAsync(modelName, schemaName?) - async version that queries DB if needed

export {
  getModelSchemasFromEas, 
  getItemVersionsFromEas, 
  getItemPropertiesFromEas, 
  getSchemaUidBySchemaName,
  getSeedsFromSchemaUids,
  getSeedsBySchemaName,
} from './eas'

export { SeedModels } from './helpers/constants'

export { getFeedItemsBySchemaName } from './feed'

export { 
  createSchema, 
  readSchema, 
  listCompleteSchemaFiles as listSchemas,
  getSchemaNameFromId,
} from './helpers/schema'

export { getPropertySchema } from './helpers/property'

export {
  updateModelProperties,
  renameModelProperty,
  deletePropertyFromModel,
  deleteModelFromSchema,
  type SchemaPropertyUpdate,
  type SchemaModelUpdate,
} from './helpers/updateSchema'

export { 
  importJsonSchema, 
  readJsonImportFile, 
  transformImportToSchemaFile, 
} from './imports'

export { seedVitePlugin } from './vite'

// export { getCorrectId, } from './helpers'

// export {
//   eventEmitter,
// } from './eventBus'

// enableMapSet()

// export { withSeed } from './node/webpack'

// export type { PublishUpload } from './db/read/getPublishUploads'
export type { Schema as SchemaType } from './helpers/schema'
export type { ModelClassType as ModelClass } from './types'
export type { Model as ModelType } from './Model/Model'

// PathResolver - Platform-specific implementation
// Auto-initializes based on environment when imported
// export { BasePathResolver as PathResolver } from './helpers/PathResolver/BasePathResolver'

// // Initialize PathResolver based on environment
// // This ensures the platform class is set when the SDK is imported
// if (typeof process !== 'undefined' && process.versions?.node) {
//   // Node.js - import node PathResolver to set platform class
//   import('./node/helpers/PathResolver').catch(() => {
//     // Silently fail if node PathResolver can't be loaded (e.g., in browser builds)
//   })
// } else {
//   // Browser - import browser PathResolver to set platform class
//   import('./browser/helpers/PathResolver').catch(() => {
//     // Silently fail if browser PathResolver can't be loaded
//   })
// }

export { client } from './client'

export * from './types'

// Node.js CLI exports (only available in Node.js environment)
// Note: These exports may cause bundling issues in browser/Electron renderer environments.
// If you encounter issues, import directly from '@seedprotocol/sdk/node' instead.
// export { getTsImport, commandExists, runSeedInit, findSeedBinary, INIT_SCRIPT_SUCCESS_MESSAGE, SCHEMA_TS } from './node'
// export { createDrizzleSchemaFilesFromConfig, generateModelCode } from './node/codegen/drizzle'


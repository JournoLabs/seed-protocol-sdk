import path                     from 'path'
import pluralize                from 'pluralize'
import { camelCase, snakeCase } from 'lodash-es'
import * as nunjucks            from 'nunjucks'
import { ILoader }              from 'nunjucks'
import { ModelClassType }       from '@/types'
import { SCHEMA_NJK }           from '@/helpers/constants'
import { getTsImport }          from '@/node/helpers'
import fs                       from 'fs'
import {PathResolver} from '@/node/PathResolver'
import debug          from 'debug'

const logger = debug('seedSdk:codegen:drizzle')


const TemplateLoader: ILoader = {
  getSource: (name: string) => {
    const pathResolver = PathResolver.getInstance()
    const { templatePath } = pathResolver.getAppPaths()
    let templateFilePath = templatePath
    if (name.includes(templatePath)) {
      templateFilePath = name
    } else {
      templateFilePath = path.join(templatePath, path.basename(name))
    }
    const src = fs.readFileSync(templateFilePath, 'utf-8')

    return {
      path: name,
      src,
      noCache: false,
    }
  },
}

// Configure Nunjucks
const env = new nunjucks.Environment(TemplateLoader)

env.addFilter('camelCase', camelCase)
env.addFilter('snakeCase', snakeCase)
env.addFilter('pluralize', pluralize)

const refNamesToExcludeFromRelations = [
  'Text',
  'Number',
  'Boolean',
  'Date',
]

export const generateDrizzleSchemaCode = (
  modelName: string,
  modelClass: ModelClassType,
): string => {
  const listProperties = Object.entries(modelClass.schema).filter(
    ([key, propertyDef]) => propertyDef?.dataType === 'List' && !refNamesToExcludeFromRelations.includes(propertyDef?.ref!),
  )

  const pathResolver = PathResolver.getInstance()
  const { templatePath } = pathResolver.getAppPaths()
  const filePath = path.join(templatePath, SCHEMA_NJK)

  const schemaCode = env.render(filePath, {
    modelName,
    modelClass,
    listProperties,
  })

  return schemaCode
}

export const createDrizzleSchemaFilesFromConfig = async (
  configFilePath: string | undefined,
  outputDirPath: string | undefined,
) => {
  const pathResolver = PathResolver.getInstance()
  const { dotSeedDir, appSchemaDir } = pathResolver.getAppPaths()
  console.log('createDrizzleSchemaFilesFromConfig', configFilePath, outputDirPath)

  const schemaFilePath = configFilePath || path.join(dotSeedDir, 'schema.ts') // Developer created file with model definitions
  console.log('schemaFilePath', schemaFilePath)

  const { models, } = await getTsImport<{
    models: Record<string, ModelClassType>
  }>(schemaFilePath)

  const writeToDir = outputDirPath || appSchemaDir

  for (const [modelName, modelClass] of Object.entries(models)) {
    const code = generateDrizzleSchemaCode(modelName, modelClass)

    if (!fs.existsSync(writeToDir)) {
      fs.mkdirSync(writeToDir)
    }

    const filePath = path.join(writeToDir, `${modelName}Schema.ts`)

    await fs.promises.writeFile(filePath, code).catch((e) => console.error(e))
  }
}

 // Helper to determine TypeScript type based on property type
 const seedTypeToJsType = (propertyType: string): string => {
  switch (propertyType) {
    case 'Text':
      return 'string';
    case 'Number':
      return 'number';
    case 'Boolean':
      return 'boolean';
    case 'Date':
      return 'string';
    case 'List':
      return 'string[]';
    case 'Relation':
      return 'string';
    case 'Image':
      return 'string';
    case 'File':
      return 'string';
    default:
      return 'any';
  }
};


export const generateModelCode = (values: Record<string, any>): string => {
  const { modelName, properties } = values;
  const pathResolver = PathResolver.getInstance()
  const { templatePath } = pathResolver.getAppPaths()

  if (modelName === 'Text' || modelName === 'TestModel') {
    logger(`Model name is ${modelName}.`)
  }

  const njkEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath))
  njkEnv.addFilter('seedTypeToJsType', seedTypeToJsType)
  return njkEnv.render('model.njk', { modelName, properties })
};

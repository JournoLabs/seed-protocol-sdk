import path                     from 'path'
import pluralize                from 'pluralize'
import { camelCase, snakeCase } from 'lodash-es'
import { ModelClassType }       from '@/types'

// Define ILoader type locally to avoid importing from nunjucks (prevents bundling issues)
type ILoader = {
  getSource(name: string): { path: string; src: string; noCache: boolean }
}
import { SCHEMA_NJK }           from '@/helpers/constants'
import { getTsImport }          from '@/node/helpers'
import fs                       from 'fs'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'
import debug          from 'debug'

const logger = debug('seedSdk:codegen:drizzle')

// Lazy load nunjucks to avoid bundling issues when only PathResolver is used
let nunjucksEnv: any = null

const getNunjucksEnv = async () => {
  if (!nunjucksEnv) {
    const nunjucks = await import('nunjucks')
    
    const TemplateLoader: ILoader = {
      getSource: (name: string) => {
        const pathResolver = BasePathResolver.getInstance()
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
    nunjucksEnv = new nunjucks.Environment(TemplateLoader)

    nunjucksEnv.addFilter('camelCase', camelCase)
    nunjucksEnv.addFilter('snakeCase', snakeCase)
    nunjucksEnv.addFilter('pluralize', pluralize)
  }
  return nunjucksEnv
}

const refNamesToExcludeFromRelations = [
  'Text',
  'Number',
  'Boolean',
  'Date',
]

export const generateDrizzleSchemaCode = async (
  modelName: string,
  modelClass: ModelClassType,
): Promise<string> => {
  const listProperties = Object.entries(modelClass.schema).filter(
    ([key, propertyDef]) => propertyDef?.dataType === 'List' && !refNamesToExcludeFromRelations.includes(propertyDef?.ref!),
  )

  const pathResolver = BasePathResolver.getInstance()
  const { templatePath } = pathResolver.getAppPaths()
  const filePath = path.join(templatePath, SCHEMA_NJK)

  const env = await getNunjucksEnv()
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
  const pathResolver = BasePathResolver.getInstance()
  const { dotSeedDir, appSchemaDir } = pathResolver.getAppPaths()
  console.log('createDrizzleSchemaFilesFromConfig', configFilePath, outputDirPath)

  // Use provided config file path or find the config file in the project root
  const schemaFilePath = configFilePath || pathResolver.findConfigFile() || path.join(dotSeedDir, 'seed.config.ts')
  console.log('schemaFilePath', schemaFilePath)

  const { models, } = await getTsImport<{
    models: Record<string, ModelClassType>
  }>(schemaFilePath)

  const writeToDir = outputDirPath || appSchemaDir

  for (const [modelName, modelClass] of Object.entries(models)) {
    const code = await generateDrizzleSchemaCode(modelName, modelClass)

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


export const generateModelCode = async (values: Record<string, any>): Promise<string> => {
  const { modelName, properties } = values;
  const pathResolver = BasePathResolver.getInstance()
  const { templatePath } = pathResolver.getAppPaths()

  if (modelName === 'Text' || modelName === 'TestModel') {
    logger(`Model name is ${modelName}.`)
  }

  const nunjucks = await import('nunjucks')
  const njkEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath))
  njkEnv.addFilter('seedTypeToJsType', seedTypeToJsType)
  return njkEnv.render('model.njk', { modelName, properties })
};

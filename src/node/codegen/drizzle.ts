import path from 'path'
import { fs } from 'fs'
import pluralize from 'pluralize'
import { camelCase, snakeCase } from 'lodash-es'
import * as nunjucks from 'nunjucks'
import { ILoader } from 'nunjucks'
import { ModelClassType } from '@/types'
import { SCHEMA_NJK } from '@/helpers/constants'
import {
  appGeneratedSchemaDir,
  dotSeedDir,
  templatePath,
} from '@/node/constants'
import { getTsImport } from '@/node/helpers'

const TemplateLoader: ILoader = {
  getSource: (name: string) => {
    let templateFilePath
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

const generateDrizzleSchemaCode = (
  modelName: string,
  modelClass: ModelClassType,
): string => {
  const listProperties = Object.entries(modelClass.schema).filter(
    ([key, propertyDef]) => propertyDef?.dataType === 'List',
  )

  const filePath = path.join(templatePath, SCHEMA_NJK)

  const schemaCode = env.render(filePath, {
    modelName,
    modelClass,
    listProperties,
  })

  return schemaCode
}

export const createDrizzleSchemaFilesFromConfig = async () => {
  const schemaFilePath = path.join(dotSeedDir, 'schema.ts') // Developer created file with model definitions

  const { models } = await getTsImport<{
    models: Record<string, ModelClassType>
  }>(schemaFilePath)

  for (const [modelName, modelClass] of Object.entries(models)) {
    const code = generateDrizzleSchemaCode(modelName, modelClass)

    if (!fs.existsSync(appGeneratedSchemaDir)) {
      fs.mkdirSync(appGeneratedSchemaDir)
    }

    const filePath = path.join(appGeneratedSchemaDir, `${modelName}Schema.ts`)

    await fs.promises.writeFile(filePath, code).catch((e) => console.error(e))
  }
}

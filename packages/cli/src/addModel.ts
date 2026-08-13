#!/usr/bin/env node
/**
 * Inject a Model class stub into a seed.config.ts-style file.
 * Prefer defining models via JSON schema + Schema.create() / Model.create() for new apps.
 */
import fs from 'fs'

const args = process.argv.slice(2)
const sourceSchemaFilePath = args[0]
const outputFilePath = args[1]
const jsonString = args[2]

if (!sourceSchemaFilePath || !outputFilePath || !jsonString) {
  console.error(
    'Usage: seed-add-model <source-schema-file-path> <output-file-path> <json-string>',
  )
  process.exit(1)
}

let fileContents: string
try {
  fileContents = fs.readFileSync(sourceSchemaFilePath, 'utf-8')
} catch (error) {
  console.error(`Error reading file at ${sourceSchemaFilePath}:`, error)
  process.exit(1)
}

let jsonModel: { name: string; properties?: Array<Record<string, unknown>> }
try {
  jsonModel = JSON.parse(jsonString)
} catch (error) {
  console.error('Invalid JSON string:', error)
  process.exit(1)
}

function seedTypeToJsType(type: string): string {
  switch (type) {
    case 'Number':
      return 'number'
    case 'Boolean':
      return 'boolean'
    case 'Date':
      return 'Date'
    case 'List':
      return 'unknown[]'
    default:
      return 'string'
  }
}

function generateModelCode(modelName: string, properties: Array<Record<string, unknown>> = []): string {
  const lines = properties.map((property) => {
    const name = String(property.name)
    const type = String(property.type || 'Text')
    const jsType = seedTypeToJsType(type)

    if (type === 'Relation') {
      return `  @Relation('${property.targetModel}') ${name}!: ${jsType}`
    }
    if (type === 'List') {
      const refType = property.refValueType || 'Relation'
      const target = property.targetModel || property.ref
      const targetArg = target ? `, '${target}'` : ''
      return `  @List('${refType}'${targetArg}) ${name}!: ${jsType}`
    }
    if (type === 'File') {
      return `  @File('${property.storageType}', '${property.storagePath}') ${name}!: ${jsType}`
    }
    return `  @${type}() ${name}!: ${jsType}`
  })

  return `@Model
class ${modelName} {
${lines.join('\n')}
}`
}

const injectModel = (schemaContent: string, newModelCode: string) => {
  const modelNameMatch = newModelCode.match(/class\s+(\w+)/)
  if (!modelNameMatch) {
    throw new Error('Could not extract model name from provided code')
  }
  const modelName = modelNameMatch[1]

  const modelsPos = schemaContent.indexOf('const models')
  if (modelsPos === -1) {
    throw new Error("Could not find 'const models' in the schema")
  }

  const lastClassPos = schemaContent.lastIndexOf('@Model', modelsPos)
  if (lastClassPos === -1) {
    throw new Error('Could not find any model declarations in the schema')
  }

  const classEndPos = schemaContent.indexOf('}', lastClassPos)
  if (classEndPos === -1) {
    throw new Error('Could not find closing brace of the last model class')
  }

  const insertModelPos = schemaContent.indexOf('\n', classEndPos) + 1

  let updatedSchema =
    schemaContent.slice(0, insertModelPos) +
    '\n' +
    newModelCode +
    '\n\n' +
    schemaContent.slice(insertModelPos)

  const modelsClosingBracePos = updatedSchema.indexOf(
    '}',
    updatedSchema.indexOf('const models'),
  )

  updatedSchema =
    updatedSchema.slice(0, modelsClosingBracePos) +
    `  ${modelName},\n` +
    updatedSchema.slice(modelsClosingBracePos)

  return updatedSchema
}

if (fileContents.includes(`class ${jsonModel.name}`)) {
  console.error(`Model with name ${jsonModel.name} already exists in the schema`)
  process.exit(0)
}

try {
  const newModelCode = generateModelCode(jsonModel.name, jsonModel.properties || [])
  const updatedSchema = injectModel(fileContents, newModelCode)
  fs.writeFileSync(outputFilePath, updatedSchema, 'utf-8')
  console.log(`Wrote updated schema file to ${outputFilePath}`)
} catch (error) {
  console.error('Error writing schema file:', error)
  process.exit(1)
}

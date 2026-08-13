// @ts-nocheck - SDK exports exist but TypeScript can't see them in dist types yet
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { rimrafSync } from 'rimraf'
import {
  PathResolver,
  ensureNodeDbSchema,
  INIT_SCRIPT_SUCCESS_MESSAGE,
} from '@seedprotocol/sdk/node'
import { seedDatabase } from './bin'
import { loadSeedConfig } from './loadSeedConfig'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pathResolver = PathResolver.getInstance()

/**
 * Copy a directory and all its contents recursively
 */
function copyDirectoryRecursively(sourceDir: string, targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const entries = fs.readdirSync(sourceDir)

  for (const entry of entries) {
    if (entry === '__tests__') {
      console.log(`Skipping __tests__ directory: ${path.join(sourceDir, entry)}`)
      continue
    }

    const sourcePath = path.join(sourceDir, entry)
    const targetPath = path.join(targetDir, entry)
    const stats = fs.statSync(sourcePath)

    if (stats.isFile()) {
      fs.copyFileSync(sourcePath, targetPath)
      console.log(`Copied file: ${sourcePath} → ${targetPath}`)
    } else if (stats.isDirectory()) {
      copyDirectoryRecursively(sourcePath, targetPath)
    }
  }
}

export const runInit = async (schemaFileDir?: string, appFilesDirPath?: string) => {
  console.log('[Seed Protocol] Running init script')

  if (schemaFileDir && schemaFileDir.startsWith('.')) {
    const relativePath = schemaFileDir.replace('./', '')
    if (!process.cwd().includes(relativePath)) {
      schemaFileDir = path.resolve(schemaFileDir)
    }
    if (process.cwd().includes(relativePath)) {
      schemaFileDir = process.cwd()
    }
  }

  if (!schemaFileDir && !process.cwd().includes('seed-protocol-sdk')) {
    schemaFileDir = process.cwd()
  }

  console.log('[Seed Protocol] schemaFileDir', schemaFileDir)

  if (!schemaFileDir) {
    const foundConfigFile = pathResolver.findConfigFile()
    if (foundConfigFile) {
      schemaFileDir = path.dirname(foundConfigFile)
    } else {
      console.error(
        'No config file found. Please create a seed.config.ts, seed.schema.ts, or schema.ts file in your project root.',
      )
      return
    }
  }

  const { dotSeedDir, sdkRootDir } = pathResolver.getAppPaths(schemaFileDir)

  const configFilePath = pathResolver.findConfigFile(schemaFileDir)
  if (!configFilePath) {
    console.error('Config file not found in the specified directory.')
    return
  }

  if (fs.existsSync(dotSeedDir)) {
    fs.rmSync(dotSeedDir, { recursive: true, force: true })
  }

  console.log('[Seed Protocol] dotSeedDir', dotSeedDir)

  const copyDotSeedFilesToAppFiles = async (_appFilesDirPath: string) => {
    console.log('[Seed Protocol] Copying dot seed files to app files')
    const { endpoints } = await loadSeedConfig(configFilePath)

    const outputDirPath = endpoints?.localOutputDir || _appFilesDirPath

    const exists = await fs.promises
      .access(outputDirPath)
      .then(() => true)
      .catch(() => false)
    if (exists) {
      await fs.promises.rm(outputDirPath, { recursive: true, force: true })
    }

    console.log(`[Seed Protocol] making dir at ${outputDirPath}`)
    fs.mkdirSync(outputDirPath, { recursive: true })
    console.log('[Seed Protocol] copying app files')

    copyDirectoryRecursively(dotSeedDir, outputDirPath)

    console.log('[Seed Protocol] removing sqlite3 files and index.ts files')
    rimrafSync(`${outputDirPath}/**/*.sqlite3`, { glob: true })
    rimrafSync(`${outputDirPath}/**/*.db`, { glob: true })
    rimrafSync(`${outputDirPath}/**/index.ts`, { glob: true })
  }

  const seedSchemaPath = fs.existsSync(path.join(sdkRootDir, 'src', 'seedSchema'))
    ? path.join(sdkRootDir, 'src', 'seedSchema')
    : path.join(sdkRootDir, 'seedSchema')

  copyDirectoryRecursively(seedSchemaPath, path.join(dotSeedDir, 'schema'))

  console.log('copying', configFilePath, path.join(dotSeedDir, 'seed.config.ts'))
  fs.copyFileSync(configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

  // Apply static SDK schema to a fresh Node DB (no per-app Drizzle codegen)
  await ensureNodeDbSchema(schemaFileDir, dotSeedDir)

  const seedDataFilePath = path.join(__dirname, 'seedData.json')
  await seedDatabase(seedDataFilePath, dotSeedDir)

  if (appFilesDirPath) {
    await copyDotSeedFilesToAppFiles(appFilesDirPath)
  } else {
    console.log('[Seed Protocol] Finished running init script')
  }

  console.log(INIT_SCRIPT_SUCCESS_MESSAGE)
}

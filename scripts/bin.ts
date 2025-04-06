#!/usr/bin/env node
import path from 'path'
import fs                        from 'fs'
import { execSync, }                    from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import process                          from 'node:process'
import '@/node/helpers/EasClient'
import '@/node/helpers/QueryClient'
import '@/node/helpers/FileManager'
import '@/node/helpers/ArweaveClient'
import { INIT_SCRIPT_SUCCESS_MESSAGE, SCHEMA_TS } from '@/helpers/constants'
import { PathResolver } from '@/node/PathResolver'
import { createDrizzleSchemaFilesFromConfig } from '@/node/codegen'
import { rimrafSync } from 'rimraf'
import { getTsImport } from '@/node/helpers'
import { ModelClassType } from '@/types/model'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { appState } from '@/seedSchema/AppStateSchema'
import { config } from '@/seedSchema/ConfigSchema'
import { metadata } from '@/seedSchema/MetadataSchema'
import { models } from '@/seedSchema/ModelSchema'
import { modelUids } from '@/seedSchema/ModelUidSchema'
import { seeds } from '@/seedSchema/SeedSchema'
import { versions } from '@/seedSchema/VersionSchema'
import { commandExists } from '@/helpers/scripts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let a

a = process.argv.splice(2)
const pathResolver = PathResolver.getInstance()

/**
 * Copy a directory and all its contents recursively
 * @param {string} sourceDir - Path to the source directory
 * @param {string} targetDir - Path to the target directory
 */
function copyDirectoryRecursively(sourceDir: string, targetDir: string) {
  // Create the target directory if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Read all entries in the source directory
  const entries = fs.readdirSync(sourceDir);

  // Process each entry
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    
    // Check if the entry is a file or directory
    const stats = fs.statSync(sourcePath);
    
    if (stats.isFile()) {
      // Copy the file directly
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`Copied file: ${sourcePath} → ${targetPath}`);
    } 
    else if (stats.isDirectory()) {
      // Recursively copy the subdirectory
      copyDirectoryRecursively(sourcePath, targetPath);
    }
  }
}

const seedDatabase = async (seedDataPath: string) => {
  console.log('[Seed Protocol] Running seed script')

  try {
    // Read the seed data file
    const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'))
    
    // Connect to the database
    const dotSeedDir = pathResolver.getDotSeedDir()
    const dbPath = path.join(dotSeedDir, 'db', 'app_db.sqlite3')
    const sqlite = new Database(dbPath)
    const db = drizzle(sqlite)
    
    // Seed each table based on the provided data
    if (seedData.appState && seedData.appState.length > 0) {
      await db.insert(appState).values(seedData.appState)
      console.log('Seeded appState table')
    }
    
    if (seedData.config && seedData.config.length > 0) {
      await db.insert(config).values(seedData.config)
      console.log('Seeded config table')
    }
    
    if (seedData.models && seedData.models.length > 0) {
      await db.insert(models).values(seedData.models)
      console.log('Seeded models table')
    }
    
    if (seedData.modelUids && seedData.modelUids.length > 0) {
      await db.insert(modelUids).values(seedData.modelUids)
      console.log('Seeded modelUids table')
    }
    
    if (seedData.metadata && seedData.metadata.length > 0) {
      await db.insert(metadata).values(seedData.metadata)
      console.log('Seeded metadata table')
    }
    
    if (seedData.seeds && seedData.seeds.length > 0) {
      await db.insert(seeds).values(seedData.seeds)
      console.log('Seeded seeds table')
    }
    
    if (seedData.versions && seedData.versions.length > 0) {
      await db.insert(versions).values(seedData.versions)
      console.log('Seeded versions table')
    }
    
    console.log('[Seed Protocol] Successfully seeded database')
  } catch (error) {
    console.error('[Seed Protocol] Error seeding database:', error)
    process.exit(1)
  }
}

const init = (args: string[],) => {
  console.log('args:', args)

  if (args && args.length) {
    if (args[0] === 'init') {
      console.log('[Seed Protocol] Running init script')

      let appFilesDirPath = args[2] || undefined
      let schemaFileDir = args[1]

      if (schemaFileDir && schemaFileDir.startsWith('.')) {
        const relativePath = schemaFileDir.replace('./', '')
        if (!process.cwd().includes(relativePath)) {
          schemaFileDir = path.resolve(schemaFileDir,)
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
        const defaultSchemaFilePath = path.join(process.cwd(), 'schema.ts')
        if (fs.existsSync(defaultSchemaFilePath)) {
          schemaFileDir = process.cwd()
        } else {
          console.error('No schema file path provided and no default schema file found.')
          return
        }
      }

      const {
        dotSeedDir,
        appSchemaDir,
        appMetaDir,
        drizzleDbConfigPath,
        drizzleKitPath,
        sdkRootDir,
      } = pathResolver.getAppPaths(schemaFileDir)

      const schemaFilePath = path.join(schemaFileDir, SCHEMA_TS)

      // Remove dotSeedDir to start fresh each time
      if (fs.existsSync(dotSeedDir)) {
        fs.rmSync(dotSeedDir, { recursive: true, force: true })
      }

      console.log('[Seed Protocol] dotSeedDir', dotSeedDir)

      const tsconfigArg = `--tsconfig ${sdkRootDir}/tsconfig.json`

      const drizzleKitCommand = `npx --yes tsx ${drizzleKitPath}`

      const ensureIndexExports = (dirPath: string): void => {
        try {
          // Get all file names in the directory
          const files = fs.readdirSync(dirPath)

          // Filter for .ts files excluding index.ts
          const tsFiles = files.filter(
            (file) => file.endsWith('.ts') && file !== 'index.ts',
          )

          // Check if index.ts exists
          const indexFilePath = path.join(dirPath, 'index.ts')
          try {
            fs.accessSync(indexFilePath)
          } catch (error) {
            console.error(`index.ts not found in the directory: ${dirPath}`)
            return
          }

          // Read the content of index.ts
          const indexContent = fs.readFileSync(indexFilePath, 'utf8')

          // Create export statements for each .ts file
          const exportStatements = tsFiles.map(
            (file) => `export * from './${path.basename(file, '.ts')}';`,
          )

          // Check if each export statement is already present in index.ts
          const missingExports = exportStatements.filter(
            (statement) => !indexContent.includes(statement),
          )

          if (missingExports.length > 0) {
            // Append missing export statements to index.ts
            const newContent =
              indexContent + '\n' + missingExports.join('\n') + '\n'
            fs.writeFileSync(indexFilePath, newContent, 'utf8')
            console.log(
              `Updated index.ts with missing exports:\n${missingExports.join('\n')}`,
            )
          } else {
            console.log('All exports are already present in index.ts')
          }
        } catch (error) {
          console.error(`Error processing directory: ${dirPath}`, error)
        }
      }

      const copyDotSeedFilesToAppFiles = async (_appFilesDirPath: string) => {
        console.log('[Seed Protocol] Copying dot seed files to app files')
        const { endpoints } = await getTsImport<{
          models: Record<string, ModelClassType>,
          endpoints: Record<string, string>
        }>(schemaFilePath)

        const outputDirPath = endpoints.localOutputDir || _appFilesDirPath

        const exists = await fs.promises.access(outputDirPath).then(() => true).catch(() => false)
        if (exists) {
          await fs.promises.rm(outputDirPath, { recursive: true, force: true })
        }
        
        console.log(`[Seed Protocol] making dir at ${outputDirPath}`)
        fs.mkdirSync(outputDirPath, { recursive: true })
        console.log('[Seed Protocol] copying app files')
        fs.cpSync(dotSeedDir, outputDirPath, { recursive: true })
        console.log('[Seed Protocol] removing sqlite3 files and index.ts files')
        rimrafSync(`${outputDirPath}/**/*.sqlite3`, { glob: true })
        rimrafSync(`${outputDirPath}/**/index.ts`, { glob: true })
      }

      const updateSchema = async (pathToConfig: string, pathToMeta: string) => {
        if (!fs.existsSync(pathToMeta)) {
          console.log(`${drizzleKitCommand} generate --config=${pathToConfig}`)
          execSync(
            `${drizzleKitCommand} generate --config=${pathToConfig}`,
          )
        }
        execSync(`${drizzleKitCommand} migrate --config=${pathToConfig}`)
      }

      const runCommands = async () => {
        const tsxExists = commandExists('tsx')
        if (!tsxExists) {
          execSync(`npm install -g tsx`, {stdio: 'inherit'})
        }

        await createDrizzleSchemaFilesFromConfig(schemaFilePath, undefined)
        ensureIndexExports(appSchemaDir!)
        await updateSchema(drizzleDbConfigPath, appMetaDir!)
        const seedDataFilePath = path.join(__dirname, 'seedData.json')
        await seedDatabase(seedDataFilePath)
      }

      copyDirectoryRecursively(
        path.join(pathResolver.getSdkRootDir(), 'seedSchema'),
        path.join(dotSeedDir, 'schema'),
      )

      copyDirectoryRecursively(
        path.join(pathResolver.getSdkRootDir(), 'node', 'codegen'),
        path.join(dotSeedDir, 'codegen'),
      )

      console.log('copying', schemaFilePath, path.join(dotSeedDir, 'schema.ts'))

      fs.copyFileSync(schemaFilePath, path.join(dotSeedDir, 'schema.ts'))

      runCommands()
        .then(() => {
          if (!appFilesDirPath) {
            console.log('[Seed Protocol] Finished running init script')
          } else {
            return copyDotSeedFilesToAppFiles(appFilesDirPath)
          }
        })
        .then(() => {
          console.log(INIT_SCRIPT_SUCCESS_MESSAGE)
        })
    } else if (args[0] === 'seed' && args[1]) {
      seedDatabase(args[1])
    } else {
      console.log('Unknown command. Available commands:')
      console.log('init [schemaPath] [appFilesPath] - Initialize the database')
      console.log('seed [seedDataPath] - Seed the database with data from JSON file')
    }
  }
}

const calledFrom = pathToFileURL(process.argv[1]).href

console.log('calledFrom', calledFrom)

if (
  calledFrom.endsWith('node_modules/.bin/seed') ||
  import.meta.url.endsWith('@seedprotocol/sdk/node/bin.js') ||
  import.meta.url.endsWith('scripts/bin.ts')
) {
  // module was not imported but called directly
  init(a)
}

export { init }

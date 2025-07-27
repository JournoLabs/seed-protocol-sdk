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

import { rimrafSync } from 'rimraf'
import { getTsImport } from '@/node/helpers'
import { ModelClassType } from '@/types/model'
import { appState, config, metadata, models, modelUids, seeds, versions } from '@/seedSchema'
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
    // Skip __tests__ directories to prevent recursive copying
    if (entry === '__tests__') {
      console.log(`Skipping __tests__ directory: ${path.join(sourceDir, entry)}`);
      continue;
    }

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

const seedDatabase = async (seedDataPath: string, dotSeedDir?: string) => {
  console.log('[Seed Protocol] Running seed script')

  try {
    // Import better-sqlite3 dynamically to handle optional dependency
    let drizzle: any
    let Database: any
    
    try {
      const drizzleModule = await import('drizzle-orm/better-sqlite3')
      const betterSqlite3Module = await import('better-sqlite3')
      drizzle = drizzleModule.drizzle
      Database = betterSqlite3Module.default
    } catch (importError) {
      console.error('[Seed Protocol] Error: better-sqlite3 is required for seeding the database.')
      console.error('[Seed Protocol] Please install better-sqlite3: npm install better-sqlite3')
      process.exit(1)
    }
    
    // Read the seed data file
    const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'))
    
    // Connect to the database
    const actualDotSeedDir = dotSeedDir || pathResolver.getDotSeedDir()
    const dbDir = path.join(actualDotSeedDir, 'db')
    const dbPath = path.join(dbDir, 'app_db.sqlite3')
    
    // Ensure the database directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
    
    const sqlite = new Database(dbPath)
    const db = drizzle(sqlite)
    
    // Import the generated schema files
    const schemaPath = path.join(actualDotSeedDir, 'schema')
    const { appState: generatedAppState, config: generatedConfig, metadata: generatedMetadata, models: generatedModels, modelUids: generatedModelUids, seeds: generatedSeeds, versions: generatedVersions } = await import(schemaPath + '/index.ts')
    
    // Seed each table based on the provided data
    if (seedData.appState && seedData.appState.length > 0) {
      await db.insert(generatedAppState).values(seedData.appState)
      console.log('Seeded appState table')
    }
    
    if (seedData.config && seedData.config.length > 0) {
      await db.insert(generatedConfig).values(seedData.config)
      console.log('Seeded config table')
    }
    
    if (seedData.models && seedData.models.length > 0) {
      await db.insert(generatedModels).values(seedData.models)
      console.log('Seeded models table')
    }
    
    if (seedData.modelUids && seedData.modelUids.length > 0) {
      await db.insert(generatedModelUids).values(seedData.modelUids)
      console.log('Seeded modelUids table')
    }
    
    if (seedData.metadata && seedData.metadata.length > 0) {
      await db.insert(generatedMetadata).values(seedData.metadata)
      console.log('Seeded metadata table')
    }
    
    if (seedData.seeds && seedData.seeds.length > 0) {
      await db.insert(generatedSeeds).values(seedData.seeds)
      console.log('Seeded seeds table')
    }
    
    if (seedData.versions && seedData.versions.length > 0) {
      await db.insert(generatedVersions).values(seedData.versions)
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
        // Use the new config file finding logic
        const foundConfigFile = pathResolver.findConfigFile()
        if (foundConfigFile) {
          schemaFileDir = path.dirname(foundConfigFile)
        } else {
          console.error('No config file found. Please create a seed.config.ts, seed.schema.ts, or schema.ts file in your project root.')
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

      // Find the actual config file in the schema file directory
      const configFilePath = pathResolver.findConfigFile(schemaFileDir)
      if (!configFilePath) {
        console.error('Config file not found in the specified directory.')
        return
      }

      // Remove dotSeedDir to start fresh each time
      if (fs.existsSync(dotSeedDir)) {
        try {
          fs.rmSync(dotSeedDir, { recursive: true, force: true })
        } catch (error) {
          // If rmSync fails, try using rimraf as fallback
          rimrafSync(dotSeedDir)
        }
      }

      console.log('[Seed Protocol] dotSeedDir', dotSeedDir)

      const tsconfigArg = `--tsconfig ${sdkRootDir}/tsconfig.json`

      const drizzleKitCommand = `npx --yes tsx ${drizzleKitPath}`



      const copyDotSeedFilesToAppFiles = async (_appFilesDirPath: string) => {
        console.log('[Seed Protocol] Copying dot seed files to app files')
        const { endpoints } = await getTsImport<{
          models: Record<string, ModelClassType>,
          endpoints: Record<string, string>
        }>(configFilePath)

        const outputDirPath = endpoints.localOutputDir || _appFilesDirPath

        const exists = await fs.promises.access(outputDirPath).then(() => true).catch(() => false)
        if (exists) {
          await fs.promises.rm(outputDirPath, { recursive: true, force: true })
        }
        
        console.log(`[Seed Protocol] making dir at ${outputDirPath}`)
        fs.mkdirSync(outputDirPath, { recursive: true })
        console.log('[Seed Protocol] copying app files')
        
        // Use copyDirectoryRecursively instead of fs.cpSync to exclude __tests__ directories
        copyDirectoryRecursively(dotSeedDir, outputDirPath)
        
        console.log('[Seed Protocol] removing sqlite3 files and index.ts files')
        rimrafSync(`${outputDirPath}/**/*.sqlite3`, { glob: true })
        rimrafSync(`${outputDirPath}/**/index.ts`, { glob: true })
      }

      const updateSchema = async (pathToConfig: string, pathToMeta: string) => {
        try {
          // Create a project-specific Drizzle Kit configuration
          const projectConfigPath = path.join(dotSeedDir, 'drizzle.config.ts')
          const projectConfig = `import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: '${path.join(dotSeedDir, 'schema')}',
  dialect: 'sqlite',
  out: '${path.join(dotSeedDir, 'db')}',
  dbCredentials: {
    url: '${path.join(dotSeedDir, 'db', 'app_db.sqlite3')}',
  },
})`
          
          fs.writeFileSync(projectConfigPath, projectConfig)
          
          if (!fs.existsSync(pathToMeta)) {
            console.log(`${drizzleKitCommand} generate --config=${projectConfigPath}`)
            execSync(
              `${drizzleKitCommand} generate --config=${projectConfigPath}`,
              { stdio: 'inherit' }
            )
          }
          console.log(`${drizzleKitCommand} migrate --config=${projectConfigPath}`)
          execSync(`${drizzleKitCommand} migrate --config=${projectConfigPath}`, { stdio: 'inherit' })
        } catch (error) {
          console.error('[Seed Protocol] Error running Drizzle Kit commands:', error)
          throw error
        }
      }

      const runCommands = async () => {
        const tsxExists = commandExists('tsx')
        if (!tsxExists) {
          execSync(`npm install -g tsx`, {stdio: 'inherit'})
        }

        await updateSchema(drizzleDbConfigPath, appMetaDir!)
        const seedDataFilePath = path.join(__dirname, 'seedData.json')
        await seedDatabase(seedDataFilePath, dotSeedDir)
      }

      // Copy the schema files from src/seedSchema to .seed/schema
      copyDirectoryRecursively(
        path.join(pathResolver.getSdkRootDir(), 'src', 'seedSchema'),
        path.join(dotSeedDir, 'schema'),
      )

      // copyDirectoryRecursively(
      //   path.join(pathResolver.getSdkRootDir(), 'node', 'codegen'),
      //   path.join(dotSeedDir, 'codegen'),
      // )

      console.log('copying', configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

      fs.copyFileSync(configFilePath, path.join(dotSeedDir, 'seed.config.ts'))

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
  import.meta.url.endsWith('scripts/bin.ts') ||
  import.meta.url.endsWith('dist/bin.js')
) {
  // module was not imported but called directly
  init(a)
}

export { init }

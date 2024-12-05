#!/usr/bin/env node
import path from 'path'
import fs from 'fs'
import { exec as execSync } from 'child_process'
import { promisify } from 'util'
import { pathToFileURL } from 'url'
import process from 'node:process'
import { SCHEMA_TS } from '@/shared/helpers/constants'
import {
  appMetaDir,
  appSchemaDir,
  dotSeedDir,
  drizzleDbConfigPath,
  drizzleKitPath,
  rootWithNodeModules,
  sdkRootDir,
} from '@/node/constants'
import { createDrizzleSchemaFilesFromConfig } from '@/node/codegen'
import { rimrafSync } from 'rimraf'

const exec = promisify(execSync)

let a

a = process.argv.splice(2)

const init = (args: string[]) => {
  console.log('args:', args)

  if (args && args.length && args[0] === 'init') {
    console.log('[Seed Protocol] Running init script')

    let appFilesDirPath = args[2] || undefined

    let schemaFileDir = args[1] || rootWithNodeModules
    const schemaFilePath = path.join(schemaFileDir, SCHEMA_TS)

    // Remove dotSeedDir to start fresh each time
    if (fs.existsSync(dotSeedDir)) {
      fs.rmSync(dotSeedDir, { recursive: true })
    }

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

    const copyFiles = (srcDir, destDir) => {
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      const srcFiles = fs.readdirSync(srcDir)
      srcFiles.forEach((file) => {
        console.log(`Copying ${srcDir}/${file} to ${destDir}/${file}`)
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file))
      })
    }

    const copyDotSeedFilesToAppFiles = async (_appFilesDirPath: string) => {
      console.log('[Seed Protocol] Copying dot seed files to app files')
      return new Promise<void>((resolve) => {
        fs.promises.rm(_appFilesDirPath, { recursive: true }).then(() => {
          console.log(`[Seed Protocol] Removed old app files`)
          console.log(`[Seed Protocol] making dir at ${_appFilesDirPath}`)
          fs.mkdirSync(_appFilesDirPath, { recursive: true })
          console.log('[Seed Protocol] copying app files')
          fs.cpSync(dotSeedDir, _appFilesDirPath, { recursive: true })
          console.log(
            '[Seed Protocol] removing sqlite3 files and index.ts files',
          )
          rimrafSync(`${_appFilesDirPath}/**/*.sqlite3`, {
            glob: true,
          })
          rimrafSync(`${_appFilesDirPath}/**/index.ts`, {
            glob: true,
          })
          resolve()
        })
      })
    }

    const runCommand = async (command: string) => {
      const { stdout, stderr } = await exec(command)
      if (stderr) {
        console.error(stderr)
        return
      }
      console.log(stdout)
    }

    const updateSchema = async (pathToConfig: string, pathToMeta: string) => {
      if (!fs.existsSync(pathToMeta)) {
        await runCommand(
          `${drizzleKitCommand} generate --config=${pathToConfig}`,
        )
      }
      await runCommand(`${drizzleKitCommand} migrate --config=${pathToConfig}`)
    }

    const runCommands = async () => {
      await createDrizzleSchemaFilesFromConfig()
      ensureIndexExports(appSchemaDir)
      await updateSchema(drizzleDbConfigPath, appMetaDir)
    }

    copyFiles(
      path.join(sdkRootDir, 'shared', 'seedSchema'),
      path.join(dotSeedDir, 'schema'),
    )

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
        console.log('[Seed Protocol] Finished running init script')
      })
  }
}

const calledFrom = pathToFileURL(process.argv[1]).href

console.log('calledFrom:', calledFrom)

if (
  calledFrom.endsWith('node_modules/.bin/seed') ||
  import.meta.url.endsWith('@seedprotocol/sdk/node/bin.js') ||
  import.meta.url.endsWith('scripts/bin.ts')
) {
  // module was not imported but called directly
  init(a)
}

export { init }

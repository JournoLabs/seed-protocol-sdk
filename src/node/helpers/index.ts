import fs            from 'fs'
import * as tsImport from 'ts-import'
import { LoadMode }  from 'ts-import'
import path          from 'path'
import { glob }      from 'glob'
import { rimraf }    from 'rimraf'
import debug         from 'debug'

const logger = debug('seedSdk:helpers')

export const getTsImport = async <T>(filePath: string): Promise<T> => {
  // Check if the config file exists
  if (!fs.existsSync(filePath)) {
    logger(`Typescript file not found at ${filePath}`)
    throw new Error(`Typescript file not found at ${filePath}`)
  }

  let result

  try {
    // Read the file content and transform relative imports to absolute paths
    // This fixes the issue where ts-import compiles to .mjs in cache and relative
    // imports resolve from the cache location instead of the original file location
    let fileContent = fs.readFileSync(filePath, 'utf-8')
    const fileDir = path.dirname(path.resolve(filePath))
    
    // Replace relative imports with absolute paths
    // Match: from '../../../../src/schema' or from '../../../something'
    const relativeImportRegex = /from\s+['"](\.\.\/.*?)['"]/g
    fileContent = fileContent.replace(relativeImportRegex, (match, importPath) => {
      const absolutePath = path.resolve(fileDir, importPath)
      // Convert to file:// URL for ESM compatibility, or use absolute path
      return `from '${absolutePath}'`
    })

    // Write to a temporary file and load that instead
    const tempFile = path.join(fileDir, `.temp.${path.basename(filePath)}`)
    fs.writeFileSync(tempFile, fileContent)
    
    try {
      result = await tsImport.load(tempFile, {
        mode: LoadMode.Compile,
        compileOptions: {
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
          },
        },
      }).catch((e) => {
        logger('Error loading ts file:', e)
        throw e
      })
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }

  } catch ( e ) {
    console.error(e)
  }


  return result
}

export const deleteFilesWithExtension = async (
  dir: string,
  extension: string,
) => {
  const pattern = path.join(dir, `**/*${extension}`)
  glob(pattern, (err, files) => {
    if (err) {
      logger('Error finding files:', err)
      return
    }

    for (const file of files) {
      // TODO: Change this whole thing to be async?
      rimraf(file, (err) => {
        if (err) {
          logger('Error deleting file:', err)
        } else {
          logger(`Deleted: ${file}`)
        }
      })
    }
  })
}

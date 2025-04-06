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
    result = await tsImport.load(filePath, {
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

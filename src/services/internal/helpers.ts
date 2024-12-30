import { fs } from '@zenfs/core'
import path from 'path'
import { Endpoints } from '@/types'
import { BROWSER_FS_TOP_DIR } from '@/services/internal/constants'
import debug from 'debug'

const logger = debug('app:services:internal:helpers')

/**
 * Recursively create directories if they don't exist.
 * @param {string} dirPath - The directory path to create.
 */
export const createDirectories = async (dirPath: string) => {
  const dirPathExists = await fs.promises.exists(dirPath)
  if (dirPathExists) {
    return
  }

  const parentDir = path.dirname(dirPath)
  const parentDirExists = await fs.promises.exists(parentDir)
  if (!parentDirExists) {
    await createDirectories(parentDir)
  }

  await fs.promises.mkdir(dirPath, { recursive: true })
}

let busy = false

export const downloadFile = async (url: string, localFilePath: string) => {
  try {
    const response = await fetch(url)
    const fileData = await response.text().catch((error) => {
      console.error(`Failed to parse text from ${url}:`, error)
    })
    if (!fileData) {
      console.error(`No file data from ${url}`)
      return
    }
    const localDirPath = path.dirname(localFilePath)

    if (busy) {
      return
    }

    busy = true

    await createDirectories(localDirPath)

    const filename = path.basename(localFilePath)

    const regex = /(\d+)[\w_]+\.(sql|json)$/

    const match = filename.match(regex)

    let migrationNumber

    if (match && match.length > 1) {
      migrationNumber = match[1]
    }

    if (migrationNumber) {
      const filesInDir = await fs.promises.readdir(localDirPath)
      for (const file of filesInDir) {
        if (file === filename) {
          continue
        }
        const innerMatch = file.match(regex)
        let existingFileMigrationNumber
        if (innerMatch && innerMatch.length > 1) {
          existingFileMigrationNumber = innerMatch[1]
        }
        if (
          migrationNumber &&
          existingFileMigrationNumber &&
          existingFileMigrationNumber === migrationNumber
        ) {
          await fs.promises.unlink(path.join(localDirPath, file))
        }
      }
    }

    // if (filename === '_journal.json') {
    //   const exists = await fs.promises.exists(localFilePath)
    //   if (exists) {
    //     await fs.promises.rm(localFilePath)
    //   }
    //   await fs.promises.writeFile(localFilePath, fileData)
    // }
    //
    // if (filename !== '_journal.json') {
    //   await fs.promises.writeFile(localFilePath, fileData)
    // }
    await fs.promises.writeFile(localFilePath, fileData)
  } catch (error) {
    if (JSON.stringify(error).includes('File exists')) {
      const fileData = await fs.promises.readFile(localFilePath, 'utf-8')
    }
    logger(`[Error] Failed to download file from ${url}:`, error)
  }

  busy = false
}

export const fetchDirectory = async (url: string) => {
  const response = await fetch(url)
  return response.json()
}

export const fetchFilesRecursively = async (
  url: string,
  localPath: string,
  fileList: string[],
) => {
  try {
    for (const file of fileList) {
      const fileUrl = `${url}/${file}`
      const fileLocalPath = path.join(localPath, file)

      // logger(`[fetchFilesRecursively] fileUrl: ${fileUrl}`)
      // logger(`[fetchFilesRecursively] fileLocalPath: ${fileLocalPath}`)

      await downloadFile(fileUrl, fileLocalPath)
    }
  } catch (error) {
    console.error(`Failed to fetch files from ${url}:`, error)
  }
}

export const confirmFilesExist = async (filePaths: string[]) => {
  let everythingDownloaded = false

  for (const filePath of filePaths) {
    const fullPath = path.join(BROWSER_FS_TOP_DIR, filePath)
    everythingDownloaded = await fs.promises.exists(fullPath)
  }

  if (!everythingDownloaded) {
    setTimeout(async () => {
      await confirmFilesExist(filePaths)
    }, 500)
  }
}

const filesToExclude = ['.DS_Store']

export const syncDbFiles = async ({ filePaths, files }: Endpoints) => {
  let fileList = await fetchDirectory(filePaths)
  fileList = fileList.filter((file: string) => !filesToExclude.includes(file))
  await fetchFilesRecursively(files, BROWSER_FS_TOP_DIR, fileList)
  await confirmFilesExist(fileList)
  logger('[syncDbFiles] Files synced!')
}

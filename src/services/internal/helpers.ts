import fs from '@zenfs/core'
import path from 'path'
import { Endpoints } from '@/types'
import { BROWSER_FS_TOP_DIR } from '@/services/internal/constants'
import debug from 'debug'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

const logger = debug('app:services:internal:helpers')

/**
 * Recursively create directories if they don't exist.
 * @param {string} dirPath - The directory path to create.
 */
export const createDirectories = async (dirPath: string) => {
  const dirPathExists = await BaseFileManager.pathExists(dirPath)
  if (dirPathExists) {
    return
  }

  const parentDir = path.dirname(dirPath)
  let parentDirExists = await BaseFileManager.pathExists(parentDir)
  if (!parentDirExists) {
    await createDirectories(parentDir)
  }

  parentDirExists = await BaseFileManager.pathExists(parentDir)
  if (parentDirExists) {
    await BaseFileManager.createDirIfNotExists(dirPath)
  }
}

// export const downloadFile = async (url: string, localFilePath: string) => {
//   try {
//     const response = await fetch(url)
//     const fileData = await response.text().catch((error) => {
//       console.error(`Failed to parse text from ${url}:`, error)
//     })
//     if (!fileData) {
//       console.error(`No file data from ${url}`)
//       return
//     }
//     const localDirPath = path.dirname(localFilePath)

//     if (busy) {
//       return
//     }

//     busy = true

//     await createDirectories(localDirPath)

//     const filename = path.basename(localFilePath)

//     const regex = /(\d+)[\w_]+\.(sql|json)$/

//     const match = filename.match(regex)

//     let migrationNumber

//     if (match && match.length > 1) {
//       migrationNumber = match[1]
//     }

//     if (migrationNumber) {
//       const filesInDir = await fs.promises.readdir(localDirPath)
//       for (const file of filesInDir) {
//         if (file === filename) {
//           continue
//         }
//         const innerMatch = file.match(regex)
//         let existingFileMigrationNumber
//         if (innerMatch && innerMatch.length > 1) {
//           existingFileMigrationNumber = innerMatch[1]
//         }
//         if (
//           migrationNumber &&
//           existingFileMigrationNumber &&
//           existingFileMigrationNumber === migrationNumber
//         ) {
//           await fs.promises.unlink(path.join(localDirPath, file))
//         }
//       }
//     }

//     try {

//       await fs.promises.writeFile(localFilePath, fileData)
//       logger(`[downloadFile] Wrote file async to ${localFilePath}`)
//     } catch (error) {
//       fs.writeFileSync(localFilePath, fileData)
//       logger(`[downloadFile] Wrote file sync to ${localFilePath}`)
//     }
//   } catch (error) {
//     logger(`[Error] Failed to download file from ${url}:`, error)
//   }

//   busy = false
// }

type DownloadFunction = (fileUrl: string) => Promise<void>;

class FileDownloadManager {
    private filesToDownload: Map<string, number>;
    private maxRetries: number;
    private isDownloading: boolean = false;

    constructor(fileUrls: string[], maxRetries: number) {
        this.filesToDownload = new Map(fileUrls.map(url => [url, 0]));
        this.maxRetries = maxRetries;
    }

    async downloadFile(url: string, localFilePath: string): Promise<void> {
      const response = await fetch(url)
      const fileData = await response.text().catch((error) => {
        console.error(`Failed to parse text from ${url}:`, error)
      })
      if (!fileData) {
        console.error(`No file data from ${url}`)
        return
      }
      const localDirPath = path.dirname(localFilePath)
  
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
  
      try {
  
        await fs.promises.writeFile(localFilePath, fileData)
        logger(`[downloadFile] Wrote file async to ${localFilePath}`)
      } catch (error) {
        fs.writeFileSync(localFilePath, fileData)
        logger(`[downloadFile] Wrote file sync to ${localFilePath}`)
      }
     
    }

    async start(): Promise<void> {
        if (this.isDownloading) {
            console.warn("Download process is already running.");
            return;
        }

        this.isDownloading = true;

        for (const [fileUrl, attempts] of this.filesToDownload.entries()) {
            let success = false;

            while (attempts < this.maxRetries) {
                try {
                    console.log(`Starting download: ${fileUrl}`);
                    await this.downloadFile(fileUrl, fileUrl);
                    console.log(`Download successful: ${fileUrl}`);
                    this.filesToDownload.delete(fileUrl);
                    success = true;
                    break; // Move to next file
                } catch (error) {
                    console.error(`Error downloading ${fileUrl}:`, error);
                    this.filesToDownload.set(fileUrl, attempts + 1);
                }
            }

            if (!success) {
                console.error(`Failed to download after ${this.maxRetries} attempts: ${fileUrl}`);
            }
        }

        this.isDownloading = false;
        console.log("All downloads completed.");
    }

    addFile(fileUrl: string): void {
        if (!this.filesToDownload.has(fileUrl)) {
            this.filesToDownload.set(fileUrl, 0);
            console.log(`Added file to download queue: ${fileUrl}`);
        } else {
            console.warn(`File already in queue: ${fileUrl}`);
        }
    }

    getPendingFiles(): string[] {
        return Array.from(this.filesToDownload.keys());
    }

    clear(): void {
        this.filesToDownload.clear();
        console.log("Cleared all files from the download queue.");
    }
}


export const fetchDirectory = async (url: string) => {
  const response = await fetch(url)
  return response.json()
}

// export const fetchFilesRecursively = async (
//   url: string,
//   localPath: string,
//   fileList: string[],
// ) => {
//   for (const file of fileList) {
//     try {
//       const fileUrl = `${url}/${file}`
//       const fileLocalPath = path.join(localPath, file)

//       // logger(`[fetchFilesRecursively] fileUrl: ${fileUrl}`)
//       // logger(`[fetchFilesRecursively] fileLocalPath: ${fileLocalPath}`)

//       await downloadFile(fileUrl, fileLocalPath)
//     } catch (error) {
//       console.error(`Failed to fetch files from ${url}:`, error)
//     }
//   }
// }

export const confirmFilesExist = async (filePaths: string[]) => {
  let everythingDownloaded = false

  for (const filePath of filePaths) {
    everythingDownloaded = await fs.promises.exists(filePath)
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
  fileList = fileList.map((file: string) => `${files}/${file}`)
  const downloadManager = new FileDownloadManager(fileList, 5)
  await downloadManager.start()
  // await fetchFilesRecursively(files, BROWSER_FS_TOP_DIR, fileList)
  await confirmFilesExist(fileList)
  logger('[syncDbFiles] Files synced!')
}

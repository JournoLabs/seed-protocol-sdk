import { BaseFileManager }     from '@/helpers/FileManager/BaseFileManager'
import { FileDownloader }      from '../workers/FileDownloader'
import { ImageResizer }        from '../workers/ImageResizer'
import debug from 'debug'
import path                    from 'path-browserify'

const logger = debug('seedSdk:browser:helpers:FileManager')

class FileManager extends BaseFileManager {
  private static zenfsCache: any = null

  static async getFs() {
    if (!this.zenfsCache) {
      this.zenfsCache = await import('@zenfs/core')
    }
    return this.zenfsCache
  }

  static getFsSync() {
    if (!this.zenfsCache) {
      throw new Error('File system not initialized. Call getFs() or initializeFileSystem() first.')
    }
    return this.zenfsCache
  }

  static async getContentUrlFromPath( path: string ): Promise<string | undefined> {

    const fileExists = await this.pathExists(path)
    if ( fileExists ) {
      const file = await this.readFile(path)
      return URL.createObjectURL(file)
    }
  }

  static async initializeFileSystem(workingDir?: string): Promise<void> {

    const zenfs = await this.getFs()
    const {WebAccess} = await import('@zenfs/dom')
    const {configureSingle} = zenfs

    const handle = await navigator.storage.getDirectory()
    // await configure({
    //   mounts: {
    //     '/': {
    //       backend: WebAccess,
    //       handle,
    //     },
    //   },
    //   disableUpdateOnRead: true,
    //   onlySyncOnClose: true,
    // })
    await configureSingle({
      backend: WebAccess,
      handle,
    })
    // Cache is already set in getFs(), so no need to set it again
  }

  static async downloadAllFiles( {
                                   transactionIds,
                                   arweaveHost,
                                   excludedTransactions,
                                 }: DownloadAllFilesParams ): Promise<void> {
    const fileDownloader = new FileDownloader()
    await fileDownloader.downloadAll({ transactionIds, arweaveHost, excludedTransactions })
  }

  static async resizeImage( { filePath, width, height }: ResizeImageParams ): Promise<void> {
    const imageResizer = new ImageResizer()
    await imageResizer.resize({ filePath, width, height })
  }

  static async resizeAllImages( { width, height }: ResizeAllImagesParams ): Promise<void> {
    const imageResizer = new ImageResizer()
    await imageResizer.resizeAll({ width, height })
  }

  static async pathExists(filePath: string): Promise<boolean> {
    try {
      const zenfs = await this.getFs()
      await zenfs.promises.access(filePath, zenfs.constants.F_OK)
      return true
    } catch (error: any) {
      // ENOENT means the file doesn't exist, which is expected
      if (error?.code === 'ENOENT' || error?.errno === -2) {
        return false
      }
      // For other errors, re-throw them
      throw error
    }
  }

  static async createDirIfNotExists(filePath: string): Promise<void> {
    if (!(await this.pathExists(filePath))) {
      try {
        const zenfs = await this.getFs()
        await zenfs.promises.mkdir(filePath)
      } catch (error) {
        // This is a no-op. We tried to create a directory that already exists.
        logger('Attempted to create a directory that already exists')
      }
    }
  }

  /**
   * Waits for a file to exist at the specified path.
   * @param {string} filePath - The path of the file to check.
   * @param {number} interval - The interval in milliseconds between checks (default: 500ms).
   * @param {number} timeout - The timeout in milliseconds to wait for the file to exist (default: 10s).
   * @returns {Promise<boolean>} - Resolves to true if the file exists within the timeout period, otherwise false.
   */
  static async waitForFile(filePath: string, interval: number = 1000, timeout: number = 60000): Promise<boolean> {

    // const fs = await this.getFs()
    // const fsNode = await import('node:fs')
    const pathExists = await this.pathExists(filePath)

    if (pathExists) {
      return true
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now()

      let isBusy = false

      const cancelableInterval = new CancelableInterval(async (stop) => {
        logger('waitForFile', filePath)
        if (isBusy) {
          return
        }
        isBusy = true
        // // TODO: Needs to read from OPFS
        // const exists = await BaseFileManager.pathExists(filePath)
        // if (exists) {
        //   stop()
        //   resolve(true)
        // }

        const pathExists = await this.pathExists(filePath)
        if (pathExists) {
          stop()
          resolve(true)
        }

        if (Date.now() - startTime >= timeout) {
          stop()
          reject(new Error('Timeout exceeded while waiting for file'))
        }
        isBusy = false
      }, interval)

      cancelableInterval.start()
  
      // const _interval = setInterval(async () => {
      //   logger('waitForFile', filePath)
      //   if (isBusy) {
      //     return
      //   }
      //   isBusy = true
      //   // TODO: Needs to read from OPFS
      //   if (fs.existsSync(filePath) && fsNode.existsSync(filePath)) {
      //     clearInterval(_interval)
      //     resolve(true)
      //   }

      //   const pathExists = await this.pathExists(filePath)
      //   if (pathExists) {
      //     clearInterval(_interval)
      //     resolve(true)
      //   }

      //   if (Date.now() - startTime >= timeout) {
      //     clearInterval(_interval)
      //     reject(new Error('Timeout exceeded while waiting for file'))
      //   }
      //   isBusy = false
      // }, interval)
  
      // retry(
      //   {
      //     times: Math.ceil(timeout / interval),
      //     interval: interval,
      //   },
      //   (callback: Function) => {
      //     if (fs.existsSync(filePath) && fsNode.existsSync(filePath)) {
      //       return callback(null, true) // File exists, finish with success
      //     }
      //     if (Date.now() - startTime >= timeout) {
      //       return callback(new Error('Timeout exceeded while waiting for file'))
      //     }
      //     callback(new Error('File does not exist yet')) // Retry with this error
      //   },
      //   (err: Error, result: boolean) => {
      //     if (err) {
      //       return resolve(false) // Resolve as false if timeout or error occurs
      //     }
      //     resolve(result) // Resolve as true if file exists
      //   },
      // )
    })
  }

  /**
   * Waits for a file to exist and have content (non-zero size).
   * This is important for browser/OPFS where writes may not be immediately readable.
   * @param {string} filePath - The path of the file to check.
   * @param {number} interval - The interval in milliseconds between checks (default: 100ms).
   * @param {number} timeout - The timeout in milliseconds to wait (default: 5s).
   * @returns {Promise<boolean>} - Resolves to true if the file exists with content within the timeout period.
   */
  static async waitForFileWithContent(filePath: string, interval: number = 100, timeout: number = 5000): Promise<boolean> {
    // First wait for file to exist
    await this.waitForFile(filePath, interval, timeout)

    // Now wait for file to have content
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      let isBusy = false

      const cancelableInterval = new CancelableInterval(async (stop) => {
        logger('waitForFileWithContent', filePath)
        if (isBusy) {
          return
        }
        isBusy = true

        try {
          // Try to read the file to check if it has content
          const file = await this.readFile(filePath)
          if (file.size > 0) {
            stop()
            resolve(true)
            return
          }
          // File exists but is 0 bytes, continue waiting
        } catch (error: any) {
          // If error is about file being 0 bytes, not readable, or I/O error, continue waiting
          const errorMessage = error?.message || String(error)
          if (
            errorMessage.includes('0 bytes') || 
            errorMessage.includes('ENOENT') || 
            errorMessage.includes('EIO') ||
            errorMessage.includes('Input/output error')
          ) {
            // Continue waiting - file write may still be in progress
          } else {
            // Other errors should be thrown
            stop()
            reject(error)
            return
          }
        }

        if (Date.now() - startTime >= timeout) {
          stop()
          reject(new Error(`Timeout exceeded while waiting for file ${filePath} to have content`))
          return
        }
        isBusy = false
      }, interval)

      cancelableInterval.start()
    })
  }

  static async saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    const zenfs = await this.getFs()
    
    // Convert content to a format that zenfs.writeFile accepts
    let writeContent: string | Uint8Array
    if (typeof content === 'string') {
      writeContent = content
    } else if (content instanceof Blob) {
      const arrayBuffer = await content.arrayBuffer()
      writeContent = new Uint8Array(arrayBuffer)
    } else if (content instanceof ArrayBuffer) {
      writeContent = new Uint8Array(content)
    } else {
      throw new Error('Unsupported content type')
    }
    
    await zenfs.writeFile(filePath, writeContent)
    // try {
    //   // Get a handle to the OPFS root directory
    //   const root = await navigator.storage.getDirectory();
      
    //   // Split the file path into directory and file name
    //   const pathParts = filePath.split('/');
    //   const fileName = pathParts.pop();
    //   if (!fileName) throw new Error('Invalid file path');

    //   // Traverse directories and create them if they don't exist
    //   let currentDir = root;
    //   for (const part of pathParts) {
    //     if (part !== '') {
    //       currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    //     }
    //   }

    //   // Get the file handle and create the file if it doesn't exist
    //   const fileHandle = await currentDir.getFileHandle(fileName, { create: true });

    //   // Create a writable stream and write the content
    //   const writable = await fileHandle.createWritable();
      
    //   if (typeof content === 'string' || content instanceof Uint8Array) {
    //       await writable.write(content);
    //   } else if (content instanceof Blob) {
    //       await writable.write(content);
    //   } else if (content instanceof ArrayBuffer) {
    //       await writable.write(new Blob([content]));
    //   } else {
    //       throw new Error('Unsupported content type');
    //   }

    //   await writable.close();
    //   logger(`File written successfully: ${filePath}`);
    // } catch (error) {
    //     console.error(`Error writing to OPFS: ${error.message}`);
    // }
  }

  static saveFileSync(filePath: string, content: string | Blob | ArrayBuffer): void {
    // Note: This is a synchronous wrapper, but zenfs operations may still be async under the hood
    // For true sync operations in browser, we'd need to use OPFS sync access handles
    // For now, we'll use zenfs.writeFileSync which should be available
    const zenfs = this.getFsSync()
    
    // Convert content to a format that zenfs.writeFileSync accepts
    let writeContent: string | Uint8Array
    if (typeof content === 'string') {
      writeContent = content
    } else if (content instanceof Blob) {
      // Blob cannot be converted synchronously - throw error
      throw new Error('Blob content not supported in saveFileSync. Use saveFile() instead or convert to ArrayBuffer first.')
    } else if (content instanceof ArrayBuffer) {
      writeContent = new Uint8Array(content)
    } else {
      throw new Error('Unsupported content type')
    }
    
    zenfs.writeFileSync(filePath, writeContent)
  }

  static async readFile(filePath: string): Promise<File> {
    const zenfs = await this.getFs()
    const file = await zenfs.promises.readFile(filePath)
    return new File([new Uint8Array(file)], filePath)
    // try {
    //   // Get a handle to the OPFS root directory
    //   const root = await navigator.storage.getDirectory();
      
    //    // Split the file path into directory and file name
    //    const pathParts = filePath.split('/');
    //    const fileName = pathParts.pop();
    //    if (!fileName) throw new Error('Invalid file path');
 
    //    // Traverse directories to reach the target file
    //    let currentDir = root;
    //    for (const part of pathParts) {
    //      if (part !== '') {
    //        currentDir = await currentDir.getDirectoryHandle(part, { create: false });
    //      }
    //    }
 
    //    // Get the file handle
    //    const fileHandle = await currentDir.getFileHandle(fileName, { create: false });
 
    //    // Get the file and read it as an ArrayBuffer
    //    return await fileHandle.getFile();
    // } catch (error) {
    //   console.error(`Error reading from OPFS: ${error.message}`);
    //   throw error;
    // }
  }

  static readFileSync(filePath: string): File {
    // Note: This is a synchronous wrapper, but zenfs operations may still be async under the hood
    // For true sync operations in browser, we'd need to use OPFS sync access handles
    // For now, we'll use zenfs.readFileSync which should be available
    const zenfs = this.getFsSync()
    const file = zenfs.readFileSync(filePath)
    return new File([new Uint8Array(file)], filePath)
  }

  static async readFileAsBuffer(filePath: string): Promise<Blob> {
    try {

      // Get the file and read it as an ArrayBuffer
      const file = await this.readFile(filePath)
      const arrayBuffer = await file.arrayBuffer();

      // Convert ArrayBuffer to Blob
      return new Blob([arrayBuffer]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`Error reading from OPFS: ${errorMessage}`);
      throw error;
    }
  }

  static async readFileAsString(filePath: string): Promise<string> {
    const blob = await this.readFileAsBuffer(filePath)
    return blob.text()
  }

  static getParentDirPath(filePath: string): string {
    return path.dirname(filePath)
  }

  static getFilenameFromPath(filePath: string): string {
    return path.basename(filePath)
  }

  static getPathModule(): any {
    return path
  }
}

type AsyncTask = (stop: () => void) => Promise<void>


class CancelableInterval {
    private intervalId: number | null = null;
    private currentTaskAbortController: AbortController | null = null;

    constructor(private task: AsyncTask, private interval: number) {}

    start() {
        this.intervalId = window.setInterval(async () => {
            if (this.currentTaskAbortController) {
                // Cancel the previous running task
                this.currentTaskAbortController.abort();
            }

            // Create a new abort controller for the current task
            this.currentTaskAbortController = new AbortController();
            const signal = this.currentTaskAbortController.signal;

            try {
                await this.taskWithCancellation(signal);
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                  logger('Previous task was canceled.');
                } else {
                  console.error('Task error:', error);
                }
                this.stop()
            }
        }, this.interval);
    }

    private async taskWithCancellation(signal: AbortSignal) {
      await this.task(() => this.stop())
      if (signal.aborted) {
          throw new DOMException('Task was aborted', 'AbortError');
      }
    }

    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.currentTaskAbortController) {
            this.currentTaskAbortController.abort();
        }
    }
}


export { FileManager }

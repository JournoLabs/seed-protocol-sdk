import { BaseFileManager }     from '@/helpers/FileManager/BaseFileManager'
import { FileDownloader }      from '../workers/FileDownloader'
import { ImageResizer }        from '../workers/ImageResizer'
import debug from 'debug'
import path                    from 'path-browserify'

const logger = debug('seedSdk:browser:helpers:FileManager')

class FileManager extends BaseFileManager {

  static async getFs() {
    const fs = await import('@zenfs/core')
    return fs
  }

  static async getContentUrlFromPath( path: string ): Promise<string | undefined> {

    const fileExists = await this.pathExists(path)
    if ( fileExists ) {
      const file = await this.readFile(path)
      return URL.createObjectURL(file)
    }
  }

  static async initializeFileSystem(): Promise<void> {

    const fs = await this.getFs()
    const {WebAccess} = await import('@zenfs/dom')
    const {configureSingle} = fs

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
      // Access the root directory of OPFS
      const root = await navigator.storage.getDirectory();
      
      // Split the path into segments
      const parts = filePath.split('/').filter(Boolean);
      let currentDir = root;

      // Traverse each part of the path
      for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          try {
              const handle = await currentDir.getDirectoryHandle(part, { create: false });
              currentDir = handle; // Move into the directory
          } catch (error) {
              try {
                  // If it's not a directory, check if it's a file
                  await currentDir.getFileHandle(part, { create: false });
                  // If we successfully got a file handle and it's the last part, return true
                  return i === parts.length - 1;
              } catch {
                  // Neither a directory nor a file exists
                  return false;
              }
          }
      }

      return true; // Directory exists
  } catch (error) {
      return false; // Any error means the path does not exist
  }
  }

  static async createDirIfNotExists(filePath: string): Promise<void> {
    if (!(await this.pathExists(filePath))) {
      try {
        const fs = await this.getFs()
        await fs.promises.mkdir(filePath)
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

  static async saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    try {
      // Get a handle to the OPFS root directory
      const root = await navigator.storage.getDirectory();
      
      // Split the file path into directory and file name
      const pathParts = filePath.split('/');
      const fileName = pathParts.pop();
      if (!fileName) throw new Error('Invalid file path');

      // Traverse directories and create them if they don't exist
      let currentDir = root;
      for (const part of pathParts) {
        if (part !== '') {
          currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }
      }

      // Get the file handle and create the file if it doesn't exist
      const fileHandle = await currentDir.getFileHandle(fileName, { create: true });

      // Create a writable stream and write the content
      const writable = await fileHandle.createWritable();
      
      if (typeof content === 'string' || content instanceof Uint8Array) {
          await writable.write(content);
      } else if (content instanceof Blob) {
          await writable.write(content);
      } else if (content instanceof ArrayBuffer) {
          await writable.write(new Blob([content]));
      } else {
          throw new Error('Unsupported content type');
      }

      await writable.close();
      logger(`File written successfully: ${filePath}`);
  } catch (error) {
      console.error(`Error writing to OPFS: ${error.message}`);
  }
  }

  static async readFile(filePath: string): Promise<File> {
    try {
      // Get a handle to the OPFS root directory
      const root = await navigator.storage.getDirectory();
      
       // Split the file path into directory and file name
       const pathParts = filePath.split('/');
       const fileName = pathParts.pop();
       if (!fileName) throw new Error('Invalid file path');
 
       // Traverse directories to reach the target file
       let currentDir = root;
       for (const part of pathParts) {
         if (part !== '') {
           currentDir = await currentDir.getDirectoryHandle(part, { create: false });
         }
       }
 
       // Get the file handle
       const fileHandle = await currentDir.getFileHandle(fileName, { create: false });
 
       // Get the file and read it as an ArrayBuffer
       return await fileHandle.getFile();
    } catch (error) {
      console.error(`Error reading from OPFS: ${error.message}`);
      throw error;
    }
  }

  static async readFileAsBuffer(filePath: string): Promise<Blob> {
    try {

      // Get the file and read it as an ArrayBuffer
      const file = await this.readFile(filePath)
      const arrayBuffer = await file.arrayBuffer();

      // Convert ArrayBuffer to Blob
      return new Blob([arrayBuffer]);
    } catch (error) {
      console.error(`Error reading from OPFS: ${error.message}`);
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

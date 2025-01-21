import { fs } from '@zenfs/core'
import * as fsNode from 'node:fs'
// import * as retry from 'async-es/retry'

export const listFilesInOPFSRoot = async () => {
  // Get the root directory handle
  const rootDirHandle = await navigator.storage.getDirectory()

  // Initialize an array to hold the file names
  let fileNames = []

  // Create an async iterator to loop through directory entries
  for await (const entry of rootDirHandle.values()) {
    if (entry.kind === 'file') {
      fileNames.push(entry.name)
    }
  }

  return fileNames
}

/**
 * Waits for a file to exist at the specified path.
 * @param {string} filePath - The path of the file to check.
 * @param {number} interval - The interval in milliseconds between checks (default: 500ms).
 * @param {number} timeout - The timeout in milliseconds to wait for the file to exist (default: 10s).
 * @returns {Promise<boolean>} - Resolves to true if the file exists within the timeout period, otherwise false.
 */
export const waitForFile = (
  filePath: string,
  interval: number = 500,
  timeout: number = 10000,
): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    const _interval = setInterval(() => {
      if (fs.existsSync(filePath) && fsNode.existsSync(filePath)) {
        clearInterval(_interval)
        resolve(true)
      }
      if (Date.now() - startTime >= timeout) {
        clearInterval(_interval)
        reject(new Error('Timeout exceeded while waiting for file'))
      }
    }, interval)

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

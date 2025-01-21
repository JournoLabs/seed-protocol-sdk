import { isBrowser } from '../environment'
import { BaseFileManager } from './BaseFileManager'

let FileManager: typeof BaseFileManager | undefined

export const initFileManager = async () => {
  if (isBrowser()) {
    FileManager = (await import('../../browser/helpers/FileManager')).FileManager
  }

  if (!isBrowser()) {
    FileManager = (await import('../../node/helpers/FileManager')).FileManager
  }
}

export { FileManager }
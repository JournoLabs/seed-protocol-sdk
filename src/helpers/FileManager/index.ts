import { BaseFileManager } from './BaseFileManager'

let FileManager: typeof BaseFileManager | undefined

export const initFileManager = async () => {
  if (typeof window !== 'undefined') {
    FileManager = (await import('../../browser/helpers/FileManager')).FileManager
  } else {
    FileManager = (await import('../../node/helpers/FileManager')).FileManager
  }
}

export { FileManager }
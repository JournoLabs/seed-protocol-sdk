import * as fsAsync        from 'fs/promises'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import path                from 'path'

class FileManager extends BaseFileManager {

  static async getContentUrlFromPath( path: string ): Promise<string | undefined> {
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async initializeFileSystem(): Promise<void> {
    return // No need to initialize file system in node
  }

  static async downloadAllFiles(): Promise<void> {
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async resizeImage(): Promise<void> {
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async resizeAllImages(): Promise<void> {
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async pathExists(filePath: string): Promise<boolean> {
    return await fsAsync.access(filePath).then(() => true).catch(() => false)
  }

  static async createDirIfNotExists(filePath: string): Promise<void> {
    await fsAsync.mkdir(filePath, { recursive: true })
  }

  static async readFileAsBuffer( filePath: string ): Promise<Buffer> {
    return await fsAsync.readFile(filePath)
  }

  static async readFile(filePath: string): Promise<File> {
    return new File([await fsAsync.readFile(filePath)], filePath)
  }

  static getParentDirPath(filePath: string): string {
    return path.dirname(filePath)
  }

  static getFilenameFromPath(filePath: string): string {
    return path.basename(filePath)
  }

}

export { FileManager }


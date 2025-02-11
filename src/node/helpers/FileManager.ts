import * as fsAsync        from 'fs/promises'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

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
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async createDirIfNotExists(filePath: string): Promise<void> {
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async readFileAsBuffer( filePath: string ): Promise<Buffer> {
    return await fsAsync.readFile(filePath)
  }

  static async readFile(filePath: string): Promise<File> {
    return new File([await fsAsync.readFile(filePath)], filePath)
  }

}

BaseFileManager.setPlatformClass(FileManager)

export { FileManager }


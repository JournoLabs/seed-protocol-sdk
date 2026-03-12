import * as fsAsync        from 'fs/promises'
import * as fs             from 'fs'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import path                from 'path'

class FileManager extends BaseFileManager {

  static async getFs() {
    return fs
  }

  static getFsSync() {
    return fs
  }

  static async getContentUrlFromPath( path: string ): Promise<string | undefined> {
    return new Promise(( resolve, reject ) => {
      reject(new Error('Not implemented'))
    })
  }

  static async initializeFileSystem(workingDir?: string): Promise<void> {
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

  static async listImageFiles(): Promise<string[]> {
    return this.listFiles('images')
  }

  static async listFiles(dir: string): Promise<string[]> {
    const targetDir = BaseFileManager.getFilesPath(dir)
    const exists = await this.pathExists(targetDir)
    if (!exists) {
      return []
    }
    const entries = await fsAsync.readdir(targetDir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  }

  static async createDirIfNotExists(filePath: string): Promise<void> {
    await fsAsync.mkdir(filePath, { recursive: true })
  }

  static async waitForFile(filePath: string, interval: number = 1000, timeout: number = 60000): Promise<boolean> {
    // Check if file exists immediately
    const pathExists = await this.pathExists(filePath)
    if (pathExists) {
      return true
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      let isBusy = false

      const checkInterval = setInterval(async () => {
        if (isBusy) {
          return
        }
        isBusy = true

        try {
          const exists = await this.pathExists(filePath)
          if (exists) {
            clearInterval(checkInterval)
            resolve(true)
            return
          }

          if (Date.now() - startTime >= timeout) {
            clearInterval(checkInterval)
            reject(new Error('Timeout exceeded while waiting for file'))
            return
          }
        } catch (error) {
          clearInterval(checkInterval)
          reject(error)
          return
        } finally {
          isBusy = false
        }
      }, interval)
    })
  }

  static async waitForFileWithContent(filePath: string, interval: number = 100, timeout: number = 5000): Promise<boolean> {
    // In node, file writes are synchronous, so if the file exists, it has content
    // Just wait for the file to exist
    return this.waitForFile(filePath, interval, timeout)
  }

  static async saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    // Ensure the directory exists
    const dir = path.dirname(filePath)
    await fsAsync.mkdir(dir, { recursive: true })

    // Write the content based on type
    if (typeof content === 'string') {
      await fsAsync.writeFile(filePath, content, 'utf-8')
    } else if (content instanceof Blob) {
      const arrayBuffer = await content.arrayBuffer()
      await fsAsync.writeFile(filePath, Buffer.from(arrayBuffer))
    } else if (content instanceof ArrayBuffer) {
      await fsAsync.writeFile(filePath, Buffer.from(content))
    } else {
      throw new Error('Unsupported content type')
    }
  }

  static saveFileSync(filePath: string, content: string | Blob | ArrayBuffer): void {
    // Ensure the directory exists
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write the content based on type
    if (typeof content === 'string') {
      fs.writeFileSync(filePath, content, 'utf-8')
    } else if (content instanceof Blob) {
      // For Blob, we need to convert to Buffer synchronously
      // This is a limitation - we can't do this truly synchronously
      // But we can read it as ArrayBuffer if it's already available
      throw new Error('Blob content not supported in saveFileSync. Use saveFile() instead or convert to ArrayBuffer first.')
    } else if (content instanceof ArrayBuffer) {
      fs.writeFileSync(filePath, Buffer.from(content))
    } else {
      throw new Error('Unsupported content type')
    }
  }

  static async readFileAsBuffer( filePath: string ): Promise<Buffer> {
    return await fsAsync.readFile(filePath)
  }

  static async readFileAsString(filePath: string): Promise<string> {
    return await fsAsync.readFile(filePath, 'utf-8')
  }

  static async readFile(filePath: string): Promise<File> {
    return new File([await fsAsync.readFile(filePath)], filePath)
  }

  static readFileSync(filePath: string): File {
    return new File([fs.readFileSync(filePath)], filePath)
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

export { FileManager }


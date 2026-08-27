import * as fsAsync from 'fs/promises'
import * as fs from 'fs'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import type { IFileManager } from '@/helpers/FileManager/IFileManager'
import path from 'path'

export class NodeFileManager implements IFileManager {
  async getFs() {
    return fs
  }

  getFsSync() {
    return fs
  }

  async getContentUrlFromPath(_path: string): Promise<string | undefined> {
    throw new Error('Not implemented')
  }

  async initializeFileSystem(_workingDir?: string): Promise<void> {
    return // No need to initialize file system in node
  }

  async downloadAllFiles(): Promise<void> {
    throw new Error('Not implemented')
  }

  async resizeImage(): Promise<void> {
    throw new Error('Not implemented')
  }

  async resizeAllImages(): Promise<void> {
    throw new Error('Not implemented')
  }

  async pathExists(filePath: string): Promise<boolean> {
    return await fsAsync.access(filePath).then(() => true).catch(() => false)
  }

  async listImageFiles(): Promise<string[]> {
    return this.listFiles('images')
  }

  async listFiles(dir: string): Promise<string[]> {
    const targetDir = BaseFileManager.getFilesPath(dir)
    const exists = await this.pathExists(targetDir)
    if (!exists) {
      return []
    }
    const entries = await fsAsync.readdir(targetDir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  }

  async createDirIfNotExists(filePath: string): Promise<void> {
    await fsAsync.mkdir(filePath, { recursive: true })
  }

  async waitForFile(filePath: string, interval: number = 1000, timeout: number = 60000): Promise<boolean> {
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

  async waitForFileWithContent(filePath: string, interval: number = 100, timeout: number = 5000): Promise<boolean> {
    return this.waitForFile(filePath, interval, timeout)
  }

  async saveFile(filePath: string, content: string | Blob | ArrayBuffer): Promise<void> {
    const dir = path.dirname(filePath)
    await fsAsync.mkdir(dir, { recursive: true })

    if (typeof content === 'string') {
      await fsAsync.writeFile(filePath, content, 'utf-8')
    } else if (content instanceof Blob) {
      const arrayBuffer = await content.arrayBuffer()
      await fsAsync.writeFile(filePath, new Uint8Array(arrayBuffer))
    } else if (content instanceof ArrayBuffer) {
      await fsAsync.writeFile(filePath, new Uint8Array(content))
    } else {
      throw new Error('Unsupported content type')
    }
  }

  saveFileSync(filePath: string, content: string | Blob | ArrayBuffer): void {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (typeof content === 'string') {
      fs.writeFileSync(filePath, content, 'utf-8')
    } else if (content instanceof Blob) {
      throw new Error('Blob content not supported in saveFileSync. Use saveFile() instead or convert to ArrayBuffer first.')
    } else if (content instanceof ArrayBuffer) {
      fs.writeFileSync(filePath, new Uint8Array(content))
    } else {
      throw new Error('Unsupported content type')
    }
  }

  async readFileAsBuffer(filePath: string): Promise<Buffer> {
    return await fsAsync.readFile(filePath)
  }

  async readFileAsString(filePath: string): Promise<string> {
    return await fsAsync.readFile(filePath, 'utf-8')
  }

  async readFile(filePath: string): Promise<File> {
    return new File([await fsAsync.readFile(filePath)], filePath)
  }

  readFileSync(filePath: string): File {
    return new File([fs.readFileSync(filePath)], filePath)
  }

  getParentDirPath(filePath: string): string {
    return path.dirname(filePath)
  }

  getFilenameFromPath(filePath: string): string {
    return path.basename(filePath)
  }

  getPathModule(): any {
    return path
  }
}

/** @deprecated Prefer NodeFileManager */
export const FileManager = NodeFileManager

BaseFileManager.configure(new NodeFileManager())

const _check: IFileManager = new NodeFileManager()
void _check

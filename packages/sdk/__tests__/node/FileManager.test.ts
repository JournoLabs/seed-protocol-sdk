import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileManager, NodeFileManager } from '@/node/helpers/FileManager'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

describe('NodeFileManager', () => {
  let tmpDir: string
  let fm: NodeFileManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-file-manager-'))
    fm = new NodeFileManager()
    BaseFileManager.resetInitializationState()
  })

  afterEach(() => {
    BaseFileManager.resetInitializationState()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('initializeFileSystem', () => {
    it('is a no-op on the instance', async () => {
      await expect(fm.initializeFileSystem(tmpDir)).resolves.toBeUndefined()
    })

    it('is registered with BaseFileManager, which records the working dir', async () => {
      expect(FileManager).toBe(NodeFileManager)
      await BaseFileManager.initializeFileSystem(tmpDir)
      expect(BaseFileManager.getWorkingDir()).toBe(tmpDir)
      expect(BaseFileManager.getFilesPath('images', 'a.jpg')).toBe(`${tmpDir}/images/a.jpg`)
    })
  })

  describe('getContentUrlFromPath', () => {
    it('returns a file:// URL instead of throwing', async () => {
      const url = await new FileManager().getContentUrlFromPath('/tmp/seed/html/abc.html')
      expect(url).toBe('file:///tmp/seed/html/abc.html')
    })
  })

  describe('save and read', () => {
    it('round-trips strings, ArrayBuffers and Blobs, creating parent dirs', async () => {
      const strPath = path.join(tmpDir, 'a', 'b', 'note.txt')
      await fm.saveFile(strPath, 'hello')
      expect(await fm.readFileAsString(strPath)).toBe('hello')

      const bufPath = path.join(tmpDir, 'bin', 'data.bin')
      await fm.saveFile(bufPath, new Uint8Array([1, 2, 3]).buffer)
      expect([...(await fm.readFileAsBuffer(bufPath))]).toEqual([1, 2, 3])

      const blobPath = path.join(tmpDir, 'blob', 'b.txt')
      await fm.saveFile(blobPath, new Blob(['blob-content']))
      const file = await fm.readFile(blobPath)
      expect(file).toBeInstanceOf(File)
      expect(await file.text()).toBe('blob-content')
    })

    it('saveFileSync writes strings and rejects Blobs', () => {
      const p = path.join(tmpDir, 'sync', 'x.txt')
      fm.saveFileSync(p, 'sync')
      expect(fs.readFileSync(p, 'utf-8')).toBe('sync')
      expect(() => fm.saveFileSync(p, new Blob(['x']))).toThrow(/Blob content not supported/)
    })

    it('rejects unsupported content types', async () => {
      await expect(fm.saveFile(path.join(tmpDir, 'x'), 42 as unknown as string)).rejects.toThrow('Unsupported content type')
    })
  })

  describe('pathExists / getFileSize', () => {
    it('reports existence and size, null for missing files', async () => {
      const p = path.join(tmpDir, 'sized.txt')
      expect(await fm.pathExists(p)).toBe(false)
      expect(await fm.getFileSize(p)).toBeNull()
      fs.writeFileSync(p, '12345')
      expect(await fm.pathExists(p)).toBe(true)
      expect(await fm.getFileSize(p)).toBe(5)
    })
  })

  describe('listFiles', () => {
    it('lists only files under the working dir subfolder, [] when missing', async () => {
      await BaseFileManager.initializeFileSystem(tmpDir)
      expect(await fm.listImageFiles()).toEqual([])

      fs.mkdirSync(path.join(tmpDir, 'images', 'nested'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'images', 'a.png'), '')
      fs.writeFileSync(path.join(tmpDir, 'images', 'b.jpg'), '')
      expect((await fm.listImageFiles()).sort()).toEqual(['a.png', 'b.jpg'])
    })
  })

  describe('waitForFile', () => {
    it('resolves once the file appears', async () => {
      const p = path.join(tmpDir, 'later.txt')
      setTimeout(() => fs.writeFileSync(p, 'x'), 30)
      await expect(fm.waitForFile(p, 10, 2000)).resolves.toBe(true)
    })

    it('rejects after the timeout', async () => {
      await expect(fm.waitForFile(path.join(tmpDir, 'never.txt'), 10, 50)).rejects.toThrow(/Timeout/)
    })
  })

  describe('path helpers', () => {
    it('delegate to node path', () => {
      expect(fm.getParentDirPath('/a/b/c.txt')).toBe('/a/b')
      expect(fm.getFilenameFromPath('/a/b/c.txt')).toBe('c.txt')
      expect(fm.getPathModule()).toBe(path)
    })
  })
})

// This should be a built in Model with certain methods and properties.
// It should follow either the Web File API or the Node File API. Or both.

import { Actor, createActor } from 'xstate'
import { uploadMachine } from '@/browser/schema/file/upload'
import { downloadMachine } from '@/browser/schema/file/download'

// type DownloadService = ActorRefFrom<typeof do>

export * from '@/browser/helpers/arweave'

type FileConstructorData = BlobPart[] | string | File | Buffer

export class SeedFile {
  private uploadService: Actor<any, any, any>
  private downloadService: Actor<any, any, any>

  constructor(data: FileConstructorData) {
    // super(data);
    let fileData: BlobPart[]

    if (data instanceof Blob) {
      fileData = [data]
    } else if (typeof data === 'string') {
      if (data.startsWith('http://') || data.startsWith('https://')) {
        fileData = [SeedFile.fetchUrlAsBlob(data)]
      } else if (data.startsWith('data:')) {
        fileData = [SeedFile.base64ToBlob(data)]
      } else {
        fileData = [SeedFile.readFileAsBlob(data)]
      }
    } else if (data instanceof File) {
      fileData = [data]
    } else if (Buffer.isBuffer(data)) {
      fileData = [new Blob([data])]
    } else {
      throw new Error('Unsupported data type')
    }

    // Initialize the state machines
    this.uploadService = createActor(uploadMachine)
    this.downloadService = createActor(downloadMachine)
  }

  private static async fetchUrlAsBlob(url: string): Promise<Blob> {
    const response = await fetch(url)
    return response.blob()
  }

  private static base64ToBlob(base64: string): Blob {
    const byteString = atob(base64.split(',')[1])
    const mimeString = base64.split(',')[0].split(':')[1].split(';')[0]
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i)
    }
    return new Blob([ab], { type: mimeString })
  }

  private static async readFileAsBlob(filePath: string): Promise<Blob> {
    // Implement file reading logic, for example using Node.js fs module
    const fs = require('fs').promises
    const buffer = await fs.readFile(filePath)
    return new Blob([buffer])
  }

  async uploadBinaryData(): Promise<void> {
    const formData = new FormData()
    formData.append('file', this, this.name)

    // Send to Arweave
  }

  async uploadMetadata(): Promise<void> {
    const metadata = {
      name: this.name,
      type: this.type,
      size: this.size,
      lastModified: this.lastModified,
    }

    // Send to EAS
  }

  static async downloadMetadata(
    fileName: string,
    metadataServiceUrl: string,
  ): Promise<any> {
    // Get metadata from EAS
    return {}
  }

  static async downloadBinaryData(
    fileName: string,
    blobServiceUrl: string,
  ): Promise<Blob> {
    // Get binary data from Arweave
    return new Blob()
  }

  subscribe(callback: (event: any, status: any) => void): void {
    this.uploadService.onTransition((state) => {
      callback(state.event, state.value)
    })
  }

  async sync(): Promise<void> {
    this.uploadService.start()
    this.uploadService.send('START')
  }
}

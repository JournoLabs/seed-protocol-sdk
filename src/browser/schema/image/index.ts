// Images should be a special kind of Model that handle caching, resizing,
// and convenience methods for uploading, downloading, and displaying images.

import { SeedFile } from '../file'

export class SeedImage extends SeedFile {
  constructor (data) {
    super(data)
  }

  async resize (width: number, height: number): Promise<SeedImage> {
    return new SeedImage(this)
  }

  async save (): Promise<string> {
    return ''
  }

  private async download (): Promise<SeedImage> {
    return new SeedImage(this)
  }

  async display (): Promise<string> {
    return ''
  }
}
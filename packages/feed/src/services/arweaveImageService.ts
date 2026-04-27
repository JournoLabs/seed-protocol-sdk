import { DEFAULT_ARWEAVE_GATEWAYS, ensureReadGatewaySelected } from '@seedprotocol/sdk'
import sizeOf from 'image-size'
import type { ImageMetadata } from '../types'

export interface ArweaveImageServiceConfig {
  gateways: string[]
  timeout: number // milliseconds
}

/**
 * Service for detecting and extracting metadata from images stored on Arweave
 */
export class ArweaveImageService {
  private config: ArweaveImageServiceConfig

  constructor(config: ArweaveImageServiceConfig) {
    this.config = config
  }

  /**
   * Detect if an Arweave transaction ID links to an image and extract metadata
   */
  async detectImage(transactionId: string): Promise<ImageMetadata> {
    await ensureReadGatewaySelected().catch(() => {
      /* feed may run without browser client init */
    })
    const gateways = this.config.gateways || [...DEFAULT_ARWEAVE_GATEWAYS]

    // Try each gateway until one succeeds
    for (const gateway of gateways) {
      try {
        const url = `https://${gateway}/${transactionId}`
        const metadata = await this.getImageMetadata(url)
        if (metadata.isImage) {
          return metadata
        }
      } catch (error) {
        // Log but continue to next gateway
        console.warn(`Failed to fetch from gateway ${gateway} for transaction ${transactionId}:`, error)
        continue
      }
    }

    // If all gateways failed, return non-image result
    return {
      isImage: false,
      url: `https://${gateways[0]}/${transactionId}`,
    }
  }

  /**
   * Get image metadata from a URL
   */
  async getImageMetadata(url: string): Promise<ImageMetadata> {
    try {
      // First, try HEAD request to check Content-Type (more efficient)
      const headResponse = await this.fetchWithTimeout(url, { method: 'HEAD' })
      
      if (!headResponse.ok) {
        return { isImage: false, url }
      }

      const contentType = headResponse.headers.get('content-type') || ''
      const contentLength = headResponse.headers.get('content-length')
      
      // Check if it's an image based on Content-Type
      if (!this.isImageContentType(contentType)) {
        return {
          isImage: false,
          url,
          mimeType: contentType || undefined,
          size: contentLength ? parseInt(contentLength, 10) : undefined,
        }
      }

      // If it's an image, fetch first few KB to extract dimensions
      const rangeResponse = await this.fetchWithTimeout(url, {
        headers: {
          'Range': 'bytes=0-8192', // First 8KB should be enough for most image headers
        },
      })

      if (!rangeResponse.ok) {
        // If range request fails, try full request (some servers don't support range)
        return await this.getImageMetadataFromFullRequest(url, contentType, contentLength)
      }

      const buffer = Buffer.from(await rangeResponse.arrayBuffer())
      const dimensions = this.extractImageDimensions(buffer, contentType)
      const format = this.getImageFormat(contentType, buffer)

      return {
        isImage: true,
        url,
        mimeType: contentType,
        width: dimensions.width,
        height: dimensions.height,
        size: contentLength ? parseInt(contentLength, 10) : undefined,
        format,
      }
    } catch (error) {
      console.warn(`Error fetching image metadata from ${url}:`, error)
      return { isImage: false, url }
    }
  }

  /**
   * Fetch image metadata from full request (fallback when range requests fail)
   */
  private async getImageMetadataFromFullRequest(
    url: string,
    contentType: string,
    contentLength: string | null
  ): Promise<ImageMetadata> {
    try {
      const response = await this.fetchWithTimeout(url)
      if (!response.ok) {
        return { isImage: false, url }
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const dimensions = this.extractImageDimensions(buffer, contentType)
      const format = this.getImageFormat(contentType, buffer)

      return {
        isImage: true,
        url,
        mimeType: contentType,
        width: dimensions.width,
        height: dimensions.height,
        size: buffer.length,
        format,
      }
    } catch (error) {
      console.warn(`Error in full request for ${url}:`, error)
      return { isImage: false, url }
    }
  }

  /**
   * Validate if Content-Type indicates an image
   */
  private isImageContentType(contentType: string): boolean {
    if (!contentType) return false
    
    const normalized = (contentType.toLowerCase().split(';')[0] ?? '').trim()
    return normalized.startsWith('image/')
  }

  /**
   * Extract image dimensions from buffer
   */
  private extractImageDimensions(
    buffer: Buffer,
    contentType: string
  ): { width: number; height: number } {
    try {
      const dimensions = sizeOf(buffer)
      if (dimensions.width && dimensions.height) {
        return {
          width: dimensions.width,
          height: dimensions.height,
        }
      }
    } catch (error) {
      // image-size might fail for some formats or corrupted data
      console.warn(`Failed to extract dimensions:`, error)
    }

    // Return default if extraction failed
    return { width: 0, height: 0 }
  }

  /**
   * Get image format from Content-Type or buffer analysis
   */
  private getImageFormat(contentType: string, buffer: Buffer): string | undefined {
    // Try to get format from Content-Type first
    if (contentType) {
      const mimeMatch = contentType.toLowerCase().match(/image\/([^;]+)/)
      if (mimeMatch && mimeMatch[1]) {
        const format = mimeMatch[1].toLowerCase()
        // Normalize common formats
        if (format === 'jpeg') return 'jpeg'
        if (format === 'png') return 'png'
        if (format === 'gif') return 'gif'
        if (format === 'webp') return 'webp'
        if (format === 'svg+xml') return 'svg'
        return format
      }
    }

    // Try to detect from buffer magic bytes
    try {
      const dimensions = sizeOf(buffer)
      if (dimensions.type) {
        return dimensions.type.toLowerCase()
      }
    } catch {
      // Ignore errors
    }

    return undefined
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`)
      }
      throw error
    }
  }
}

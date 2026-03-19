import React, { useState, useEffect, DetailedHTMLProps, ImgHTMLAttributes } from 'react'
import debug                                                                                    from 'debug'
import { BaseFileManager } from '@seedprotocol/sdk'
import { useItemProperty } from "./itemProperty"
import { ItemProperty } from '@seedprotocol/sdk'

const logger = debug('seedSdk:react:SeedImage')

// Cache for content URLs
const contentUrlCache = new Map<string, string>()

const getFileNameWithoutExtension = (filePath: string): string => {
  // This regex has 3 parts:
  // 1. (.*[\/\\]) - Captures the directory path (if any) ending with / or \
  // 2. ([^\/\\]+) - Captures the filename (anything that's not a / or \)
  // 3. (\.[^.\/\\]*)?$ - Captures the last extension (if any)
  const regex = /^(.*[\/\\])?([^\/\\]+?)(\.[^.\/\\]*)?$/;
  
  const match = filePath.match(regex);
  
  if (match && match[2]) {
    return match[2];
  }
  
  return filePath; // Return original if no match (unlikely)
}

// Helper function to escape special regex characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function matchFileNameWithoutExtension(fileName: string, targetName: string): boolean {
  // Create a regex pattern that matches the targetName
  // ^ - start of string
  // targetName is escaped to handle special regex characters
  // $ - end of string
  const regex = new RegExp(`^${escapeRegExp(targetName)}$`);
  
  // First get the filename without extension
  const nameWithoutExt = getFileNameWithoutExtension(fileName);
  
  // Then check if it matches the target name
  return regex.test(nameWithoutExt);
}

type SeedImageProps = DetailedHTMLProps<ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement> & {
  imageProperty: ItemProperty<any>
  alt?: string
  width?: number
  height?: number
  /** Optional filename override when property hasn't resolved yet (e.g. in tests) */
  filename?: string
}

const SeedImageInner = ({ imageProperty, width, filename: filenameOverride, ...props }: SeedImageProps): React.ReactNode => {
  const [sizedContentUrl, setSizedContentUrl] = useState<string | undefined>()
  const [originalContentUrl, setOriginalContentUrl] = useState<string | undefined>()

  const { property: propertyFromHook } = useItemProperty({
    propertyName: imageProperty.propertyName,
    seedLocalId: imageProperty.seedLocalId,
    seedUid: imageProperty.seedUid
  })

  // Use passed imageProperty when parent provides it (e.g. direct pass from Item.properties); else use hook for reactive lookup
  const property = imageProperty ?? propertyFromHook

  // Resolved filename: explicit override, or from property
  const resolvedFilename = filenameOverride ?? (property?.refResolvedValue ?? property?.value) as string | undefined

  // Get display URL: value (blob URL or filename from ItemProperty.value getter), or resolvedFilename
  const rawValue = property?.value
  const srcUrl = (typeof rawValue === 'string' ? rawValue : resolvedFilename) as string | undefined
  const isFileOrBlob = rawValue != null && (rawValue instanceof File || rawValue instanceof Blob)
  const [blobPreviewUrl, setBlobPreviewUrl] = useState<string | null>(null)
  const blobPreviewRef = React.useRef<string | null>(null)
  useEffect(() => {
    if (isFileOrBlob && (rawValue instanceof File || rawValue instanceof Blob)) {
      if (!blobPreviewRef.current) {
        blobPreviewRef.current = URL.createObjectURL(rawValue)
        setBlobPreviewUrl(blobPreviewRef.current)
      }
      return () => {
        if (blobPreviewRef.current) {
          URL.revokeObjectURL(blobPreviewRef.current)
          blobPreviewRef.current = null
        }
        setBlobPreviewUrl(null)
      }
    }
    blobPreviewRef.current = null
    setBlobPreviewUrl(null)
  }, [isFileOrBlob, rawValue])

  // Fallback: when we have filename but no blob URL (e.g. after reload, or sized versions missing), load original file
  useEffect(() => {
    if (!resolvedFilename) return
    const isBlob = (s: unknown) => typeof s === 'string' && s.startsWith('blob:')
    if (rawValue && isBlob(rawValue)) return // Already have blob URL
    if (blobPreviewUrl) return // Have blob preview

    const _getOriginalContentUrl = async () => {
      try {
        const filePath = property?.localStoragePath
          ? property.localStoragePath
          : `${BaseFileManager.getFilesPath('images')}/${resolvedFilename}`
        const exists = await BaseFileManager.pathExists(filePath)
        if (exists) {
          const url = await BaseFileManager.getContentUrlFromPath(filePath)
          if (url) setOriginalContentUrl(url)
        }
      } catch (err) {
        logger('_getOriginalContentUrl error', err)
      }
    }
    _getOriginalContentUrl()
    return () => setOriginalContentUrl(undefined)
  }, [resolvedFilename, rawValue, blobPreviewUrl, property?.localStoragePath])

  useEffect(() => {
    if (!width || !resolvedFilename) {
      return
    }

    const _getSizedContentUrl = async () => {
      try {
        const fs = await BaseFileManager.getFs()
        const baseDir = property?.localStoragePath
          ? property.localStoragePath.split('/').slice(0, -1).join('/')
          : BaseFileManager.getFilesPath('images')
        const itemsInDir = fs.readdirSync(baseDir, {withFileTypes: true})
        const widthDirs = itemsInDir.filter((item: { isDirectory: () => boolean }) => item.isDirectory())
        const availableWidths = widthDirs.map((dir: { name: string }) => parseInt(dir.name))
        const closestWidth = availableWidths.reduce((prev: number, curr: number) => {
          return (Math.abs(curr - width) < Math.abs(prev - width) ? curr : prev)
        }, availableWidths[0])
        const filenameWithoutExtension = getFileNameWithoutExtension(resolvedFilename)

        // Check cache first
        const cacheKey = `${filenameWithoutExtension}-${closestWidth}`
        if (contentUrlCache.has(cacheKey)) {
          try {
            const contentUrl = contentUrlCache.get(cacheKey)
            if (contentUrl) {
              const response = await fetch(contentUrl)
              if (response.ok) {
                setSizedContentUrl(contentUrl)
                return
              }
            }
          } catch (error) {
            logger('error', error)
            contentUrlCache.delete(cacheKey)
          }
        }

        const itemsInSizedDir = fs.readdirSync(`${baseDir}/${closestWidth}`, {withFileTypes: true})

        const matchingFile = itemsInSizedDir.find((item: { name?: string }) => {
          if (!item.name) {
            return false
          }
          return matchFileNameWithoutExtension(item.name, filenameWithoutExtension)
        })
        if (!matchingFile) {
          return
        }
        const newPath = `${baseDir}/${closestWidth}/${matchingFile?.name}`
        const exists = await BaseFileManager.pathExists(newPath)
        if (exists) {
          const contentUrl = await BaseFileManager.getContentUrlFromPath(newPath)
          if (contentUrl) {
            contentUrlCache.set(cacheKey, contentUrl)
            setSizedContentUrl(contentUrl)
          }
        }
      } catch (err) {
        logger('_getSizedContentUrl error', err)
      }
    }

    _getSizedContentUrl()
  }, [property, width, srcUrl, resolvedFilename])

  // Render img when we have a content URL, or when we have filename (show placeholder while loading)
  const isBlobUrl = (s: unknown) => typeof s === 'string' && s.startsWith('blob:')
  const hasContentUrl = !!sizedContentUrl || !!originalContentUrl || !!blobPreviewUrl || (!!srcUrl && isBlobUrl(srcUrl))
  if (!hasContentUrl && !resolvedFilename) {
    return null
  }

  // Placeholder 1x1 transparent GIF while loading (ensures img exists for a11y and tests)
  const imgSrc = sizedContentUrl || originalContentUrl || blobPreviewUrl || (isBlobUrl(srcUrl) ? srcUrl : undefined) || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

  return (
    <img src={imgSrc} alt={props.alt || imageProperty.propertyName || 'Image'} {...props} />
  )
}

export const SeedImage = React.memo(SeedImageInner, (prev, next) =>
  prev.imageProperty === next.imageProperty &&
  prev.width === next.width &&
  prev.filename === next.filename
)
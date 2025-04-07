import React, { FC, HTMLAttributes, useState, useEffect, DetailedHTMLProps, ImgHTMLAttributes } from 'react'
import debug                                                                                    from 'debug'
import { FileManager } from "../helpers/FileManager"
import { useItemProperty } from "./property"
import { BaseItemProperty } from "@/ItemProperty/BaseItemProperty"

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
  imageProperty: BaseItemProperty<any>
  alt?: string
  width?: number
  height?: number
}

const SeedImage: FC<SeedImageProps> = ({ imageProperty, width, ...props }) => {

  const [sizedContentUrl, setSizedContentUrl] = useState<string | undefined>()

  const {property, value: srcUrl} = useItemProperty({
    propertyName: imageProperty.propertyName,
    seedLocalId: imageProperty.seedLocalId,
    seedUid: imageProperty.seedUid
  })

  useEffect(() => {
    if (!property || !width || !property.localStoragePath) {
      return
    }

    const _getSizedContentUrl = async () => {
      const fs = await FileManager.getFs()
      const baseDir = `/files${property.localStorageDir}`
      const itemsInDir = fs.readdirSync(baseDir, {withFileTypes: true})
      const widthDirs = itemsInDir.filter(item => item.isDirectory())
      const availableWidths = widthDirs.map(dir => parseInt(dir.name))
      const closestWidth = availableWidths.reduce((prev, curr) => {
        return (Math.abs(curr - width) < Math.abs(prev - width) ? curr : prev)
      }, availableWidths[0])
      if (!property.refResolvedValue) {
        return
      }
      const filenameWithoutExtension = getFileNameWithoutExtension(property.refResolvedValue)

      // Check cache first
      const cacheKey = `${filenameWithoutExtension}-${closestWidth}`
      if (contentUrlCache.has(cacheKey)) {
        try {
          const contentUrl = contentUrlCache.get(cacheKey)
          const response = await fetch(contentUrl)
          if (response.ok) {
            setSizedContentUrl(contentUrl)
            return
          }
        } catch (error) {
          logger('error', error)
          contentUrlCache.delete(cacheKey)
        }
      }

      const itemsInSizedDir = fs.readdirSync(`${baseDir}/${closestWidth}`, {withFileTypes: true})

      const matchingFile = itemsInSizedDir.find((item) => {
        if (!item.name) {
          return false
        }
        return matchFileNameWithoutExtension(item.name, filenameWithoutExtension)
      })
      if (!matchingFile) {
        return
      }
      const newPath = `${baseDir}/${closestWidth}/${matchingFile?.name}`
      const exists = await FileManager.pathExists(newPath)
      if (exists) {
        const contentUrl = await FileManager.getContentUrlFromPath(newPath)
        if (contentUrl) {
          contentUrlCache.set(cacheKey, contentUrl)
          setSizedContentUrl(contentUrl)
        }
      }
    }

    _getSizedContentUrl()
  }, [property, width, srcUrl])

  if (!sizedContentUrl && (!srcUrl || !srcUrl.startsWith('blob:'))) {
    return null
  }

  return (
    <img src={sizedContentUrl || srcUrl} alt={props.alt || imageProperty.propertyName || 'Image'} {...props} />
  )
}

export default SeedImage

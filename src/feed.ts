import { getSeedsBySchemaName, getItemVersionsFromEas, getItemPropertiesFromEas } from "./eas"
import { Attestation } from "./graphql/gql/graphql"
import { setSchemaUidForSchemaDefinition } from "./stores/eas"
import { BaseEasClient, parseEasRelationPropertyName, getArweaveUrlForTransaction } from "./helpers"
import { GET_SEEDS } from "./Item/queries"
import debug from 'debug'

const logger = debug('seedSdk:feed')

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]

// Helper to convert snake_case to camelCase
const toCamelCase = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

// Helper to format timestamp as RFC 822 date string for RSS pubDate
const formatRfc822Date = (timestamp: number): string => {
  const date = new Date(timestamp * 1000) // Convert from seconds to milliseconds
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  
  const day = days[date.getUTCDay()]
  const month = months[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  const dayNum = date.getUTCDate().toString().padStart(2, '0')
  const hours = date.getUTCHours().toString().padStart(2, '0')
  const minutes = date.getUTCMinutes().toString().padStart(2, '0')
  const seconds = date.getUTCSeconds().toString().padStart(2, '0')
  
  return `${day}, ${dayNum} ${month} ${year} ${hours}:${minutes}:${seconds} GMT`
}

// Helper to set default values for feed items
const setFeedItemDefaults = (item: Record<string, any>, seedUid: string, schemaName: string): void => {
  // Set default title if not present (check both snake_case and camelCase)
  if (!item.title && !item.Title) {
    item.title = seedUid
    item.Title = seedUid // Also set camelCase version
  } else if (item.title && !item.Title) {
    item.Title = item.title
  } else if (item.Title && !item.title) {
    item.title = item.Title
  }
  
  // Set default link/guid using seedUid or storage_transaction_id
  // Handle empty strings, null, and undefined - check both formats
  const storageTransactionIdSnake = item.storage_transaction_id && 
                                     typeof item.storage_transaction_id === 'string' && 
                                     item.storage_transaction_id.trim() !== '' && 
                                     item.storage_transaction_id !== 'undefined' &&
                                     item.storage_transaction_id !== seedUid // Don't use seedUid as transaction ID
                                     ? item.storage_transaction_id.trim() 
                                     : null
  const storageTransactionIdCamel = item.storageTransactionId && 
                                     typeof item.storageTransactionId === 'string' && 
                                     item.storageTransactionId.trim() !== '' && 
                                     item.storageTransactionId !== 'undefined' &&
                                     item.storageTransactionId !== seedUid // Don't use seedUid as transaction ID
                                     ? item.storageTransactionId.trim() 
                                     : null
  const storageTransactionId = storageTransactionIdSnake || storageTransactionIdCamel
  
  console.log('[feed] [setFeedItemDefaults] Setting defaults for item:', {
    seedUid,
    schemaName,
    hasStorageTransactionIdSnake: !!storageTransactionIdSnake,
    hasStorageTransactionIdCamel: !!storageTransactionIdCamel,
    storageTransactionIdSnakeValue: item.storage_transaction_id,
    storageTransactionIdCamelValue: item.storageTransactionId,
    storageTransactionId,
    itemKeys: Object.keys(item),
  })
  
  // If there's a valid storageTransactionId (not seedUid), use Arweave URL for the link
  // Otherwise, build URL based on schema name (e.g., /images/ for image schema, /posts/ for post schema)
  let defaultLink: string
  if (storageTransactionId && storageTransactionId !== seedUid && storageTransactionId.length > 0) {
    try {
      defaultLink = getArweaveUrlForTransaction(storageTransactionId)
      console.log('[feed] [setFeedItemDefaults] Using Arweave URL for storageTransactionId:', defaultLink)
    } catch (error) {
      console.error('[feed] [setFeedItemDefaults] Error generating Arweave URL:', error)
      // Fallback to default link format
      const basePath = schemaName === 'image' ? 'images' : schemaName === 'post' ? 'posts' : schemaName.toLowerCase() + 's'
      const baseUrl = 'https://seedprotocol.io'
      defaultLink = `${baseUrl}/${basePath}/${seedUid || 'unknown'}`
    }
  } else {
    const basePath = schemaName === 'image' ? 'images' : schemaName === 'post' ? 'posts' : schemaName.toLowerCase() + 's'
    const baseUrl = 'https://seedprotocol.io'
    // Ensure seedUid is valid, use 'unknown' as fallback to prevent 'undefined' in URLs
    const validSeedUid = seedUid && typeof seedUid === 'string' && seedUid.trim() !== '' ? seedUid : 'unknown'
    defaultLink = `${baseUrl}/${basePath}/${validSeedUid}`
    console.log('[feed] [setFeedItemDefaults] Using default link format:', defaultLink, { seedUid, validSeedUid })
  }
  
  // Always ensure link is set (override if undefined, null, empty, or the string "undefined")
  const currentLink = item.link || item.Link
  if (!currentLink || currentLink === 'undefined' || (typeof currentLink === 'string' && currentLink.trim() === '')) {
    item.link = defaultLink
    item.Link = defaultLink
    console.log('[feed] [setFeedItemDefaults] Set link to:', defaultLink)
  } else {
    // Ensure both formats are set
    if (!item.link || item.link === 'undefined') {
      item.link = currentLink
    }
    if (!item.Link || item.Link === 'undefined') {
      item.Link = currentLink
    }
  }
  
  // Always ensure guid is set (use link if available, otherwise default)
  const currentGuid = item.guid || item.Guid
  if (!currentGuid || currentGuid === 'undefined' || (typeof currentGuid === 'string' && currentGuid.trim() === '')) {
    item.guid = item.link || defaultLink
    item.Guid = item.guid
    console.log('[feed] [setFeedItemDefaults] Set guid to:', item.guid)
  } else {
    // Ensure both formats are set
    if (!item.guid || item.guid === 'undefined') {
      item.guid = currentGuid
    }
    if (!item.Guid || item.Guid === 'undefined') {
      item.Guid = currentGuid
    }
  }
  
  // Set pubDate from timeCreated if available
  if (item.timeCreated && !item.pubDate && !item.PubDate) {
    const pubDate = formatRfc822Date(item.timeCreated)
    item.pubDate = pubDate
    item.PubDate = pubDate
  } else if (item.pubDate && !item.PubDate) {
    item.PubDate = item.pubDate
  } else if (item.PubDate && !item.pubDate) {
    item.pubDate = item.PubDate
  }
  
  // Ensure seedUid is always present
  if (!item.seedUid && !item.SeedUid) {
    item.seedUid = seedUid
    item.SeedUid = seedUid
  } else if (item.seedUid && !item.SeedUid) {
    item.SeedUid = item.seedUid
  } else if (item.SeedUid && !item.seedUid) {
    item.seedUid = item.SeedUid
  }
  
  // Note: We don't set storageTransactionId to seedUid as a fallback anymore
  // because seedUid is not a valid Arweave transaction ID. If storageTransactionId
  // doesn't exist, we'll use the default link format with seedUid instead.
}

const seedUidToModelType = new Map<string, string>()
const relatedSeedUids = new Set<string>()

const versionUidToSeedUid = new Map<string, string>()

const assembledFeedItems = new Map<string, Record<string, any>>()

const versionsBySeedUid = new Map<string, Attestation[]>()

const latestVersionUidsBySeedUid = new Map<string, string>()


const processItemProperty = async (property: Attestation, itemSeeds: Attestation[]) => {
  console.log('[feed] [processItemProperty] Starting to process property:', {
    propertyId: property.id,
    refUID: property.refUID,
    schemaId: property.schemaId,
  })

  let metadata
  try {
    metadata = JSON.parse(property.decodedDataJson)[0].value
  } catch (error) {
    console.error('[feed] [processItemProperty] Error parsing metadata:', error)
    return
  }

  let propertyNameSnake = metadata.name

  if (!propertyNameSnake) {
    console.log('[feed] [processItemProperty] WARNING: no propertyName found for property:', {
      propertyId: property.id,
      property,
    })
    console.warn(
      '[item/events] [syncDbWithEas] no propertyName found for property: ',
      property,
    )
    return
  }

  console.log('[feed] [processItemProperty] Processing property:', {
    propertyNameSnake,
    propertyId: property.id,
  })

  let isRelation = false
  let refValueType
  let refSeedType
  let refSchemaUid
  let refResolvedValue
  let isList = false
  const schemaUid = property.schemaId

  console.log('[feed] [processItemProperty] Setting schema UID for schema definition:', {
    propertyNameSnake,
    schemaUid,
  })

  setSchemaUidForSchemaDefinition({
    text: propertyNameSnake,
    schemaUid,
  })

  if (
    (propertyNameSnake.endsWith('_id') ||
      propertyNameSnake.endsWith('_ids')) &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'
  ) {
    isRelation = true
    console.log('[feed] [processItemProperty] Detected relation property:', {
      propertyNameSnake,
      metadataValue: metadata.value,
    })

    if (Array.isArray(metadata.value)) {
      isList = true
      refValueType = 'list'
      console.log('[feed] [processItemProperty] Detected list relation:', {
        propertyNameSnake,
        listLength: metadata.value.length,
        values: metadata.value,
      })

      const result = parseEasRelationPropertyName(propertyNameSnake)
      console.log('[feed] [processItemProperty] Parsed relation property name:', {
        result,
        originalPropertyName: propertyNameSnake,
      })

      if (result) {
        propertyNameSnake = result.propertyName
        refSeedType = result.modelName
        console.log('[feed] [processItemProperty] Updated property name and seed type:', {
          newPropertyName: propertyNameSnake,
          refSeedType,
        })
      }

      metadata.value.forEach((value: string) => {
        relatedSeedUids.add(value)
        console.log('[feed] [processItemProperty] Added related seed UID to set:', {
          relatedSeedUid: value,
          totalRelatedSeeds: relatedSeedUids.size,
        })
      })
    }

    if (!isList) {
      if (relationValuesToExclude.includes(metadata.value)) {
        console.log('[feed] [processItemProperty] Excluding relation value:', {
          propertyNameSnake,
          excludedValue: metadata.value,
        })
        return
      }
      relatedSeedUids.add(metadata.value)
      console.log('[feed] [processItemProperty] Added single related seed UID:', {
        relatedSeedUid: metadata.value,
        totalRelatedSeeds: relatedSeedUids.size,
      })
    }
  }

  let propertyValue = metadata.value

  if (typeof propertyValue !== 'string') {
    console.log('[feed] [processItemProperty] Converting property value to string:', {
      propertyNameSnake,
      originalType: typeof propertyValue,
      originalValue: propertyValue,
    })
    propertyValue = JSON.stringify(propertyValue)
  }

  console.log('[feed] [processItemProperty] Final property value:', {
    propertyNameSnake,
    propertyValue,
    isRelation,
    isList,
  })

  if (isRelation && !isList) {
    console.log('[feed] [processItemProperty] Processing single relation:', {
      propertyNameSnake,
      relationValue: metadata.value,
      itemSeedsCount: itemSeeds.length,
    })
    const relatedSeed = itemSeeds.find(
      (seed: Attestation) => seed.id === metadata.value,
    )
    if (relatedSeed && relatedSeed.schema && relatedSeed.schema.schemaNames) {
      refSeedType = relatedSeed.schema.schemaNames[0].name
      refSchemaUid = relatedSeed.schemaId
      console.log('[feed] [processItemProperty] Found related seed for single relation:', {
        propertyNameSnake,
        refSeedType,
        refSchemaUid,
        relatedSeedId: relatedSeed.id,
      })
    } else {
      console.log('[feed] [processItemProperty] No related seed found for single relation:', {
        propertyNameSnake,
        relationValue: metadata.value,
      })
    }
  }

  if (isRelation && isList) {
    console.log('[feed] [processItemProperty] Processing list relation:', {
      propertyNameSnake,
      relationValues: metadata.value,
      itemSeedsCount: itemSeeds.length,
    })
    const relatedSeeds = itemSeeds.filter((seed: Attestation) =>
      metadata.value.includes(seed.id),
    )
    console.log('[feed] [processItemProperty] Filtered related seeds for list:', {
      propertyNameSnake,
      foundSeedsCount: relatedSeeds.length,
      foundSeedIds: relatedSeeds.map((s) => s.id),
    })
    if (relatedSeeds && relatedSeeds.length > 0) {
      refSeedType = relatedSeeds[0].schema.schemaNames[0].name
      refSchemaUid = relatedSeeds[0].schemaId
      console.log('[feed] [processItemProperty] Set ref seed type and schema UID from list relation:', {
        propertyNameSnake,
        refSeedType,
        refSchemaUid,
      })
    } else {
      console.log('[feed] [processItemProperty] No related seeds found for list relation:', {
        propertyNameSnake,
      })
    }
  }

  console.log('[feed] [processItemProperty] Looking up seed UID for property:', {
    propertyRefUID: property.refUID,
    versionUidToSeedUidSize: versionUidToSeedUid.size,
  })

  const seedUidForProperty = versionUidToSeedUid.get(property.refUID)
  if (!seedUidForProperty) {
    console.log('[feed] [processItemProperty] WARNING: no seedUid found for property:', {
      propertyRefUID: property.refUID,
      propertyId: property.id,
      property,
    })
    console.warn(
      'no seedUid found for property: ',
      property,
    )
    return
  }

  console.log('[feed] [processItemProperty] Found seed UID for property:', {
    seedUidForProperty,
    propertyNameSnake,
  })

  let existingFeedItem = assembledFeedItems.get(seedUidForProperty) || {}
  const existingKeys = Object.keys(existingFeedItem)
  // Store property in snake_case (original format)
  existingFeedItem[propertyNameSnake] = propertyValue
  // Also store in camelCase for easier access by external consumers (e.g., RSS generators)
  const propertyNameCamel = toCamelCase(propertyNameSnake)
  if (propertyNameCamel !== propertyNameSnake) {
    existingFeedItem[propertyNameCamel] = propertyValue
  }
  assembledFeedItems.set(seedUidForProperty, existingFeedItem)

  console.log('[feed] [processItemProperty] Updated assembled feed item:', {
    seedUidForProperty,
    propertyNameSnake,
    propertyValue,
    existingKeysCount: existingKeys.length,
    newKeysCount: Object.keys(existingFeedItem).length,
    totalAssembledItems: assembledFeedItems.size,
  })
}

const processSeeds = async (seeds: Attestation[]) => {
  console.log('[feed] [processSeeds] Starting to process seeds:', {
    seedsCount: seeds.length,
    seedIds: seeds.map((s) => s.id),
  })

  const seedUids = seeds.map((seed: Attestation) => seed.id)

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]
    seedUids.push(seed.id)
    const modelType = seed.schema.schemaNames[0].name
    seedUidToModelType.set(seed.id, modelType)
    
    // Initialize feed item with seed metadata
    if (!assembledFeedItems.has(seed.id)) {
      assembledFeedItems.set(seed.id, {
        seedUid: seed.id,
        timeCreated: seed.timeCreated,
      })
      console.log('[feed] [processSeeds] Initialized feed item for seed:', {
        seedId: seed.id,
        modelType,
      })
    }
    
    console.log('[feed] [processSeeds] Processing seed:', {
      index: i,
      seedId: seed.id,
      modelType,
      totalSeedsProcessed: i + 1,
    })
  }

  console.log('[feed] [processSeeds] Completed seed mapping:', {
    totalSeeds: seeds.length,
    seedUidToModelTypeSize: seedUidToModelType.size,
    seedUids,
  })

  console.log('[feed] [processSeeds] Fetching item versions from EAS:', {
    seedUidsCount: seedUids.length,
    seedUids,
  })

  const itemVersions = await getItemVersionsFromEas({seedUids})

  console.log('[feed] [processSeeds] Received item versions from EAS:', {
    itemVersionsCount: itemVersions.length,
    versionIds: itemVersions.map((v) => v.id),
  })

  for (let i = 0; i < itemVersions.length; i++) {
    const itemVersion = itemVersions[i]
    const seedUid = itemVersion.refUID
    versionUidToSeedUid.set(itemVersion.id, seedUid)
    const existingVersions = versionsBySeedUid.get(seedUid) || []
    versionsBySeedUid.set(seedUid, [...existingVersions, itemVersion])
    console.log('[feed] [processSeeds] Processed item version:', {
      index: i,
      versionId: itemVersion.id,
      seedUid,
      timeCreated: itemVersion.timeCreated,
      versionsForSeedCount: existingVersions.length + 1,
    })
  }

  console.log('[feed] [processSeeds] Completed version mapping:', {
    totalVersions: itemVersions.length,
    versionUidToSeedUidSize: versionUidToSeedUid.size,
    versionsBySeedUidSize: versionsBySeedUid.size,
    uniqueSeedsWithVersions: Array.from(versionsBySeedUid.keys()),
  })

  // Get latest version for each seed and then use those to get the properties
  console.log('[feed] [processSeeds] Determining latest versions for each seed')
  const latestVersionUids: string[] = []
  
  for (const [seedUid, versions] of versionsBySeedUid.entries()) {
    console.log('[feed] [processSeeds] Processing versions for seed:', {
      seedUid,
      versionsCount: versions.length,
      versionIds: versions.map((v) => v.id),
      timeCreateds: versions.map((v) => v.timeCreated),
    })
    // Sort versions by timeCreated in descending order (most recent first)
    const sortedVersions = [...versions].sort((a, b) => b.timeCreated - a.timeCreated)
    
    console.log('[feed] [processSeeds] Sorted versions:', {
      seedUid,
      sortedVersionIds: sortedVersions.map((v) => v.id),
      sortedTimeCreateds: sortedVersions.map((v) => v.timeCreated),
    })
    
    // Get the most recent version for this seedUid
    if (sortedVersions.length > 0) {
      const latestVersion = sortedVersions[0]
      latestVersionUids.push(latestVersion.id)
      latestVersionUidsBySeedUid.set(seedUid, latestVersion.id)
      console.log('[feed] [processSeeds] Set latest version for seed:', {
        seedUid,
        latestVersionId: latestVersion.id,
        latestTimeCreated: latestVersion.timeCreated,
      })
    } else {
      console.log('[feed] [processSeeds] WARNING: No versions found for seed:', {
        seedUid,
      })
    }
  }

  console.log('[feed] [processSeeds] Completed latest version determination:', {
    latestVersionUidsCount: latestVersionUids.length,
    latestVersionUids,
    latestVersionUidsBySeedUidSize: latestVersionUidsBySeedUid.size,
  })

  console.log('[feed] [processSeeds] Fetching item properties from EAS:', {
    latestVersionUidsCount: latestVersionUids.length,
    latestVersionUids,
  })

  const itemProperties = await getItemPropertiesFromEas({versionUids: latestVersionUids})

  console.log('[feed] [processSeeds] Received item properties from EAS:', {
    itemPropertiesCount: itemProperties.length,
    propertyIds: itemProperties.map((p) => p.id),
  })

  for (let i = 0; i < itemProperties.length; i++) {
    console.log('[feed] [processSeeds] Processing item property:', {
      index: i,
      propertyId: itemProperties[i].id,
      totalProperties: itemProperties.length,
    })
    await processItemProperty(itemProperties[i], seeds)
  }

  console.log('[feed] [processSeeds] Completed processing all seeds:', {
    seedsCount: seeds.length,
    itemVersionsCount: itemVersions.length,
    itemPropertiesCount: itemProperties.length,
    assembledFeedItemsSize: assembledFeedItems.size,
  })
}

export const getFeedItemsBySchemaName = async (schemaName: string) => {
  console.log('[feed] [getFeedItemsBySchemaName] Starting feed retrieval:', {
    schemaName,
    currentAssembledItemsSize: assembledFeedItems.size,
    currentRelatedSeedUidsSize: relatedSeedUids.size,
  })

  const easClient = BaseEasClient.getEasClient()
  console.log('[feed] [getFeedItemsBySchemaName] Retrieved EAS client')

  console.log('[feed] [getFeedItemsBySchemaName] Fetching seeds by schema name:', {
    schemaName,
  })
  const seeds = await getSeedsBySchemaName(schemaName)

  console.log('[feed] [getFeedItemsBySchemaName] Received seeds:', {
    seedsCount: seeds.length,
    seedIds: seeds.map((s: Attestation) => s.id),
  })

  await processSeeds(seeds)

  const relatedSeedUidsArray = Array.from(relatedSeedUids)
  console.log('[feed] [getFeedItemsBySchemaName] Fetching related seeds:', {
    relatedSeedUidsCount: relatedSeedUidsArray.length,
    relatedSeedUids: relatedSeedUidsArray,
  })

  const {itemSeeds: relatedSeeds} = await easClient.request(GET_SEEDS, {
    where: {
      id: {
        in: relatedSeedUidsArray,
      },
    },
  })

  console.log('[feed] [getFeedItemsBySchemaName] Received related seeds:', {
    relatedSeedsCount: relatedSeeds.length,
    relatedSeedIds: relatedSeeds.map((s: Attestation) => s.id),
  })

  await processSeeds(relatedSeeds)

  // Filter feed items to only include items matching the requested schema name
  // and apply default values for required RSS fields
  const feedItems = Array.from(assembledFeedItems.entries())
    .filter(([seedUid]) => seedUidToModelType.get(seedUid) === schemaName)
    .map(([seedUid, item]) => {
      // Apply defaults for required RSS feed fields
      setFeedItemDefaults(item, seedUid, schemaName)
      return item
    })
  
  console.log('[feed] [getFeedItemsBySchemaName] Completed feed retrieval:', {
    schemaName,
    feedItemsCount: feedItems.length,
    assembledFeedItemsSize: assembledFeedItems.size,
    filteredFeedItemsCount: feedItems.length,
    feedItemKeys: feedItems.map((item) => Object.keys(item)),
  })

  return feedItems
}
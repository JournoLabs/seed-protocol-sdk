import { getSeedsBySchemaName, getItemVersionsFromEas, getItemPropertiesFromEas } from "./eas"
import { Attestation } from "./graphql/gql/graphql"
import { setSchemaUidForSchemaDefinition } from "./stores/eas"
import { BaseEasClient, parseEasRelationPropertyName } from "./helpers"
import { GET_SEEDS } from "./Item/queries"
import debug from 'debug'

const logger = debug('seedSdk:feed')

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]

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
  existingFeedItem[propertyNameSnake] = propertyValue
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

  const feedItems = Array.from(assembledFeedItems.values())
  console.log('[feed] [getFeedItemsBySchemaName] Completed feed retrieval:', {
    schemaName,
    feedItemsCount: feedItems.length,
    assembledFeedItemsSize: assembledFeedItems.size,
    feedItemKeys: feedItems.map((item) => Object.keys(item)),
  })

  return feedItems
}
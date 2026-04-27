import {
  getSeedsBySchemaName,
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  EasClient,
  setSchemaUidForSchemaDefinition,
  withExcludeRevokedFilter,
  pickLatestPropertyAttestationsByRefAndSchema,
} from '@seedprotocol/sdk';
import { getArweaveUrlForTransaction } from './utils/arweaveUrl';
import { gql } from 'graphql-request';
import { loadFeedConfig } from './config';
import {
  publicListRelationPropertyKey,
  stripListRelationStorageAliasesForPublicKey,
  tryCoerceJsonStringArray,
} from './listRelationKey';
import { enrichImageSeedCloneForFeed } from './imageRelationEnrichment';
import { hydrateArweaveRichTextInFeedItems } from './hydrateArweaveRichText';
import { parseEasPropertyMetadataForFeed } from './parseEasPropertyMetadataForFeed';
import {
  setFeedFieldStorageModel,
  setFeedListElementStorageModels,
} from './feedFieldStorageModel';

const IMAGE_SCHEMA = 'image';

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
];

const GET_SEEDS = gql`
  query GetSeeds($where: AttestationWhereInput!, $take: Int, $skip: Int) {
    itemSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }], take: $take, skip: $skip) {
      id
      decodedDataJson
      attester
      schema {
        schemaNames {
          name
        }
      }
      refUID
      revoked
      schemaId
      timeCreated
      isOffchain
    }
  }
`;

interface AttestationLike {
  id: string;
  decodedDataJson: string;
  refUID: string;
  schemaId: string;
  timeCreated: number;
  attester?: string;
  schema?: { schemaNames?: Array<{ name: string }> };
}

type SetFeedItemDefaultsOptions = {
  itemUrlBase?: string;
  itemUrlPath: string;
  siteUrl: string;
};

// Helper to convert snake_case to camelCase
const toCamelCase = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

// Helper to format timestamp as RFC 822 date string for RSS pubDate
const formatRfc822Date = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const day = days[date.getUTCDay()];
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const dayNum = date.getUTCDate().toString().padStart(2, '0');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');

  return `${day}, ${dayNum} ${month} ${year} ${hours}:${minutes}:${seconds} GMT`;
};

const getCollectionPath = (schemaName: string): string => {
  return schemaName === 'image' ? 'images' : schemaName === 'post' ? 'posts' : schemaName.toLowerCase() + 's';
};

// Inlined from SDK - parses relation property names like "author_id" -> { propertyName: "authors", modelName: "author", isList: false }
const parseEasRelationPropertyName = (easPropertyName: string): { propertyName: string; modelName: string; isList: boolean } | null => {
  const [singularProperty, modelName, idSegment] = easPropertyName.split('_');
  if (!singularProperty || !modelName) return null;
  const isList = idSegment === 'ids';
  const propertyName = singularProperty.endsWith('s') ? singularProperty : singularProperty + 's';
  return { propertyName, modelName, isList };
};

// Helper to set default values for feed items
const setFeedItemDefaults = (
  item: Record<string, unknown>,
  seedUid: string,
  schemaName: string,
  options: SetFeedItemDefaultsOptions
): void => {
  const { itemUrlBase, itemUrlPath, siteUrl } = options;

  // Set default title if not present (check both snake_case and camelCase)
  if (!item.title && !item.Title) {
    item.title = seedUid;
    item.Title = seedUid;
  } else if (item.title && !item.Title) {
    item.Title = item.title;
  } else if (item.Title && !item.title) {
    item.title = item.Title;
  }

  const storageTransactionIdSnake =
    item.storage_transaction_id &&
    typeof item.storage_transaction_id === 'string' &&
    item.storage_transaction_id.trim() !== '' &&
    item.storage_transaction_id !== 'undefined' &&
    item.storage_transaction_id !== seedUid
      ? (item.storage_transaction_id as string).trim()
      : null;
  const storageTransactionIdCamel =
    item.storageTransactionId &&
    typeof item.storageTransactionId === 'string' &&
    item.storageTransactionId.trim() !== '' &&
    item.storageTransactionId !== 'undefined' &&
    item.storageTransactionId !== seedUid
      ? (item.storageTransactionId as string).trim()
      : null;
  const storageTransactionId = storageTransactionIdSnake || storageTransactionIdCamel;

  const collectionPath = getCollectionPath(schemaName);
  const validSeedUid =
    seedUid && typeof seedUid === 'string' && seedUid.trim() !== '' ? seedUid : 'unknown';

  let defaultLink: string;
  if (storageTransactionId && storageTransactionId !== seedUid && storageTransactionId.length > 0) {
    try {
      defaultLink = getArweaveUrlForTransaction(storageTransactionId);
    } catch (error) {
      console.error('[feed] [setFeedItemDefaults] Error generating Arweave URL:', error);
      if (itemUrlBase != null) {
        defaultLink = `${itemUrlBase.replace(/\/$/, '')}/${(itemUrlPath ?? 'attestation/view').replace(/^\//, '')}/${validSeedUid}`;
      } else {
        defaultLink = `${siteUrl.replace(/\/$/, '')}/${collectionPath}/${validSeedUid}`;
      }
    }
  } else {
    if (itemUrlBase != null) {
      defaultLink = `${itemUrlBase.replace(/\/$/, '')}/${(itemUrlPath ?? 'attestation/view').replace(/^\//, '')}/${validSeedUid}`;
    } else {
      defaultLink = `${siteUrl.replace(/\/$/, '')}/${collectionPath}/${validSeedUid}`;
    }
  }

  const currentLink = (item.link || item.Link) as string | undefined;
  if (!currentLink || currentLink === 'undefined' || (typeof currentLink === 'string' && currentLink.trim() === '')) {
    item.link = defaultLink;
    item.Link = defaultLink;
  } else {
    if (!item.link || item.link === 'undefined') {
      item.link = currentLink;
    }
    if (!item.Link || item.Link === 'undefined') {
      item.Link = currentLink;
    }
  }

  const currentGuid = (item.guid || item.Guid) as string | undefined;
  if (!currentGuid || currentGuid === 'undefined' || (typeof currentGuid === 'string' && currentGuid.trim() === '')) {
    item.guid = item.link || defaultLink;
    item.Guid = item.guid;
  } else {
    if (!item.guid || item.guid === 'undefined') {
      item.guid = currentGuid;
    }
    if (!item.Guid || item.Guid === 'undefined') {
      item.Guid = currentGuid;
    }
  }

  if (item.timeCreated && !item.pubDate && !item.PubDate) {
    const pubDate = formatRfc822Date(item.timeCreated as number);
    item.pubDate = pubDate;
    item.PubDate = pubDate;
  } else if (item.pubDate && !item.PubDate) {
    item.PubDate = item.pubDate;
  } else if (item.PubDate && !item.pubDate) {
    item.pubDate = item.PubDate;
  }

  if (!item.seedUid && !item.SeedUid) {
    item.seedUid = seedUid;
    item.SeedUid = seedUid;
  } else if (item.seedUid && !item.SeedUid) {
    item.SeedUid = item.seedUid;
  } else if (item.SeedUid && !item.seedUid) {
    item.seedUid = item.SeedUid;
  }

  if (item.attester && !item.Attester) {
    item.Attester = item.attester;
  } else if (item.Attester && !item.attester) {
    item.attester = item.Attester;
  }
};

const seedUidToModelType = new Map<string, string>();
const relatedSeedUids = new Set<string>();
const versionUidToSeedUid = new Map<string, string>();
const assembledFeedItems = new Map<string, Record<string, unknown>>();
const versionsBySeedUid = new Map<string, AttestationLike[]>();
const latestVersionUidsBySeedUid = new Map<string, string>();

function resetProcessingMaps(): void {
  seedUidToModelType.clear();
  relatedSeedUids.clear();
  versionUidToSeedUid.clear();
  assembledFeedItems.clear();
  versionsBySeedUid.clear();
  latestVersionUidsBySeedUid.clear();
}

const processItemProperty = async (
  property: AttestationLike,
  itemSeeds: AttestationLike[]
): Promise<void> => {
  const parsed = parseEasPropertyMetadataForFeed(property.decodedDataJson);
  if (!parsed.ok) {
    const { id, refUID, schemaId } = property;
    if (parsed.reason === 'empty') {
      console.warn(
        '[feed] [processItemProperty] empty decodedDataJson for property:',
        id,
        refUID,
        schemaId,
      );
    } else if (parsed.reason === 'parse') {
      console.warn(
        '[feed] [processItemProperty] failed to parse decodedDataJson for property:',
        id,
        refUID,
        schemaId,
        parsed.error,
      );
    } else {
      console.warn(
        '[feed] [processItemProperty] invalid decodedDataJson structure for property:',
        id,
        refUID,
        schemaId,
      );
    }
    return;
  }

  const metadata = parsed.metadata;

  let propertyNameSnake = metadata.name;
  if (!propertyNameSnake) {
    return;
  }

  const schemaUid = property.schemaId;
  setSchemaUidForSchemaDefinition({
    text: propertyNameSnake,
    schemaUid,
  });

  let isRelation = false;
  let isList = false;
  const easType = metadata.type;
  const isBytes32Relation =
    (easType === 'bytes32' || easType === 'bytes32[]') &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id';
  const isNamingConventionRelation =
    !isBytes32Relation &&
    (propertyNameSnake.endsWith('_id') || propertyNameSnake.endsWith('_ids')) &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id';

  if (isBytes32Relation || isNamingConventionRelation) {
    isRelation = true;
    if (Array.isArray(metadata.value)) {
      isList = true;
      if (isNamingConventionRelation) {
        const result = parseEasRelationPropertyName(propertyNameSnake);
        if (result) {
          propertyNameSnake = result.propertyName;
        }
      }
      metadata.value.forEach((value: string) => {
        if (!relationValuesToExclude.includes(value)) relatedSeedUids.add(value);
      });
    } else if (!relationValuesToExclude.includes(metadata.value as string)) {
      relatedSeedUids.add(metadata.value as string);
    }
  }

  let propertyValue: string | string[] = metadata.value as string | string[];
  if (isRelation && isList && Array.isArray(propertyValue)) {
    propertyValue = propertyValue.map((v) => String(v));
  } else if (typeof propertyValue !== 'string') {
    propertyValue = JSON.stringify(propertyValue);
  }

  if (isRelation && !isList) {
    const relatedSeed = itemSeeds.find((seed) => seed.id === metadata.value);
    if (relatedSeed?.schema?.schemaNames) {
      // refSeedType and refSchemaUid used for type resolution - not needed for feed assembly
    }
  }

  if (isRelation && isList) {
    const relatedSeeds = itemSeeds.filter((seed) =>
      Array.isArray(metadata.value) && metadata.value.includes(seed.id)
    );
    if (relatedSeeds.length > 0) {
      // refSeedType and refSchemaUid used for type resolution - not needed for feed assembly
    }
  }

  const seedUidForProperty = versionUidToSeedUid.get(property.refUID);
  if (!seedUidForProperty) {
    return;
  }

  const existingFeedItem = assembledFeedItems.get(seedUidForProperty) || {};
  existingFeedItem[propertyNameSnake] = propertyValue;
  const propertyNameCamel = toCamelCase(propertyNameSnake);
  if (propertyNameCamel !== propertyNameSnake) {
    existingFeedItem[propertyNameCamel] = propertyValue;
  }
  assembledFeedItems.set(seedUidForProperty, existingFeedItem);
};

const processSeeds = async (seeds: AttestationLike[]): Promise<void> => {
  const seedUids = seeds.map((seed) => seed.id);

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    if (!seed) continue;
    seedUids.push(seed.id);
    const modelType = seed.schema?.schemaNames?.[0]?.name ?? 'unknown';
    seedUidToModelType.set(seed.id, modelType);

    if (!assembledFeedItems.has(seed.id)) {
      assembledFeedItems.set(seed.id, {
        seedUid: seed.id,
        timeCreated: seed.timeCreated,
        attester: seed.attester,
      });
    }
  }

  const itemVersions = await getItemVersionsFromEas({ seedUids });

  for (let i = 0; i < itemVersions.length; i++) {
    const itemVersion = itemVersions[i] as AttestationLike;
    const seedUid = itemVersion.refUID;
    versionUidToSeedUid.set(itemVersion.id, seedUid);
    const existingVersions = versionsBySeedUid.get(seedUid) || [];
    versionsBySeedUid.set(seedUid, [...existingVersions, itemVersion]);
  }

  const latestVersionUids: string[] = [];
  for (const [seedUid, versions] of versionsBySeedUid.entries()) {
    const sortedVersions = [...versions].sort((a, b) => b.timeCreated - a.timeCreated);
    const latestVersion = sortedVersions[0];
    if (latestVersion) {
      latestVersionUids.push(latestVersion.id);
      latestVersionUidsBySeedUid.set(seedUid, latestVersion.id);
    }
  }

  const rawProperties = await getItemPropertiesFromEas({ versionUids: latestVersionUids });
  const itemProperties = pickLatestPropertyAttestationsByRefAndSchema(rawProperties);

  for (let i = 0; i < itemProperties.length; i++) {
    await processItemProperty(itemProperties[i] as AttestationLike, seeds);
  }
};

const RESERVED_KEYS = new Set([
  'seedUid',
  'SeedUid',
  'timeCreated',
  'attester',
  'Attester',
  'storage_transaction_id',
  'storage_provider_transaction_id',
  'storageTransactionId',
  'storageProviderTransactionId',
]);

/**
 * Resolves relation properties to Arweave URLs when the related item has a
 * storageTransactionId. Image schema relations are left as UIDs so
 * expandRelationProperties can emit nested seeds with arweaveUrl.
 * Supports optional _id/_ids key normalization for backward compatibility.
 */
function resolveRelationPropertiesToUrls(schemaName: string): void {
  const itemsToProcess = Array.from(assembledFeedItems.entries()).filter(
    ([seedUid]) => seedUidToModelType.get(seedUid) === schemaName
  );

  for (const [, item] of itemsToProcess) {
    const keysToProcess = Object.keys(item).filter(
      (k) => !k.startsWith('_') && !RESERVED_KEYS.has(k)
    );

    for (const key of keysToProcess) {
      let value = item[key];
      const coerced = tryCoerceJsonStringArray(value);
      if (coerced !== value && Array.isArray(coerced)) {
        item[key] = coerced;
        value = coerced;
      }
      const isList = Array.isArray(value);

      if (isList) {
        const uids = value as unknown[];
        const hasRelationUid = uids.some(
          (v) =>
            typeof v === 'string' &&
            !relationValuesToExclude.includes(v) &&
            assembledFeedItems.has(v)
        );
        if (!hasRelationUid) continue;

        const urls: string[] = [];
        const models: string[] = [];
        let resolved = false;
        for (const uid of uids) {
          if (typeof uid !== 'string' || relationValuesToExclude.includes(uid)) {
            urls.push(String(uid));
            models.push('unknown');
            continue;
          }
          const modelForUid = seedUidToModelType.get(uid) ?? 'unknown';
          // Keep Image seed UIDs for expandRelationProperties (nested seed + arweaveUrl).
          if (modelForUid === IMAGE_SCHEMA) {
            urls.push(uid);
            models.push(IMAGE_SCHEMA);
            continue;
          }
          const related = assembledFeedItems.get(uid);
          const txId =
            (related?.storageTransactionId ?? related?.storage_transaction_id) as string | undefined;
          if (txId && typeof txId === 'string' && txId.trim()) {
            try {
              urls.push(getArweaveUrlForTransaction(txId));
              models.push(modelForUid);
              resolved = true;
            } catch {
              urls.push(uid);
              models.push(modelForUid);
            }
          } else {
            urls.push(uid);
            models.push(modelForUid);
          }
        }
        if (resolved) {
          const outputKey = publicListRelationPropertyKey(key);
          item[outputKey] = urls;
          setFeedListElementStorageModels(item, outputKey, models);
          stripListRelationStorageAliasesForPublicKey(item, outputKey);
          if (outputKey !== key) {
            delete item[key];
            const camelKey = toCamelCase(key);
            if (camelKey !== key) delete item[camelKey];
          }
        }
      } else if (typeof value === 'string') {
        if (relationValuesToExclude.includes(value)) continue;
        if (!assembledFeedItems.has(value)) continue;

        const related = assembledFeedItems.get(value);
        // Keep Image seed UIDs for expandRelationProperties (nested seed + arweaveUrl).
        if (seedUidToModelType.get(value) === IMAGE_SCHEMA) {
          continue;
        }
        const txId =
          (related?.storageTransactionId ?? related?.storage_transaction_id) as string | undefined;
        if (txId && typeof txId === 'string' && txId.trim()) {
          try {
            const outputKey = key.endsWith('_id') ? key.replace(/_id$/, '') : key;
            item[outputKey] = getArweaveUrlForTransaction(txId);
            const relatedModel = seedUidToModelType.get(value) ?? 'unknown';
            setFeedFieldStorageModel(item, outputKey, relatedModel);
            const camelOut = toCamelCase(outputKey);
            if (camelOut !== outputKey) {
              setFeedFieldStorageModel(item, camelOut, relatedModel);
            }
            if (outputKey !== key) {
              delete item[key];
              const camelKey = toCamelCase(key);
              if (camelKey !== key) delete item[camelKey];
            }
          } catch {
            // keep original on error
          }
        }
      }
    }
  }
}

/**
 * Expands relation properties to nested objects from assembledFeedItems.
 * Image seeds always expand (with arweaveUrl enrichment when storage exists).
 * Other relations skip expansion when the target has storage (already URL-resolved).
 */
function expandRelationProperties(
  schemaName: string,
  options: SetFeedItemDefaultsOptions,
  expandRelations: boolean
): void {
  if (!expandRelations) return;

  const itemsToProcess = Array.from(assembledFeedItems.entries()).filter(
    ([seedUid]) => seedUidToModelType.get(seedUid) === schemaName
  );

  for (const [, item] of itemsToProcess) {
    const keysToProcess = Object.keys(item).filter(
      (k) => !k.startsWith('_') && !RESERVED_KEYS.has(k)
    );

    for (const key of keysToProcess) {
      let value = item[key];
      const coerced = tryCoerceJsonStringArray(value);
      if (coerced !== value && Array.isArray(coerced)) {
        item[key] = coerced;
        value = coerced;
      }
      const isList = Array.isArray(value);
      const uids = isList ? (value as unknown[]) : [value];

      const expanded: unknown[] = [];
      let didExpand = false;

      for (const uid of uids) {
        if (typeof uid !== 'string' || relationValuesToExclude.includes(uid)) {
          expanded.push(uid);
          continue;
        }
        const related = assembledFeedItems.get(uid);
        if (!related) {
          expanded.push(uid);
          continue;
        }
        const txId =
          (related?.storageTransactionId ?? related?.storage_transaction_id) as string | undefined;
        const isImage = seedUidToModelType.get(uid) === IMAGE_SCHEMA;

        if (isImage) {
          const relatedSchema = seedUidToModelType.get(uid) ?? 'unknown';
          const clone = { ...related } as Record<string, unknown>;
          setFeedItemDefaults(clone, uid, relatedSchema, options);
          enrichImageSeedCloneForFeed(clone);
          expanded.push(clone);
          didExpand = true;
          continue;
        }

        // Non-image: skip expansion when related has storage (URL resolution already ran for non-images)
        if (txId && typeof txId === 'string' && txId.trim()) {
          expanded.push(uid);
          continue;
        }
        const relatedSchema = seedUidToModelType.get(uid) ?? 'unknown';
        const clone = { ...related } as Record<string, unknown>;
        setFeedItemDefaults(clone, uid, relatedSchema, options);
        expanded.push(clone);
        didExpand = true;
      }

      if (didExpand) {
        const outputKey = isList
          ? publicListRelationPropertyKey(key)
          : key.endsWith('_id')
            ? key.replace(/_id$/, '')
            : key;
        item[outputKey] = isList ? expanded : expanded[0];
        stripListRelationStorageAliasesForPublicKey(item, outputKey);
        if (outputKey !== key) {
          delete item[key];
          const camelKey = toCamelCase(key);
          if (camelKey !== key) delete item[camelKey];
        }
      }
    }
  }
}

async function processSeedsToFeedItems(
  schemaName: string,
  seeds: AttestationLike[],
  expandRelations: boolean
): Promise<Record<string, unknown>[]> {
  resetProcessingMaps();

  await processSeeds(seeds);

  const easClient = EasClient.getEasClient();
  const relatedSeedUidsArray = Array.from(relatedSeedUids);
  const { itemSeeds: relatedSeeds } = await easClient.request(GET_SEEDS, {
    where: withExcludeRevokedFilter({
      id: {
        in: relatedSeedUidsArray,
      },
    }),
    take: relatedSeedUidsArray.length || 1,
    skip: 0,
  });

  await processSeeds((relatedSeeds ?? []) as AttestationLike[]);

  resolveRelationPropertiesToUrls(schemaName);

  const feedConfig = loadFeedConfig();
  const setFeedItemDefaultsOptions: SetFeedItemDefaultsOptions = {
    itemUrlBase: feedConfig.itemUrlBase,
    itemUrlPath: feedConfig.itemUrlPath,
    siteUrl: feedConfig.siteUrl,
  };

  expandRelationProperties(
    schemaName,
    setFeedItemDefaultsOptions,
    expandRelations
  );

  const items = Array.from(assembledFeedItems.entries())
    .filter(([seedUid]) => seedUidToModelType.get(seedUid) === schemaName)
    .map(([, item]) => {
      const seedUid = (item.seedUid || item.SeedUid) as string;
      setFeedItemDefaults(item, seedUid, schemaName, setFeedItemDefaultsOptions);
      return item;
    });

  await hydrateArweaveRichTextInFeedItems(items);

  return items;
}

export const getFeedItemsBySchemaName = async (
  schemaName: string,
  options?: { limit?: number; skip?: number }
): Promise<Record<string, unknown>[]> => {
  const feedConfig = loadFeedConfig();
  const limit = options?.limit ?? 100;
  const skip = options?.skip ?? 0;

  const seeds = (await getSeedsBySchemaName(schemaName, limit, skip)) as AttestationLike[];
  const items = await processSeedsToFeedItems(schemaName, seeds, feedConfig.expandRelations !== false);
  return items;
};

export const getFeedItemsBySchemaNameForMonth = async (
  schemaName: string,
  year: number,
  month: number
): Promise<Record<string, unknown>[]> => {
  const feedConfig = loadFeedConfig();
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);
  const startTs = Math.floor(startDate.getTime() / 1000);
  const endTs = Math.floor(endDate.getTime() / 1000) + 1;

  const where = withExcludeRevokedFilter({
    AND: [
      {
        schema: {
          is: {
            schemaNames: {
              some: {
                name: { equals: schemaName },
              },
            },
          },
        },
      },
      {
        timeCreated: { gte: startTs, lt: endTs },
      },
    ],
  });

  const easClient = EasClient.getEasClient();
  const { itemSeeds } = await easClient.request(GET_SEEDS, {
    where,
    take: 1000,
    skip: 0,
  });

  const seeds = (itemSeeds ?? []) as AttestationLike[];
  return processSeedsToFeedItems(schemaName, seeds, feedConfig.expandRelations !== false);
};

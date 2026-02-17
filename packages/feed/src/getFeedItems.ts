import {
  getSeedsBySchemaName,
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  EasClient,
  setSchemaUidForSchemaDefinition,
  getArweaveUrlForTransaction,
} from '@seedprotocol/sdk';
import { gql } from 'graphql-request';
import { loadFeedConfig } from './config';

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
];

const GET_SEEDS = gql`
  query GetSeeds($where: AttestationWhereInput!, $take: Int) {
    itemSeeds: attestations(where: $where, orderBy: [{ timeCreated: desc }], take: $take) {
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
};

const seedUidToModelType = new Map<string, string>();
const relatedSeedUids = new Set<string>();
const versionUidToSeedUid = new Map<string, string>();
const assembledFeedItems = new Map<string, Record<string, unknown>>();
const versionsBySeedUid = new Map<string, AttestationLike[]>();
const latestVersionUidsBySeedUid = new Map<string, string>();

const processItemProperty = async (
  property: AttestationLike,
  itemSeeds: AttestationLike[]
): Promise<void> => {
  let metadata: { name: string; value: string | string[] };
  try {
    metadata = JSON.parse(property.decodedDataJson)[0].value;
  } catch (error) {
    console.error('[feed] [processItemProperty] Error parsing metadata:', error);
    return;
  }

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
  if (
    (propertyNameSnake.endsWith('_id') || propertyNameSnake.endsWith('_ids')) &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'
  ) {
    isRelation = true;
    if (Array.isArray(metadata.value)) {
      isList = true;
      const result = parseEasRelationPropertyName(propertyNameSnake);
      if (result) {
        propertyNameSnake = result.propertyName;
      }
      metadata.value.forEach((value: string) => {
        relatedSeedUids.add(value);
      });
    }
    if (!isList) {
      if (!relationValuesToExclude.includes(metadata.value as string)) {
        relatedSeedUids.add(metadata.value as string);
      }
    }
  }

  let propertyValue = metadata.value;
  if (typeof propertyValue !== 'string') {
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

  const itemProperties = await getItemPropertiesFromEas({ versionUids: latestVersionUids });

  for (let i = 0; i < itemProperties.length; i++) {
    await processItemProperty(itemProperties[i] as AttestationLike, seeds);
  }
};

export const getFeedItemsBySchemaName = async (schemaName: string): Promise<Record<string, unknown>[]> => {
  const feedConfig = loadFeedConfig();
  const easClient = EasClient.getEasClient();

  const seeds = (await getSeedsBySchemaName(schemaName)) as AttestationLike[];
  await processSeeds(seeds);

  const relatedSeedUidsArray = Array.from(relatedSeedUids);
  const { itemSeeds: relatedSeeds } = await easClient.request(GET_SEEDS, {
    where: {
      id: {
        in: relatedSeedUidsArray,
      },
    },
  });

  await processSeeds((relatedSeeds ?? []) as AttestationLike[]);

  const setFeedItemDefaultsOptions: SetFeedItemDefaultsOptions = {
    itemUrlBase: feedConfig.itemUrlBase,
    itemUrlPath: feedConfig.itemUrlPath,
    siteUrl: feedConfig.siteUrl,
  };

  const feedItems = Array.from(assembledFeedItems.entries())
    .filter(([seedUid]) => seedUidToModelType.get(seedUid) === schemaName)
    .map(([, item]) => {
      const seedUid = (item.seedUid || item.SeedUid) as string;
      setFeedItemDefaults(item, seedUid, schemaName, setFeedItemDefaultsOptions);
      return item;
    });

  return feedItems;
};

import { db, PublishItemData, VersionToPublish, } from '~/db'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:versions',)

export const getVersionsToPublish = async (seedsToCreate: PublishItemData[],): Promise<VersionToPublish[]> => {
  const versionsToPublish: VersionToPublish[] = []

  for (const seedToCreate of seedsToCreate) {

    const latestVersion = await db.table(seedToCreate.versionTableName!,).filter(
      (version,) => version[seedToCreate.idProperty!] === seedToCreate.seedLocalId,
    ).reverse().sortBy('createdAt',).then((versions,) => versions[0] || undefined,)

    if (!latestVersion) {
      throw new Error(`No latest version found for ${seedToCreate.modelName} with ${seedToCreate.idProperty} ${seedToCreate.seedLocalId}`,)
    }

    versionsToPublish.push({
      modelName         : seedToCreate.modelName!,
      propertySchemaUid : seedToCreate.propertySchemaUid,
      seedSchemaUid     : seedToCreate.seedSchemaUid,
      seedLocalId       : seedToCreate.seedLocalId,
      seedUid           : seedToCreate.seedUid,
      versionTableName  : seedToCreate.versionTableName,
      versionLocalId    : latestVersion.localId,
      seedTableName     : seedToCreate.seedTableName,
    },)
  }

  return versionsToPublish
}

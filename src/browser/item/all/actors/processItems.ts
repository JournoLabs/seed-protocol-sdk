import { EventObject, fromCallback } from 'xstate'
import { itemMachineAll } from '@/browser/item/all/itemMachineAll'
import { Attestation } from '@/browser/gql/graphql'
import { eventEmitter } from '@/eventBus'

export const processItems = fromCallback<EventObject, typeof itemMachineAll>(
  ({ sendBack, input: { context } }) => {
    const {
      itemVersions,
      itemSeeds,
      ModelClass,
      schemaUidsByModelName,
      mostRecentPropertiesBySeedUid,
      times,
      // relatedProperties,
      // relatedVersionsBySchemaUid,
      // relatedVersionsBySeedUid,
    } = context

    if (!itemVersions || !itemSeeds) {
      throw new Error('No itemVersions or itemSeeds found')
    }

    const _processItems = async () => {
      // For each itemSeed, find all the Versions
      for (const itemSeed of itemSeeds.slice(8, 16)) {
        const versionsForSeed = itemVersions.filter(
          (version) => version.refUID === itemSeed.id,
        )

        if (versionsForSeed.length === 0) {
          continue
        }

        // Find the most recent Version for each Seed
        const recentVersionsMap: { [seedId: string]: Attestation } = {}
        versionsForSeed.forEach((version: Attestation) => {
          const existingVersion = recentVersionsMap[version.refUID]
          if (
            !existingVersion ||
            new Date(version.timeCreated * 1000) >
              new Date(existingVersion.timeCreated * 1000)
          ) {
            recentVersionsMap[version.refUID] = version
          }
        })
      }
    }

    _processItems().then(() => {
      sendBack({ type: 'processItemsSuccess' })
      const modelName = ModelClass.originalConstructor.name
      eventEmitter.emit('item.requestAll', {
        modelName,
      })
      eventEmitter.emit('service.save', {
        modelName,
      })
      sendBack({
        type: 'updateTimes',
        times: {
          ...times,
          processItems: {
            start: null,
            end: Date.now(),
          },
        },
      })
    })
  },
)

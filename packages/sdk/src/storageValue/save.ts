import { EventObject, fromCallback } from 'xstate'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { INTERNAL_STORAGE_MODEL_FILE_IDS, ImageSize } from '@/helpers/constants'
import { notifyFileSaved } from '@/helpers/tabEvents'
import { generateId } from '@/helpers/generateId'
import { toMetadataPropertyName } from '@/helpers/metadataPropertyNames'
import { lookupPropertySchemaUid } from '@/helpers/propertySchemaUid'
import { beginPropertyWrite, propertyWriteKey, type PropertyWriteTicket } from '@/helpers/propertyWriteTickets'
import { resolveNewSeedFields } from '@/db/write/createSeed'
import { writeStorageValue } from '@/ItemProperty/service/actors/saveValueToDb/storageValue'
import type { FromCallbackInput } from '@/types/machines'
import type { PropertyMachineContext, SaveValueToDbEvent } from '@/types/property'
import { STORAGE_SUBDIR, stageStorageContent, storageFileName, type StorageKind } from './content'

const DATA_TYPE: Record<StorageKind, 'Image' | 'File' | 'Html'> = { image: 'Image', file: 'File', html: 'Html' }

const FS_READY_TIMEOUT_MS = 10_000
const RESIZE_TIMEOUT_MS = 8_000

/** Waits for the client to set up the file system (a save can start while it still loads). */
async function waitForFileSystem(): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      BaseFileManager.getWorkingDir()
      return
    } catch (error) {
      if (Date.now() - start >= FS_READY_TIMEOUT_MS) {
        throw new Error(
          `File system not initialized. Ensure the client has finished loading before saving files. (${(error as Error)?.message})`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

/**
 * Sized versions for display (Image only). The original is already stored, so a resize that fails
 * (Node has no resizer) or hangs (a browser worker) doesn't fail the save.
 */
async function resizeImage(filePath: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => {
        for (const size of [ImageSize.EXTRA_SMALL, ImageSize.SMALL, ImageSize.MEDIUM, ImageSize.LARGE, ImageSize.EXTRA_LARGE]) {
          await BaseFileManager.resizeImage({ filePath, width: size, height: size })
        }
      })(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RESIZE_TIMEOUT_MS)
      }),
    ])
  } catch {
    // Resize not implemented in this environment; the original is saved
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Saves an Image, File or Html value (ADR 0019 "Storage values"): stages the assigned value as
 * content, names a new storage seed and its file after one id, writes the file at its final path,
 * appends the `storage` op that creates the seed and points the property's row at it, and waits
 * for it to apply. Returns the context update, or undefined when a newer value superseded this one
 * (its save sets the context).
 *
 * The row's schema uid is the property's own: the context's when it has one that isn't the storage
 * model's uid, else the one EAS has for the property's definition.
 */
export async function saveStorageValue(
  kind: StorageKind,
  context: PropertyMachineContext,
  newValue: unknown,
  ticket: PropertyWriteTicket | undefined,
): Promise<Partial<PropertyMachineContext> | undefined> {
  const { propertyName: key, propertyRecordSchema, seedLocalId, seedUid, versionLocalId, versionUid, modelName } = context
  if (!key) throw new Error('propertyName is required')
  const propertyName = toMetadataPropertyName(key, DATA_TYPE[kind])

  await waitForFileSystem()
  const content = await stageStorageContent(kind, newValue)

  // Named now so the file can be named after it; the seed row is written when the op applies
  const storageSeedLocalId = generateId()
  const subdir = STORAGE_SUBDIR[kind]
  const fileName = storageFileName(kind, storageSeedLocalId, content)
  const filePath = BaseFileManager.getFilesPath(subdir, fileName)
  if (content.kind !== 'existing') {
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath(subdir))
    // Copied into an ArrayBuffer of this realm: one from fetch() or a File may come from another,
    // which the file managers' `instanceof ArrayBuffer` refuses
    const data = content.kind === 'bytes' ? new Uint8Array(content.data).slice().buffer : content.data
    await BaseFileManager.saveFile(filePath, data)
    notifyFileSaved(filePath)
  }

  // Image and File show a session URL (blob: in browsers, file:// in Node), kept in the context
  // only: stored, it is dead after a reload. Html shows its text.
  const displayUrl = kind === 'html' ? undefined : await BaseFileManager.getContentUrlFromPath(filePath)

  const seedFields = await resolveNewSeedFields(kind)
  const storageModelUid = seedFields.schemaUid ?? undefined
  const schemaUid =
    context.schemaUid && context.schemaUid !== storageModelUid
      ? context.schemaUid
      : await lookupPropertySchemaUid(propertyName, propertyRecordSchema as Parameters<typeof lookupPropertySchemaUid>[1])

  const localStorageDir = `/${subdir}`
  const written = await writeStorageValue(
    { seedLocalId, seedUid, propertyName },
    {
      storageSeed: {
        localId: storageSeedLocalId,
        type: kind,
        modelFileId: INTERNAL_STORAGE_MODEL_FILE_IDS[kind],
        fields: seedFields,
      },
      // A reference to a file that was already there isn't this value's to delete
      ownedFilePath: content.kind === 'existing' ? undefined : filePath,
      row: {
        seedUid,
        versionLocalId,
        versionUid,
        modelName,
        schemaUid,
        refModelUid: storageModelUid,
        refResolvedValue: fileName,
        localStorageDir,
      },
      propertyRecordSchema,
    },
    ticket,
  )
  if (written.skipped) return undefined

  if (kind === 'image' && content.kind !== 'existing') await resizeImage(filePath)

  return {
    localId: context.localId,
    ...written.row,
    propertyValue: storageSeedLocalId,
    refSeedType: kind,
    renderValue: content.kind === 'text' && kind === 'html' ? content.data : displayUrl,
    refResolvedDisplayValue: displayUrl,
    refResolvedValue: fileName,
    localStorageDir,
    easDataType: 'bytes32',
    schemaUid,
  }
}

/**
 * The machine actor for one kind (`saveImage`, `saveFile`, `saveHtml`): runs saveStorageValue and
 * reports `save<Kind>Success` or `save<Kind>Error`.
 */
export function storageSaveActor(kind: StorageKind) {
  const eventPrefix = `save${DATA_TYPE[kind]}`
  return fromCallback<EventObject, FromCallbackInput<PropertyMachineContext, SaveValueToDbEvent>>(
    ({ sendBack, input: { context, event } }) => {
      // Taken when the save starts: a newer save of the property makes this one drop its value
      const writeKey = propertyWriteKey(context.seedLocalId ?? context.seedUid, context.propertyName)
      const ticket = writeKey ? beginPropertyWrite(writeKey) : undefined
      saveStorageValue(kind, context, event?.newValue, ticket)
        .then((update) => {
          if (update) sendBack({ type: 'updateContext', ...update })
        })
        .finally(() => ticket?.end())
        .then(() => sendBack({ type: `${eventPrefix}Success` }))
        .catch((error) => sendBack({ type: `${eventPrefix}Error`, error }))
    },
  )
}

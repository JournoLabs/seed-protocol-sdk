import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { ImageSize } from '@/helpers/constants'
import { notifyFileSaved } from '@/helpers/tabEvents'
import { lookupPropertySchemaUid } from '@/helpers/propertySchemaUid'
import { resolveNewSeedFields, type NewSeedFields } from '@/db/write/createSeed'
import type { OutboxOp } from '@/outbox/outbox'
import type { StorageValueOp } from '@/outbox/itemAppliers'
import { STORAGE_SUBDIR, stageStorageContent, storageFileName, type StorageContent } from './content'
import { deleteStagedFile, requireStagedFile } from './stage'

const FS_READY_TIMEOUT_MS = 10_000
const RESIZE_TIMEOUT_MS = 8_000

/** Waits for the client to set up the file system (a drain can start while it still loads). */
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
 * (Node has no resizer) or hangs (a browser worker) changes nothing.
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

/** What preparing a storage op (Html, File, Image) found and wrote, for its applier. */
export type PreparedStorageValue = {
  fileName: string
  /** The file written for this value; absent when the value named a file already there. */
  ownedFilePath?: string
  fields: NewSeedFields
  schemaUid?: string | null
  /** The storage model's EAS schema uid. */
  refModelUid?: string | null
}

/** The assigned content of a storage op: its string source, or the bytes in its staged file. */
async function stagedContent(op: OutboxOp, value: StorageValueOp): Promise<StorageContent> {
  const kind = value.storageSeed.type
  const stage = value.stage!
  if (stage.source !== undefined) return stageStorageContent(kind, stage.source)
  if (!op.valueRef) throw new Error(`Storage op ${op.opId} has no staged value`)
  await requireStagedFile(op.valueRef)
  const data = await (await BaseFileManager.readFile(op.valueRef)).arrayBuffer()
  return { kind: 'bytes', data, mimeType: stage.mimeType, sourceName: stage.sourceName }
}

/**
 * Stages a storage op's value (ADR 0019 "Storage values"), before its transaction: turns the
 * assigned value into content (fetching a URL, reading the staged bytes), writes the file at its
 * final path, named after the new storage seed, and resolves the seed's fields and the row's schema
 * uid. The row's schema uid is the property's own: the op's when it has one that isn't the storage
 * model's uid, else the one EAS has for the property's definition.
 */
export async function prepareStorageValue(op: OutboxOp, value: StorageValueOp): Promise<PreparedStorageValue> {
  const kind = value.storageSeed.type
  await waitForFileSystem()
  const content = await stagedContent(op, value)
  const fileName = storageFileName(kind, value.storageSeed.localId, content)
  const subdir = STORAGE_SUBDIR[kind]
  const filePath = BaseFileManager.getFilesPath(subdir, fileName)
  if (content.kind !== 'existing') {
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath(subdir))
    // Copied into an ArrayBuffer of this realm: one from fetch() or a File may come from another,
    // which the file managers' `instanceof ArrayBuffer` refuses
    const data = content.kind === 'bytes' ? new Uint8Array(content.data).slice().buffer : content.data
    await BaseFileManager.saveFile(filePath, data)
    notifyFileSaved(filePath)
  }

  const fields = value.storageSeed.fields ?? (await resolveNewSeedFields(kind))
  const storageModelUid = fields.schemaUid ?? undefined
  const rowSchemaUid = value.row?.schemaUid
  const schemaUid =
    rowSchemaUid && rowSchemaUid !== storageModelUid
      ? rowSchemaUid
      : await lookupPropertySchemaUid(
          op.propertyName ?? '',
          value.propertyRecordSchema,
        )
  return {
    fileName,
    ...(content.kind !== 'existing' && { ownedFilePath: filePath }),
    fields,
    schemaUid: schemaUid ?? null,
    refModelUid: storageModelUid ?? null,
  }
}

/** After a storage op applied: drops its staged bytes and makes an Image's sized versions (not awaited). */
export async function afterStorageValueApplied(
  op: OutboxOp,
  value: StorageValueOp,
  prepared: PreparedStorageValue | undefined,
): Promise<void> {
  await deleteStagedFile(op.valueRef)
  if (value.storageSeed.type === 'image' && prepared?.ownedFilePath) void resizeImage(prepared.ownedFilePath)
}

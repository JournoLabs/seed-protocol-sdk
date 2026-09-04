import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { startCase } from 'lodash-es'
import type {
  AttestationLike,
  QueryDataSource,
} from '@seedprotocol/query'
import { isValidEasAttestationUid } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { seeds, versions, metadata } from '@/seedSchema'
import { models } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'

function msToUnixSeconds(ms: number | null | undefined): number {
  if (ms == null || !Number.isFinite(ms)) return 0
  // Heuristic: values already in seconds are small; ms are large
  if (ms > 1e12) return Math.floor(ms / 1000)
  if (ms > 1e10) return Math.floor(ms / 1000)
  return Math.floor(ms)
}

function toSnakeCaseName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function parsePropertyValue(raw: string | null | undefined): unknown {
  if (raw == null) return ''
  const t = raw.trim()
  if (
    (t.startsWith('[') && t.endsWith(']')) ||
    (t.startsWith('{') && t.endsWith('}'))
  ) {
    try {
      return JSON.parse(t)
    } catch {
      return raw
    }
  }
  return raw
}

function attestationFromRaw(raw: string | null | undefined): AttestationLike | null {
  if (!raw || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as AttestationLike
    if (parsed && typeof parsed.id === 'string') return parsed
  } catch {
    // fall through
  }
  return null
}

function seedRowToAttestation(row: {
  uid: string | null
  schemaUid: string | null
  type: string | null
  publisher: string | null
  attestationRaw: string | null
  attestationCreatedAt: number | null
  schemaName?: string | null
}): AttestationLike | null {
  if (!row.uid || !isValidEasAttestationUid(row.uid)) return null
  const fromRaw = attestationFromRaw(row.attestationRaw)
  if (fromRaw) {
    const schemaName =
      row.schemaName ??
      fromRaw.schema?.schemaNames?.[0]?.name ??
      row.type ??
      'unknown'
    return {
      ...fromRaw,
      id: row.uid,
      schema: {
        schemaNames: [{ name: schemaName }],
      },
      timeCreated:
        fromRaw.timeCreated ||
        msToUnixSeconds(row.attestationCreatedAt),
      attester: fromRaw.attester ?? row.publisher ?? undefined,
      schemaId: fromRaw.schemaId || row.schemaUid || '',
    }
  }

  const schemaName = row.schemaName ?? row.type ?? 'unknown'
  return {
    id: row.uid,
    decodedDataJson: '',
    refUID: '0x0000000000000000000000000000000000000000000000000000000000000000',
    schemaId: row.schemaUid || '',
    timeCreated: msToUnixSeconds(row.attestationCreatedAt),
    attester: row.publisher ?? undefined,
    schema: { schemaNames: [{ name: schemaName }] },
  }
}

function versionRowToAttestation(row: {
  uid: string | null
  seedUid: string | null
  publisher: string | null
  attestationRaw: string | null
  attestationCreatedAt: number | null
}): AttestationLike | null {
  if (!row.uid || !isValidEasAttestationUid(row.uid)) return null
  if (!row.seedUid) return null
  const fromRaw = attestationFromRaw(row.attestationRaw)
  if (fromRaw) {
    return {
      ...fromRaw,
      id: row.uid,
      refUID: row.seedUid,
      timeCreated:
        fromRaw.timeCreated ||
        msToUnixSeconds(row.attestationCreatedAt),
      attester: fromRaw.attester ?? row.publisher ?? undefined,
    }
  }
  return {
    id: row.uid,
    decodedDataJson: '',
    refUID: row.seedUid,
    schemaId: '',
    timeCreated: msToUnixSeconds(row.attestationCreatedAt),
    attester: row.publisher ?? undefined,
  }
}

function metadataRowToAttestation(row: {
  uid: string | null
  schemaUid: string | null
  propertyName: string | null
  propertyValue: string | null
  easDataType: string | null
  versionUid: string | null
  publisher: string | null
  attestationRaw: string | null
  attestationCreatedAt: number | null
}): AttestationLike | null {
  if (!row.uid || !isValidEasAttestationUid(row.uid)) return null
  if (!row.versionUid) return null

  const fromRaw = attestationFromRaw(row.attestationRaw)
  if (fromRaw) {
    return {
      ...fromRaw,
      id: row.uid,
      refUID: row.versionUid,
      schemaId: fromRaw.schemaId || row.schemaUid || '',
      timeCreated:
        fromRaw.timeCreated ||
        msToUnixSeconds(row.attestationCreatedAt),
      attester: fromRaw.attester ?? row.publisher ?? undefined,
    }
  }

  const name = row.propertyName
    ? toSnakeCaseName(row.propertyName)
    : 'unknown'
  const value = parsePropertyValue(row.propertyValue)
  const type = row.easDataType || 'string'
  return {
    id: row.uid,
    decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
    refUID: row.versionUid,
    schemaId: row.schemaUid || '',
    timeCreated: msToUnixSeconds(row.attestationCreatedAt),
    attester: row.publisher ?? undefined,
  }
}

async function resolveSchemaNameForSeedType(
  appDb: any,
  seedType: string | null,
): Promise<string | null> {
  if (!seedType) return null
  const normalized = startCase(seedType)
  try {
    const schemaRows = await appDb
      .select({ schemaName: schemasTable.name })
      .from(models)
      .innerJoin(modelSchemas, eq(models.id, modelSchemas.modelId))
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
      .where(eq(models.name, normalized))
      .limit(1)
    if (schemaRows[0]?.schemaName) return schemaRows[0].schemaName as string
  } catch {
    // ignore
  }
  return seedType
}

function monthBoundsUnix(year: number, month: number): {
  startTs: number
  endTs: number
} {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59)
  const startTs = Math.floor(startDate.getTime() / 1000)
  const endTs = Math.floor(endDate.getTime() / 1000) + 1
  return { startTs, endTs }
}

async function listPublishedSeedRows(
  schemaName: string,
  opts?: { startTs?: number; endTs?: number },
): Promise<AttestationLike[]> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return []

  const snakeType = schemaName.includes('_')
    ? schemaName
    : schemaName.replace(/([A-Z])/g, (m, i) =>
        i === 0 ? m.toLowerCase() : `_${m.toLowerCase()}`,
      )
  // Prefer exact type match (EAS schema names are usually lowercase singular)
  const typeCandidates = Array.from(
    new Set([schemaName, schemaName.toLowerCase(), snakeType.toLowerCase()]),
  )

  const rows = await appDb
    .select({
      uid: seeds.uid,
      schemaUid: seeds.schemaUid,
      type: seeds.type,
      publisher: seeds.publisher,
      attestationRaw: seeds.attestationRaw,
      attestationCreatedAt: seeds.attestationCreatedAt,
      revokedAt: seeds.revokedAt,
      markedForDeletion: seeds._markedForDeletion,
    })
    .from(seeds)
    .where(
      and(
        inArray(seeds.type, typeCandidates),
        isNotNull(seeds.uid),
        or(isNull(seeds.revokedAt), eq(seeds.revokedAt, 0)),
        or(
          isNull(seeds._markedForDeletion),
          eq(seeds._markedForDeletion, 0),
        ),
      ),
    )
    .orderBy(desc(seeds.attestationCreatedAt))

  const out: AttestationLike[] = []
  for (const row of rows) {
    if (!row.uid || !isValidEasAttestationUid(row.uid)) continue
    // Must have at least one published version
    const versionRows = await appDb
      .select({
        uid: versions.uid,
      })
      .from(versions)
      .where(eq(versions.seedUid, row.uid))
      .orderBy(desc(versions.createdAt))

    const hasPublished = versionRows.some(
      (v: { uid: string | null }) =>
        v.uid && isValidEasAttestationUid(v.uid),
    )
    if (!hasPublished) continue

    const schemaResolved = await resolveSchemaNameForSeedType(appDb, row.type)
    const att = seedRowToAttestation({
      ...row,
      schemaName: schemaResolved === schemaName ? schemaName : (schemaResolved ?? schemaName),
    })
    if (!att) continue
    // Force requested schema name so assembleSeeds filters correctly
    att.schema = { schemaNames: [{ name: schemaName }] }

    if (opts?.startTs != null || opts?.endTs != null) {
      const t = att.timeCreated
      if (opts.startTs != null && t < opts.startTs) continue
      if (opts.endTs != null && t >= opts.endTs) continue
    }
    out.push(att)
  }
  return out
}

/**
 * SDK local QueryDataSource: published Seeds/Versions/metadata from SQLite.
 */
export function createLocalQueryDataSource(): QueryDataSource {
  return {
    kind: 'local',

    async getSeedByUid(seedUid: string): Promise<AttestationLike | null> {
      const appDb = BaseDb.getAppDb()
      if (!appDb || !seedUid) return null

      const rows = await appDb
        .select({
          uid: seeds.uid,
          schemaUid: seeds.schemaUid,
          type: seeds.type,
          publisher: seeds.publisher,
          attestationRaw: seeds.attestationRaw,
          attestationCreatedAt: seeds.attestationCreatedAt,
          revokedAt: seeds.revokedAt,
        })
        .from(seeds)
        .where(eq(seeds.uid, seedUid))
        .limit(1)

      const row = rows[0]
      if (!row?.uid || !isValidEasAttestationUid(row.uid)) return null
      if (row.revokedAt != null && row.revokedAt !== 0) return null

      const schemaName = await resolveSchemaNameForSeedType(appDb, row.type)
      return seedRowToAttestation({ ...row, schemaName })
    },

    async listSeedsBySchemaName(
      schemaName: string,
      opts: { limit: number; skip: number },
    ): Promise<AttestationLike[]> {
      const all = await listPublishedSeedRows(schemaName)
      return all.slice(opts.skip, opts.skip + opts.limit)
    },

    async listSeedsBySchemaNameForMonth(
      schemaName: string,
      year: number,
      month: number,
    ): Promise<AttestationLike[]> {
      const { startTs, endTs } = monthBoundsUnix(year, month)
      return listPublishedSeedRows(schemaName, { startTs, endTs })
    },

    async getVersionsForSeed(seedUid: string): Promise<AttestationLike[]> {
      return this.getVersionsForSeeds([seedUid])
    },

    async getVersionsForSeeds(seedUids: string[]): Promise<AttestationLike[]> {
      const appDb = BaseDb.getAppDb()
      if (!appDb || seedUids.length === 0) return []

      const rows = await appDb
        .select({
          uid: versions.uid,
          seedUid: versions.seedUid,
          publisher: versions.publisher,
          attestationRaw: versions.attestationRaw,
          attestationCreatedAt: versions.attestationCreatedAt,
        })
        .from(versions)
        .where(inArray(versions.seedUid, seedUids))

      const out: AttestationLike[] = []
      for (const row of rows) {
        const att = versionRowToAttestation(row)
        if (att) out.push(att)
      }
      return out
    },

    async getPropertiesForVersionUids(
      versionUids: string[],
    ): Promise<AttestationLike[]> {
      const appDb = BaseDb.getAppDb()
      if (!appDb || versionUids.length === 0) return []

      const rows = await appDb
        .select({
          uid: metadata.uid,
          schemaUid: metadata.schemaUid,
          propertyName: metadata.propertyName,
          propertyValue: metadata.propertyValue,
          easDataType: metadata.easDataType,
          versionUid: metadata.versionUid,
          publisher: metadata.publisher,
          attestationRaw: metadata.attestationRaw,
          attestationCreatedAt: metadata.attestationCreatedAt,
        })
        .from(metadata)
        .where(inArray(metadata.versionUid, versionUids))

      const out: AttestationLike[] = []
      for (const row of rows) {
        const att = metadataRowToAttestation(row)
        if (att) out.push(att)
      }
      return out
    },

    async getSeedsByUids(uids: string[]): Promise<AttestationLike[]> {
      const appDb = BaseDb.getAppDb()
      if (!appDb || uids.length === 0) return []

      const rows = await appDb
        .select({
          uid: seeds.uid,
          schemaUid: seeds.schemaUid,
          type: seeds.type,
          publisher: seeds.publisher,
          attestationRaw: seeds.attestationRaw,
          attestationCreatedAt: seeds.attestationCreatedAt,
          revokedAt: seeds.revokedAt,
        })
        .from(seeds)
        .where(inArray(seeds.uid, uids))

      const out: AttestationLike[] = []
      for (const row of rows) {
        if (row.revokedAt != null && row.revokedAt !== 0) continue
        const schemaName = await resolveSchemaNameForSeedType(appDb, row.type)
        const att = seedRowToAttestation({ ...row, schemaName })
        if (att) out.push(att)
      }
      return out
    },

    async readStorageBody(ref: {
      propertyName: string
      value: unknown
      localPathHint?: string
    }): Promise<string | null> {
      try {
        if (ref.localPathHint) {
          const text = await BaseFileManager.readFileAsString(ref.localPathHint)
          if (text) return text
        }

        // Common layout: html/{name}.html under filesDir
        if (typeof ref.value === 'string') {
          const v = ref.value.trim()
          // Absolute or relative file path already on disk
          if (v.includes('/') && !v.startsWith('http')) {
            try {
              const text = await BaseFileManager.readFileAsString(v)
              if (text) return text
            } catch {
              // try under html/
            }
          }
          const htmlPath = BaseFileManager.getFilesPath('html', v.endsWith('.html') ? v : `${v}.html`)
          try {
            const text = await BaseFileManager.readFileAsString(htmlPath)
            if (text) return text
          } catch {
            // fall through
          }
        }
      } catch {
        return null
      }
      return null
    },
  }
}

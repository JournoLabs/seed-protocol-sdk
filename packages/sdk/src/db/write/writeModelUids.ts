import { inArray } from 'drizzle-orm'
import type { EasModelSchemaMatch } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, modelUids } from '@/seedSchema'

/**
 * Records each model's EAS seed schema uid in `model_uids`, for init and sync alike. Only a match
 * at tier `exact` (`bytes32 <easName>`, what publish writes seeds under) is recorded; looser matches
 * (older SDKs' names) are read from but never written to. Same-named models share one EAS schema,
 * so every `models` row with the name gets the uid, and a uid recorded earlier is replaced.
 */
export const writeModelUids = async (
  matches: readonly EasModelSchemaMatch[],
  db: ReturnType<typeof BaseDb.getAppDb> = BaseDb.getAppDb(),
): Promise<void> => {
  if (!db) return
  const uidByModelName = new Map<string, string>()
  for (const { modelName, schema, tier } of matches) {
    if (tier === 'exact' && !uidByModelName.has(modelName)) uidByModelName.set(modelName, schema.id)
  }
  if (uidByModelName.size === 0) return

  const rows: { id: number; name: string }[] = await db
    .select({ id: modelsTable.id, name: modelsTable.name })
    .from(modelsTable)
    .where(inArray(modelsTable.name, [...uidByModelName.keys()]))
  for (const row of rows) {
    const uid = uidByModelName.get(row.name)!
    try {
      await db
        .insert(modelUids)
        .values({ modelId: row.id, uid })
        .onConflictDoUpdate({ target: modelUids.modelId, set: { uid } })
    } catch (err: unknown) {
      // The model row was deleted meanwhile (test teardown, another tab): nothing to record.
      const e = err as { code?: string; rawCode?: number; cause?: { code?: string; rawCode?: number } }
      const code = e?.code ?? e?.rawCode ?? e?.cause?.code ?? e?.cause?.rawCode
      if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 787) continue
      throw err
    }
  }
}

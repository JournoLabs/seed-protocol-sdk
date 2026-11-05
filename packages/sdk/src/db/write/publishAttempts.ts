import { eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { publishAttempts, type PublishAttemptType } from '@/seedSchema'

/**
 * `sending`: about to send, or sent with no hash yet. `sent`: the hash is known. `landed`: the
 * receipt arrived and recording hasn't finished. `recorded`, `notSent` and `reverted` end an attempt,
 * and so does `abandoned`: the host chose to send again without knowing what happened to this one.
 */
export type PublishAttemptStatus =
  | 'sending'
  | 'sent'
  | 'landed'
  | 'recorded'
  | 'notSent'
  | 'reverted'
  | 'abandoned'

const OPEN_STATUSES: PublishAttemptStatus[] = ['sending', 'sent', 'landed']

export type NewPublishAttempt = Omit<
  PublishAttemptType,
  'seedLocalIds' | 'txHash' | 'status' | 'createdAt' | 'updatedAt'
> & { seedLocalIds: string[] }

const overlaps = (row: PublishAttemptType, seeds: Set<string>): boolean =>
  (JSON.parse(row.seedLocalIds) as string[]).some((id) => seeds.has(id))

/** Open attempts covering any of `seedLocalIds`. `claimPublishAttempt` lets one seed have one. */
export async function findOpenPublishAttempts(seedLocalIds: string[]): Promise<PublishAttemptType[]> {
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('findOpenPublishAttempts: the database is not ready')
  const open: PublishAttemptType[] = await db
    .select()
    .from(publishAttempts)
    .where(inArray(publishAttempts.status, OPEN_STATUSES))
  const seeds = new Set(seedLocalIds)
  return open.filter((row) => overlaps(row, seeds))
}

/**
 * Commits an attempt row before a send, unless an open attempt covers any of its seeds: that one's
 * transaction may have landed, so sending could attest the same seeds twice. The check and the
 * insert are one database transaction.
 * @returns the open attempt in the way, or `undefined` once this one is committed
 * @throws when there is no database, because a send nothing recorded can't be recovered from
 */
export async function claimPublishAttempt(
  attempt: NewPublishAttempt,
): Promise<PublishAttemptType | undefined> {
  if (!BaseDb.getAppDb()) throw new Error('claimPublishAttempt: the database is not ready')
  return BaseDb.transaction(async (tx) => {
    const open: PublishAttemptType[] = await tx
      .select()
      .from(publishAttempts)
      .where(inArray(publishAttempts.status, OPEN_STATUSES))
    const seeds = new Set(attempt.seedLocalIds)
    const blockedBy = open.find((row) => overlaps(row, seeds))
    if (blockedBy) return blockedBy
    const now = Date.now()
    await tx.insert(publishAttempts).values({
      ...attempt,
      seedLocalIds: JSON.stringify(attempt.seedLocalIds),
      status: 'sending',
      createdAt: now,
      updatedAt: now,
    })
    return undefined
  })
}

/**
 * Moves an attempt on, in `db` when given (a transaction). `nonceKey: null` and `entryPoint: null`
 * record that the send went out under a key of the wallet's own, so reconcile doesn't read the
 * attempt's key.
 */
export async function updatePublishAttempt(
  id: string,
  update:
    | { status: PublishAttemptStatus; txHash?: string }
    | { nonceKey: null; entryPoint: null },
  { db = BaseDb.getAppDb() }: { db?: NonNullable<ReturnType<typeof BaseDb.getAppDb>> | null } = {},
): Promise<void> {
  if (!db) throw new Error('updatePublishAttempt: the database is not ready')
  await db
    .update(publishAttempts)
    .set({ ...update, updatedAt: Date.now() })
    .where(eq(publishAttempts.id, id))
}

import { and, eq, isNotNull, ne } from 'drizzle-orm'
import {
  DEFAULT_EAS_CHAIN_ID,
  configureEasReadChain,
  getEasReadChainId,
  isEasReadChainConfigured,
} from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState, seeds } from '@/seedSchema'
import debug from 'debug'

const logger = debug('seedSdk:helpers:localDbChain')

/** appState key recording which EAS chain the local database holds attestations from. */
export const EAS_CHAIN_ID_APP_STATE_KEY = 'easChainId'

/**
 * Databases written before the chain was recorded only ever held Optimism Sepolia data
 * (the only chain the SDK supported then).
 */
const LEGACY_CHAIN_ID = DEFAULT_EAS_CHAIN_ID

type AppDb = ReturnType<typeof BaseDb.getAppDb>

async function readRecordedChainId(appDb: AppDb): Promise<number | undefined> {
  const rows = await appDb
    .select({ value: appState.value })
    .from(appState)
    .where(eq(appState.key, EAS_CHAIN_ID_APP_STATE_KEY))
    .limit(1)
  const parsed = Number(rows[0]?.value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

async function recordChainId(appDb: AppDb, chainId: number): Promise<void> {
  const value = String(chainId)
  await appDb
    .insert(appState)
    .values({ key: EAS_CHAIN_ID_APP_STATE_KEY, value })
    .onConflictDoUpdate({ target: appState.key, set: { value } })
}

async function hasOnChainData(appDb: AppDb): Promise<boolean> {
  const rows = await appDb
    .select({ uid: seeds.uid })
    .from(seeds)
    .where(and(isNotNull(seeds.uid), ne(seeds.uid, '')))
    .limit(1)
  return rows.length > 0
}

/**
 * Chain the local DB holds data from: the recorded one, or Optimism Sepolia for an unrecorded
 * DB that already has attestations. Records the legacy value so later checks are cheap.
 */
async function resolveLocalDbChainId(appDb: AppDb): Promise<number | undefined> {
  const recorded = await readRecordedChainId(appDb)
  if (recorded !== undefined) return recorded
  if (await hasOnChainData(appDb)) {
    await recordChainId(appDb, LEGACY_CHAIN_ID)
    return LEGACY_CHAIN_ID
  }
  return undefined
}

/**
 * Called at SDK init once the DB is ready. Registers the DB's chain with the EAS read side so
 * reads start on that chain even before publish is initialized, and throws when SeedConfig.eas
 * or PublishConfig.chain names a different chain. An empty DB is recorded only when a chain
 * is configured explicitly; otherwise the first sync or publish records it.
 */
export async function loadLocalDbChain(): Promise<void> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return
  const localChainId = await resolveLocalDbChainId(appDb)
  if (localChainId !== undefined) {
    configureEasReadChain('localDb', { chainId: localChainId })
    logger('local DB holds chain %d', localChainId)
    return
  }
  if (isEasReadChainConfigured()) {
    const chainId = getEasReadChainId()
    await recordChainId(appDb, chainId)
    configureEasReadChain('localDb', { chainId })
  }
}

/**
 * Call before writing chain data to the local DB (EAS sync, publish, revoke). Records the
 * current chain on an empty DB; throws when the DB holds data from a different chain.
 */
export async function assertLocalDbChain(): Promise<void> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return
  const chainId = getEasReadChainId()
  const localChainId = await resolveLocalDbChainId(appDb)
  if (localChainId === undefined) {
    await recordChainId(appDb, chainId)
  }
  // Throws with a remediation message when the local chain differs from the configured one.
  configureEasReadChain('localDb', { chainId: localChainId ?? chainId })
}

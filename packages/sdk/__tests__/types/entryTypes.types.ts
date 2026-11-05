/**
 * Compile-time checks that the main entry exports the types its functions take; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 */
import type { ApplyPropertyAttestationUidsParams, UpdateVersionUidProps, PublishRequestRecord } from '@/index'

export function publishRequestRecord(
  version: UpdateVersionUidProps,
  properties: ApplyPropertyAttestationUidsParams,
): PublishRequestRecord {
  return { version, properties }
}

// The return types of exported reads (batch 16 item 37)
import type { FoundSeedRow, PublishAttemptType, ResolvedModelRecord, SyncedPropertyName } from '@/index'
import { findOpenPublishAttempts, findSeedRow, resolveModelRecordByNameOrType, resolveSyncedPropertyName } from '@/index'

export async function returnTypes(): Promise<
  [FoundSeedRow | undefined, PublishAttemptType[], ResolvedModelRecord | undefined, SyncedPropertyName | undefined]
> {
  return [
    await findSeedRow({ uid: '0x' }),
    await findOpenPublishAttempts(['seed1234567']),
    await resolveModelRecordByNameOrType('Post'),
    resolveSyncedPropertyName('title', 'x', {} as never),
  ]
}

// The vite entry exports the type of the plugin's rdfSidecar option (batch 16 item 64)
import type { RdfSidecarOptions, SeedVitePluginOptions } from '@/vite/index'

export const rdfSidecar: RdfSidecarOptions | false | undefined = ({} as SeedVitePluginOptions).rdfSidecar

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

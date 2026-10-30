/**
 * Compile-time checks that the main entry exports the types its functions take; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 */
import type { ApplyPropertyAttestationUidsParams, UpdateVersionUidProps, recordPublishRequest } from '@/index'

export function recordPublishRequestArgs(
  version: UpdateVersionUidProps,
  properties: ApplyPropertyAttestationUidsParams,
): Parameters<typeof recordPublishRequest>[0] {
  return { version, properties }
}

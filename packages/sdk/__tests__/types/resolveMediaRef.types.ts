/**
 * Compile-time checks for ResolveMediaRefResult; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 *
 * `reason` was `string`, so a switch over it couldn't be checked and `'encrypted'` wasn't listed.
 */
import type { ResolveMediaRefReason, ResolveMediaRefResult } from '@/index'

export function reasonIsAUnion(result: ResolveMediaRefResult) {
  if (result.status !== 'unresolved') return
  const encrypted: ResolveMediaRefReason = 'encrypted'
  const reason: ResolveMediaRefReason = result.reason
  switch (reason) {
    case 'encrypted':
    case 'non_media_url':
    case 'seed_local_id_not_portable':
    case 'seed_uid_requires_app_db':
    case 'seed_uid_no_storage_transaction':
    case 'unknown_ref':
      return encrypted
    default: {
      const exhausted: never = reason
      return exhausted
    }
  }
}

export function unknownReasonIsRejected(): ResolveMediaRefResult {
  return {
    status: 'unresolved',
    // @ts-expect-error not one of the reasons resolveMediaRef returns
    reason: 'because',
    classification: { kind: 'empty' },
  }
}

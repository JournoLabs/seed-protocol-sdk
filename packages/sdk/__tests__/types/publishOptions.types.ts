/**
 * Compile-time checks for ItemPublishOptions; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 *
 * `dataItemSigner` fell through to the index signature, so any value type-checked.
 */
import type { ItemPublishOptions } from '@/helpers/publishConfig'

export function dataItemSignerOption() {
  const seedSigner = {
    address: '0x00000000000000000000000000000000000000aa' as `0x${string}`,
    signMessage: async (_args: { message: string | { raw: Uint8Array } }) => '0x' as `0x${string}`,
  }
  const ethersLike = {
    address: '0x00000000000000000000000000000000000000aa',
    signMessage: async (_message: string | Uint8Array) => '0x',
  }
  const withSeedSigner: ItemPublishOptions = { dataItemSigner: seedSigner }
  const withEthers: ItemPublishOptions = { dataItemSigner: ethersLike }
  // @ts-expect-error a data item signer needs an address and signMessage
  const notASigner: ItemPublishOptions = { dataItemSigner: 42 }
  return [withSeedSigner, withEthers, notASigner]
}

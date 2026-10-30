/**
 * Compile-time checks for IItemProperty.save; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 *
 * Code holding an IItemProperty (`useItemProperty().property`) couldn't pass the D30 `timeoutMs` option.
 */
import type { IItemProperty } from '@/interfaces'

export async function saveWithTimeout(property: IItemProperty) {
  await property.save()
  await property.save({ timeoutMs: 5_000 })
  // @ts-expect-error timeoutMs is a number
  await property.save({ timeoutMs: '5s' })
}

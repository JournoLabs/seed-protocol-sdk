/**
 * Compile-time checks for Item.create's props; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 *
 * Property values go in the same object as `modelName`. The parameter type had no room for them,
 * so an object literal with a property key failed the excess-property check.
 */
import { Item } from '@/Item/Item'

export function createWithPropertyValues() {
  return Item.create({ modelName: 'Post', title: 'Hello', wordCount: 3, tags: ['a'] })
}

export function createKeepsItemDataTypes() {
  // @ts-expect-error modelName is a string
  return Item.create({ modelName: 1, title: 'Hello' })
}

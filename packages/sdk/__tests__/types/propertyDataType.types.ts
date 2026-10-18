/**
 * Compile-time checks for PropertyDataType; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 *
 * Schemas written by hand pass plain strings. PropertyDataType used to be built from the
 * ModelPropertyDataTypes enum, so `{ dataType: 'Text' }` failed to type-check although it
 * worked at runtime.
 */
import { ModelPropertyDataTypes } from '@/helpers/property'
import type { PropertyDataType, PropertyType } from '@/types'

export function plainStrings() {
  const text: PropertyDataType = 'Text'
  const property: PropertyType = { dataType: 'Relation', ref: 'Author' }
  const fromEnum: PropertyDataType = ModelPropertyDataTypes.Html
  // @ts-expect-error unknown data types are still rejected
  const unknown: PropertyDataType = 'Txt'
  return [text, property, fromEnum, unknown]
}

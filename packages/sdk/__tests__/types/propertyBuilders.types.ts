/**
 * Compile-time checks for the `Property` builders; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 *
 * `Property` was cast to `PropertyDefs`, which typed every builder as
 * `(string?, string?, string | boolean?)`: `Html` rejected its options object and
 * `List` accepted no arguments.
 */
import { Property } from '@/helpers/property'

export function htmlOptions() {
  const html = Property.Html({ htmlEmbeddedDataUriPolicy: 'preserve' })
  const policy: 'materialize' | 'preserve' | undefined = html.htmlEmbeddedDataUriPolicy
  // @ts-expect-error not a policy
  Property.Html({ htmlEmbeddedDataUriPolicy: 'inline' })
  return policy
}

export function listNeedsElementType() {
  const tags = Property.List('Relation', 'Tag')
  const ref: string | undefined = tags.ref
  // @ts-expect-error refValueType is required
  Property.List()
  return ref
}

export function relationRequired() {
  const author = Property.Relation('Identity', undefined, true)
  const required: boolean | undefined = author.required
  return required
}

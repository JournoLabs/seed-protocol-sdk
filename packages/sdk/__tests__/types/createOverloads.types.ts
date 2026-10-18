/**
 * Compile-time checks for the create() overloads; never executed.
 * Checked by `tsc -p packages/sdk/tsconfig.typetests.json` (part of `bun run test`).
 *
 * create() waits for ready unless options say `waitForReady: false`, so a call with no
 * options must be typed as a Promise. The sync overload used to take optional options and
 * matched it first, typing an unawaited Promise as the instance.
 */
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { ItemProperty } from '@/ItemProperty/ItemProperty'

declare const property: Parameters<typeof ModelProperty.create>[0]

export function schemaCreate() {
  const waited: Promise<Schema> = Schema.create('Blog')
  const waitedExplicit: Promise<Schema> = Schema.create('Blog', { waitForReady: true, readyTimeout: 1 })
  const sync: Schema = Schema.create('Blog', { waitForReady: false })
  // @ts-expect-error create() without waitForReady: false returns a Promise
  const notSync: Schema = Schema.create('Blog')
  return [waited, waitedExplicit, sync, notSync]
}

export function modelCreate() {
  const waited: Promise<Model> = Model.create('Post', 'Blog')
  const waitedWithOptions: Promise<Model> = Model.create('Post', 'Blog', { properties: {} })
  const sync: Model = Model.create('Post', 'Blog', { properties: {}, waitForReady: false })
  // @ts-expect-error create() without waitForReady: false returns a Promise
  const notSync: Model = Model.create('Post', 'Blog', { properties: {} })
  return [waited, waitedWithOptions, sync, notSync]
}

export function modelPropertyCreate() {
  const waited: Promise<ModelProperty> = ModelProperty.create(property)
  const waitedWithOptions: Promise<ModelProperty> = ModelProperty.create(property, { schemaName: 'Blog' })
  const sync: ModelProperty = ModelProperty.create(property, { waitForReady: false, schemaName: 'Blog' })
  // @ts-expect-error create() without waitForReady: false returns a Promise
  const notSync: ModelProperty = ModelProperty.create(property, { schemaName: 'Blog' })
  return [waited, waitedWithOptions, sync, notSync]
}

export function itemPropertyCreate() {
  const waited: Promise<ItemProperty<any> | undefined> = ItemProperty.create({})
  const sync: ItemProperty<any> | undefined = ItemProperty.create({}, { waitForReady: false })
  // @ts-expect-error create() without waitForReady: false returns a Promise
  const notSync: ItemProperty<any> | undefined = ItemProperty.create({})
  return [waited, sync, notSync]
}

import { ImageSrc, List, Model, Relation, Text } from '@/browser/schema'

@Model
class Image {
  @Text() storageTransactionId!: string
  @Text() uri!: string
  @Text() alt!: string
  @ImageSrc() src!: string
}

@Model
class Post {
  @Text() title!: string
  @Text() summary!: string
  @Relation('Image', 'ImageSrc') featureImage!: string
  @Text() html!: string
  @Text() json!: string
  @List('Identity') authors!: string[]
}

@Model
class Identity {
  @Text() name!: string
  @Text() profile!: string
  @Text() displayName!: string
  @Relation('Image', 'ImageSrc') avatarImage!: string
  @Relation('Image', 'ImageSrc') coverImage!: string
}

@Model
class Link {
  @Text() url!: string
  @Text() text!: string
}

const models = {
  Identity,
  Image,
  Link,
  Post,
}

const endpoints = {
  filePaths: '/api/seed/migrations',
  files: '/app-files',
}

export { models, endpoints }

export default { models, endpoints }
import { ImageSrc, List, Model, Relation, Text } from '@/schema'

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
  @Text('ItemStorage', '/html', '.html') html!: string
  @Text('ItemStorage', '/json', '.json') json!: string
  @Text() storageTransactionId!: string
  @List('Identity') authors!: string[]
  @Text() importUrl!: string
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

const arweaveDomain = 'arweave.net'

export { models, endpoints, arweaveDomain }

export default { models, endpoints, arweaveDomain }

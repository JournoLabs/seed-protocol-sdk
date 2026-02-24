import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { Image, List, Model, Relation, Text, Date, Number, Boolean } from '@/Schema'


@Model
class Post {
  @Text() title!: string
  @Text() summary!: string
  @Image() featureImage!: string
  @Text('ItemStorage', '/html', '.html') html!: string
  @Text('ItemStorage', '/json', '.json') json!: string
  @Text() storageTransactionId!: string
  @List('Relation', 'Identity') authors!: string[]
  @Text() importUrl!: string
}

@Model
class Identity {
  @Text() name!: string
  @Text() profile!: string
  @Text() displayName!: string
  @Image() avatarImage!: string
  @Image() coverImage!: string
}

@Model
class Link {
  @Text() url!: string
  @Text() text!: string
}

const models = {
  Identity,
  Link,
  Post,
}

const endpoints = {
  filePaths: '/api/seed/migrations',
  files: '/app-files',
}

const arweaveDomain = DEFAULT_ARWEAVE_HOST

export { models, endpoints, arweaveDomain }

export default { models, endpoints, arweaveDomain } 
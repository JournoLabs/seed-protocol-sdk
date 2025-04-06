import { Image, List, Model, Relation, Text, Date, Number, Boolean } from '@/schema'


@Model
class Post {
  @Text() title!: string
  @Text() summary!: string
  @Image() featureImage!: string
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
  @Image() avatarImage!: string
  @Image() coverImage!: string
}

@Model
class Link {
  @Text() url!: string
  @Text() text!: string
}

@Model
class TestModel {
  @Text() name!: string
  @Date() birthdate!: string
  @Number() age!: number
  @Boolean() isAlive!: boolean
  @List('Text') nicknames!: string[]
  @Relation('TestModel') bestFriend!: string
  @Image() profilePic!: string
}


const models = {
  Identity,
  Link,
  Post,
  TestModel,
}

const endpoints = {
  filePaths: '/api/seed/migrations',
  files: '/app-files',
  localOutputDir: 'seed-files',
}

const arweaveDomain = 'arweave.net'

export { models, endpoints, arweaveDomain }

export default { models, endpoints, arweaveDomain }

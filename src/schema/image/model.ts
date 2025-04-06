import { Model, Text } from '@/schema'

@Model
class Image {
  @Text() storageTransactionId!: string
  @Text() uri!: string
  @Text() alt!: string
  @Text() src!: string
}

export { Image }

import { Model, Text } from '@/schema'

@Model
class Seed {
  @Text() uid!: string
  @Text() type!: string
}

@Model
class Version {
  @Text() seedUid!: string
  @Text() note!: string
}

@Model
class Metadata {
  @Text() key!: string
  @Text() value!: string
}

export const models = {
  Seed,
  Version,
  Metadata,
}

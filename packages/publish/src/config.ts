export interface PublishConfig {
  thirdwebClientId: string
  thirdwebAccountFactoryAddress: string
}

let config: PublishConfig | null = null

export function initPublish(c: PublishConfig): void {
  config = c
}

export function getPublishConfig(): PublishConfig {
  if (!config) {
    throw new Error(
      '@seedprotocol/publish: Call initPublish({ thirdwebClientId, thirdwebAccountFactoryAddress }) before using the package'
    )
  }
  return config
}

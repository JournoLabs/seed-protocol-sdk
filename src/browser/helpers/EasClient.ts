import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'

class EasClient extends BaseEasClient {
}

BaseEasClient.setPlatformClass(EasClient)

export { EasClient }

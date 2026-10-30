import { disconnectPublishWallet } from '../helpers/thirdweb'
import { PublishManager } from '../services/publishManager'

/** `ConnectButton`'s Disconnect: ends the wallet session, then stops running publishes whatever came of that. */
export async function endPublishSession(): Promise<void> {
  try {
    await disconnectPublishWallet()
  } catch (err) {
    console.warn('[ConnectButton] Disconnect failed:', err)
  } finally {
    PublishManager.stopAll()
  }
}

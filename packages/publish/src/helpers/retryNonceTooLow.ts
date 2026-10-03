/** True for "the nonce was already used" rejections, which mean the tx was not accepted. */
export function isNonceTooLowError(err: unknown): boolean {
  const parts: string[] = []
  let cur: unknown = err
  for (let i = 0; cur && i < 5; i++) {
    const e = cur as { message?: unknown; shortMessage?: unknown; details?: unknown; code?: unknown; cause?: unknown }
    parts.push(String(e.message ?? ''), String(e.shortMessage ?? ''), String(e.details ?? ''), String(e.code ?? ''))
    cur = e.cause
  }
  return /nonce too low|nonce has already been used|NONCE_EXPIRED|nonce.*already.*(used|known)|lower than the current nonce/i.test(parts.join(' '))
}

/**
 * Retries `send` when the node rejects it for a stale nonce. A local fork's pending-nonce lookup
 * can trail the chain by a block, so back-to-back sends from one EOA may pick a used nonce.
 * Such a rejection means nothing was sent, so retrying cannot double-send.
 */
export async function retryNonceTooLow<T>(
  send: () => Promise<T>,
  { attempts = 3, delayMs = 1000 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send()
    } catch (err) {
      if (attempt >= attempts || !isNonceTooLowError(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

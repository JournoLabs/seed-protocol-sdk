/**
 * Minimal Turbo (ArDrive) client for user-paid storage: balances, prices, and uploads of data
 * items the user's EVM key already signed. Raw HTTP rather than @ardrive/turbo-sdk, which would
 * bring its own signers and a large dependency tree for four calls.
 */

import { computeAddress, hexlify } from 'ethers'

export type TurboEndpoints = { uploadUrl: string; paymentUrl: string }

/** Turbo credits are denominated in winc (winston credits), like AR winston. */
export class InsufficientStorageCreditsError extends Error {
  readonly address: string
  readonly requiredWinc: bigint | undefined
  readonly balanceWinc: bigint | undefined

  constructor(params: { address: string; requiredWinc?: bigint; balanceWinc?: bigint; detail?: string }) {
    const amounts =
      params.requiredWinc !== undefined && params.balanceWinc !== undefined
        ? ` (needs ${params.requiredWinc} winc, has ${params.balanceWinc})`
        : ''
    super(
      `@seedprotocol/publish: ${params.address} does not have enough Turbo credits to store this publish${amounts}. ` +
        `Top up that address with Turbo credits (card or crypto through ArDrive Turbo), then publish again.` +
        (params.detail ? ` ${params.detail}` : ''),
    )
    this.name = 'InsufficientStorageCreditsError'
    this.address = params.address
    this.requiredWinc = params.requiredWinc
    this.balanceWinc = params.balanceWinc
  }
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url)
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    // Turbo answers some 404s in plain text ("User Not Found", "TX doesn't exist")
  }
  return { status: res.status, body }
}

/** Spendable winc for an EVM address. An address Turbo has never seen has 0. */
export async function getTurboBalanceWinc(endpoints: TurboEndpoints, address: string): Promise<bigint> {
  const { status, body } = await getJson(
    `${endpoints.paymentUrl}/v1/account/balance/ethereum?address=${encodeURIComponent(address)}`,
  )
  if (status === 404) return 0n
  if (status !== 200) throw new Error(`Turbo balance lookup failed: HTTP ${status}`)
  return BigInt(body?.effectiveBalance ?? body?.winc ?? '0')
}

/** winc Turbo charges to store `bytes`. */
export async function getTurboPriceWinc(endpoints: TurboEndpoints, bytes: number): Promise<bigint> {
  const { status, body } = await getJson(`${endpoints.paymentUrl}/v1/price/bytes/${bytes}`)
  if (status !== 200) throw new Error(`Turbo price lookup failed: HTTP ${status}`)
  return BigInt(body?.winc ?? '0')
}

/** Largest data item Turbo stores for free, from `GET /v1/info` (0 when it doesn't say). */
export async function getTurboFreeUploadLimitBytes(endpoints: TurboEndpoints): Promise<number> {
  try {
    const { status, body } = await getJson(`${endpoints.uploadUrl}/v1/info`)
    if (status !== 200) return 0
    return Number(body?.freeUploadLimitBytes ?? body?.freeTier?.maxItemBytes ?? 0) || 0
  } catch {
    return 0
  }
}

export type TurboUploadReceipt = { id: string; owner?: string; winc?: string }

/**
 * POSTs one signed (signature type 3, Ethereum) data item. Turbo charges the signer, or first the
 * `paidBy` addresses' shared credits.
 * @throws InsufficientStorageCreditsError on HTTP 402
 */
export async function uploadDataItemToTurbo(
  endpoints: TurboEndpoints,
  raw: Uint8Array,
  options: { signerAddress: string; paidBy?: string[] },
): Promise<TurboUploadReceipt> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
  if (options.paidBy && options.paidBy.length > 0) headers['x-paid-by'] = options.paidBy.join(',')
  const res = await fetch(`${endpoints.uploadUrl}/v1/tx/ethereum`, { method: 'POST', headers, body: raw as BodyInit })
  const text = await res.text()
  if (res.status === 402) {
    throw new InsufficientStorageCreditsError({ address: options.signerAddress, detail: text.slice(0, 200) })
  }
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`Turbo upload failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return JSON.parse(text) as TurboUploadReceipt
}

/** HTTP status of `GET /v1/tx/:id/status`: 200 when Turbo has the item, 404 when it doesn't. */
export async function getTurboDataItemStatus(endpoints: TurboEndpoints, id: string): Promise<number> {
  const res = await fetch(`${endpoints.uploadUrl}/v1/tx/${encodeURIComponent(id)}/status`)
  await res.body?.cancel().catch(() => {})
  return res.status
}

/**
 * Throws {@link InsufficientStorageCreditsError} when `address` can't pay for `itemSizes`, before
 * anything is uploaded. Items at or under Turbo's free size cost nothing. Shared credits
 * (`paidBy`) aren't counted, so callers skip this check when `paidBy` is set.
 */
export async function assertTurboCanPay(
  endpoints: TurboEndpoints,
  address: string,
  itemSizes: number[],
): Promise<void> {
  const freeLimit = await getTurboFreeUploadLimitBytes(endpoints)
  const paid = itemSizes.filter((size) => size > freeLimit)
  if (paid.length === 0) return
  const prices = await Promise.all(paid.map((size) => getTurboPriceWinc(endpoints, size)))
  const required = prices.reduce((sum, p) => sum + p, 0n)
  const balance = await getTurboBalanceWinc(endpoints, address)
  if (balance < required) {
    throw new InsufficientStorageCreditsError({ address, requiredWinc: required, balanceWinc: balance })
  }
}

/**
 * EVM address that signed an ANS-104 data item with signature type 3 (Ethereum): the owner
 * field is the uncompressed secp256k1 public key. Returns undefined for other signature types.
 */
export function ethereumSignerOfDataItem(raw: Uint8Array): string | undefined {
  if (raw.length < 2 + 65 + 65) return undefined
  const sigType = raw[0]! | (raw[1]! << 8)
  if (sigType !== 3) return undefined
  const owner = raw.subarray(2 + 65, 2 + 65 + 65)
  return computeAddress(hexlify(owner))
}

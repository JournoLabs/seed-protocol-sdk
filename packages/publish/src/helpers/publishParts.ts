import { size, zeroAddress } from 'viem'
import { ManagedAccountPublishError } from '../errors'
import { encodeMultiPublish, localIdWordOf, slotWordsOf, type MultiPublishRequest } from './contracts'
import { PUBLISH_GAS_HEADROOM_BPS, type PublishGasEstimate } from './publishGas'
import { localPublishGas, maxPublishGas, PUBLISH_MAX_CALLDATA_BYTES } from './publishSize'

/**
 * Requests that go in the same transaction: one request, or every request of one cycle of
 * references (ADR 0036). A unit is never split across parts.
 */
export type PublishUnit = MultiPublishRequest[]

/**
 * `requests` grouped into units (strongly connected components) and ordered so each unit comes
 * after every unit it depends on. Request A comes before request B when A's `propertiesToUpdate`
 * targets B (A's seed uid fills B's slot), or when a relation slot of B holds A's local id. Ties keep
 * the order of each unit's first request in `requests`, and a unit keeps its requests in that order.
 */
export function publishUnits(requests: MultiPublishRequest[]): PublishUnit[] {
  const indexByLocalId = new Map<string, number>()
  const indexByWord = new Map<string, number>()
  requests.forEach((r, i) => {
    if (!r.localId || indexByLocalId.has(r.localId)) return
    indexByLocalId.set(r.localId, i)
    const word = localIdWordOf(r.localId)
    if (word) indexByWord.set(word.toLowerCase(), i)
  })

  const after: Set<number>[] = requests.map(() => new Set())
  requests.forEach((r, i) => {
    for (const pu of r.propertiesToUpdate ?? []) {
      const target = indexByLocalId.get(pu.publishLocalId)
      if (target !== undefined && target !== i) after[i]!.add(target)
    }
    for (const a of r.listOfAttestations) {
      for (const entry of a.data) {
        for (const word of slotWordsOf(entry.data)) {
          const source = indexByWord.get(word.toLowerCase())
          if (source !== undefined && source !== i) after[source]!.add(i)
        }
      }
    }
  })

  const component = stronglyConnected(after)
  const count = Math.max(-1, ...component) + 1
  const members: number[][] = Array.from({ length: count }, () => [])
  component.forEach((c, i) => members[c]!.push(i))

  const indegree = new Array<number>(count).fill(0)
  const next: Set<number>[] = Array.from({ length: count }, () => new Set())
  after.forEach((targets, i) => {
    for (const j of targets) {
      const from = component[i]!
      const to = component[j]!
      if (from === to || next[from]!.has(to)) continue
      next[from]!.add(to)
      indegree[to]!++
    }
  })

  const first = (c: number) => members[c]![0]!
  const ready = members.map((_, c) => c).filter((c) => indegree[c] === 0)
  const units: PublishUnit[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => first(a) - first(b))
    const c = ready.shift()!
    units.push(members[c]!.map((i) => requests[i]!))
    for (const to of next[c]!) if (--indegree[to]! === 0) ready.push(to)
  }
  return units
}

/** Tarjan's algorithm: the component index of each node, for edges `after[i]` (i → j). */
function stronglyConnected(after: Set<number>[]): number[] {
  const index = new Array<number>(after.length).fill(-1)
  const low = new Array<number>(after.length).fill(0)
  const onStack = new Array<boolean>(after.length).fill(false)
  const component = new Array<number>(after.length).fill(-1)
  const stack: number[] = []
  let nextIndex = 0
  let nextComponent = 0

  const visit = (v: number) => {
    index[v] = low[v] = nextIndex++
    stack.push(v)
    onStack[v] = true
    for (const w of after[v]!) {
      if (index[w] === -1) {
        visit(w)
        low[v] = Math.min(low[v]!, low[w]!)
      } else if (onStack[w]) {
        low[v] = Math.min(low[v]!, index[w]!)
      }
    }
    if (low[v] === index[v]) {
      let w: number
      do {
        w = stack.pop()!
        onStack[w] = false
        component[w] = nextComponent
      } while (w !== v)
      nextComponent++
    }
  }
  for (let v = 0; v < after.length; v++) if (index[v] === -1) visit(v)
  return component
}

/**
 * The requests of the first `count` units, as one part. A `propertiesToUpdate` entry whose target
 * isn't among them is dropped: that target goes in a later part, whose rebuilt payload holds this
 * request's recorded seed uid. Requests are copied; `units` is unchanged.
 */
export function partRequests(units: PublishUnit[], count: number): MultiPublishRequest[] {
  const requests = units.slice(0, count).flat()
  const inPart = new Set(requests.map((r) => r.localId))
  return requests.map((r) => ({
    ...r,
    propertiesToUpdate: (r.propertiesToUpdate ?? []).filter((pu) => inPart.has(pu.publishLocalId)),
  }))
}

const withHeadroom = (gas: bigint) => (gas * PUBLISH_GAS_HEADROOM_BPS) / 10_000n

/** Whether `requests` pass the local gas estimate (with headroom) and the calldata limit. */
function fitsLocally(requests: MultiPublishRequest[]): boolean {
  if (withHeadroom(localPublishGas(requests)) > maxPublishGas()) return false
  // The executor module takes the same calldata, and the target doesn't change its size.
  return size(encodeMultiPublish(zeroAddress, requests).data) <= PUBLISH_MAX_CALLDATA_BYTES
}

/**
 * The most leading units whose part passes the local gas estimate and the calldata limit; 0 when
 * the first unit alone doesn't. The local estimate is a lower bound, so this only rules parts out.
 */
export function localPrefixLength(units: PublishUnit[]): number {
  let count = 0
  while (count < units.length && fitsLocally(partRequests(units, count + 1))) count++
  return count
}

/** `PUBLISH_TOO_LARGE` for a unit that doesn't fit in a transaction on its own. */
export function unitTooLargeError(unit: PublishUnit, reason: string, from?: string): ManagedAccountPublishError {
  const ids = unit.map((r) => r.localId).join(', ')
  const what = unit.length === 1 ? `Item ${ids} is` : `The cycle of references between ${ids} is`
  return new ManagedAccountPublishError(
    `${what} too large for one transaction (${reason}); nothing was sent.`,
    'PUBLISH_TOO_LARGE',
    from,
  )
}

/**
 * How many transactions the local estimate expects `requests` to go out in. A lower bound: the
 * RPC estimate a send makes can shorten a part.
 * @throws ManagedAccountPublishError `PUBLISH_TOO_LARGE` when one unit doesn't fit on its own
 */
export function expectedPartCount(requests: MultiPublishRequest[], from?: string): number {
  let remaining = publishUnits(requests)
  let parts = 0
  while (remaining.length > 0) {
    const length = localPrefixLength(remaining)
    if (length === 0) {
      throw unitTooLargeError(remaining[0]!, `over ${maxPublishGas()} gas or ${PUBLISH_MAX_CALLDATA_BYTES} bytes of calldata`, from)
    }
    remaining = remaining.slice(length)
    parts++
  }
  return parts
}

/**
 * The number of leading units to send as the next part: the longest prefix the local estimate
 * allows ({@link localPrefixLength}), shortened by bisection until `estimate` (gas with headroom)
 * is at most `ceiling`. An estimate over the node's own cap (`'over_cap'`) doesn't fit. An estimate
 * that can't be made (`undefined`) accepts its prefix, which is then sent with `publishGasLimit`'s
 * fallback gas.
 * @throws ManagedAccountPublishError `PUBLISH_TOO_LARGE` when the first unit doesn't fit on its own
 */
export async function fitPublishPart(
  units: PublishUnit[],
  estimate: (requests: MultiPublishRequest[]) => Promise<PublishGasEstimate>,
  ceiling: bigint,
): Promise<number> {
  const local = localPrefixLength(units)
  if (local === 0) {
    throw unitTooLargeError(units[0]!, `over ${maxPublishGas()} gas or ${PUBLISH_MAX_CALLDATA_BYTES} bytes of calldata`)
  }
  const fits = async (count: number) => {
    const gas = await estimate(partRequests(units, count))
    if (gas === 'over_cap') return false
    return gas === undefined || gas <= ceiling
  }
  if (await fits(local)) return local
  // Largest count known to fit (0: none yet), and largest still possible.
  let lo = 0
  let hi = local - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (await fits(mid)) lo = mid
    else hi = mid - 1
  }
  if (lo === 0) throw unitTooLargeError(units[0]!, `its estimate is over ${ceiling} gas`)
  return lo
}

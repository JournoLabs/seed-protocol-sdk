import { beforeEach, describe, expect, mock, test } from 'bun:test'

/** sendAttested: an attempt row around every send, and no send while an earlier one may have landed. */
const realSdk = await import('@seedprotocol/sdk')
const realChainClient = await import('../../../helpers/chainClient')
const { ManagedAccountPublishError, PublishTransactionRevertedError, AttestationAttemptOpenError } = await import(
  '../../../errors'
)

type Row = {
  id: string
  status: string
  txHash: string | null
  seedLocalIds: string[]
  requests: string
  step?: string
  sender: string
  nonceKey: string | null
  entryPoint: string | null
}
let rows: Row[] = []

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async () =>
    rows.filter((r) => ['sending', 'sent', 'landed'].includes(r.status)),
  claimPublishAttempt: async (attempt: Omit<Row, 'status' | 'txHash'>) => {
    const open = rows.find(
      (r) =>
        ['sending', 'sent', 'landed'].includes(r.status) &&
        r.seedLocalIds.some((id) => attempt.seedLocalIds.includes(id)),
    )
    if (open) return open
    rows.push({ ...attempt, status: 'sending', txHash: null })
    return undefined
  },
  updatePublishAttempt: async (id: string, update: Partial<Row>) => {
    Object.assign(rows.find((r) => r.id === id)!, update)
  },
}))

let receipt: () => Promise<unknown> = async () => ({ status: 'success' })
/** The EntryPoint nonce a host key's check reads. */
let chainNonce = 0n
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  getPublishBlockNumber: async () => 100n,
  waitForPublishReceipt: () => receipt(),
  getPublishPublicClient: () => ({ readContract: async () => chainNonce }),
}))
mock.module('../../../helpers/chainConfig', () => ({ getPublishViemChain: () => ({ id: 84532 }) }))

const { attemptStatusAfterFailedSend, sendAttested, waitForAttemptReceipt } = await import('./sendAttested')
const { pinnedNonce, publishNonceKey } = await import('../../../helpers/pinnedNonce')

const HASH = `0x${'a'.repeat(64)}` as `0x${string}`
const SENDER = `0x${'b'.repeat(40)}`
const send = mock(async () => ({ transactionHash: HASH }))
const attempt = (seedLocalId = 'post', requests: Array<Record<string, unknown>> = [{ localId: 'post' }]) => ({
  publishRunId: 'run1',
  seedLocalId,
  requests,
  sender: { address: SENDER as `0x${string}` },
  attester: SENDER,
  send,
})
const ENTRY_POINT = `0x${'e'.repeat(40)}` as `0x${string}`
const pinned = (over: Record<string, unknown> = {}) => ({
  ...attempt(),
  sender: { address: SENDER as `0x${string}`, pinsNonceOn: ENTRY_POINT },
  ...over,
})

beforeEach(() => {
  rows = []
  chainNonce = 0n
  send.mockClear()
  receipt = async () => ({ status: 'success' })
})

describe('sendAttested', () => {
  test('commits the attempt before sending and the hash after', async () => {
    let statusDuringSend: string | undefined
    send.mockImplementationOnce(async () => {
      statusDuringSend = rows[0]?.status
      return { transactionHash: HASH }
    })
    await sendAttested(attempt())
    expect(statusDuringSend).toBe('sending')
    expect(rows[0]).toMatchObject({ status: 'sent', txHash: HASH })
  })

  test('keeps the requests, bigints as strings, and every seed in them', async () => {
    await sendAttested(attempt('post', [{ localId: 'image', value: 5n }, { localId: 'post' }]))
    expect(rows[0]!.seedLocalIds).toEqual(['post', 'image'])
    expect(JSON.parse(rows[0]!.requests)[0].value).toBe('5')
  })

  test('refuses to send while an attempt on the same seed is open', async () => {
    await sendAttested(attempt())
    send.mockClear()
    await expect(sendAttested(attempt())).rejects.toBeInstanceOf(AttestationAttemptOpenError)
    expect(send).not.toHaveBeenCalled()
  })

  test('refuses when only a related seed overlaps: another run, publishing the Image alone', async () => {
    await sendAttested(attempt('post', [{ localId: 'image' }, { localId: 'post' }]))
    send.mockClear()
    await expect(sendAttested(attempt('image', [{ localId: 'image' }]))).rejects.toBeInstanceOf(
      AttestationAttemptOpenError,
    )
    expect(send).not.toHaveBeenCalled()
  })

  test('a send that shows nothing went out closes the attempt, and a retry sends', async () => {
    send.mockImplementationOnce(async () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    })
    await expect(sendAttested(attempt())).rejects.toThrow('User rejected')
    expect(rows[0]!.status).toBe('notSent')
    await sendAttested(attempt())
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('a send timeout leaves the attempt open: the UserOp can still land', async () => {
    send.mockImplementationOnce(async () => {
      throw new Error('Timeout waiting for userOp to be mined')
    })
    await expect(sendAttested(attempt())).rejects.toThrow('Timeout')
    expect(rows[0]!.status).toBe('sending')
    await expect(sendAttested(attempt())).rejects.toBeInstanceOf(AttestationAttemptOpenError)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('sendAttested: a sender that pins its nonce', () => {
  const failedSend = async () => {
    send.mockImplementationOnce(async () => {
      throw new Error('Timeout waiting for userOp to be mined')
    })
    await expect(sendAttested(pinned())).rejects.toThrow('Timeout')
    return rows[0]!
  }

  test('sends under a nonce key kept on the attempt', async () => {
    await sendAttested(pinned())
    const [key] = send.mock.calls[0] as unknown as [bigint]
    expect(key).toBeGreaterThan(0n)
    expect(key >> 192n).toBe(0n)
    expect(rows[0]).toMatchObject({ nonceKey: key.toString(), entryPoint: ENTRY_POINT })
  })

  test('each attempt gets its own key', async () => {
    await sendAttested(pinned())
    await sendAttested(pinned({ seedLocalId: 'other', requests: [{ localId: 'other' }] }))
    expect(rows[0]!.nonceKey).not.toBe(rows[1]!.nonceKey)
  })

  test('a sender with no pin sends no key', async () => {
    await sendAttested(attempt())
    expect(send.mock.calls[0]).toEqual([undefined] as never)
    expect(rows[0]).toMatchObject({ nonceKey: null, entryPoint: null })
  })

  test('a resume repeats the attempt under the same key, with no new row', async () => {
    const row = await failedSend()
    await sendAttested(pinned({ resumeAttemptId: row.id }))
    expect(rows).toHaveLength(1)
    expect(send.mock.calls.map(([key]: any) => key?.toString())).toEqual([row.nonceKey, row.nonceKey])
    expect(rows[0]!.status).toBe('sent')
  })

  test('a resume with different requests is refused: the record could not tell which landed', async () => {
    const row = await failedSend()
    send.mockClear()
    await expect(
      sendAttested(pinned({ resumeAttemptId: row.id, requests: [{ localId: 'post', edited: true }] })),
    ).rejects.toBeInstanceOf(AttestationAttemptOpenError)
    expect(send).not.toHaveBeenCalled()
  })

  test('a resume from a sender on another EntryPoint is refused: the key would mean nothing', async () => {
    const row = await failedSend()
    send.mockClear()
    await expect(
      sendAttested(pinned({ resumeAttemptId: row.id, sender: { address: SENDER as `0x${string}` } })),
    ).rejects.toBeInstanceOf(AttestationAttemptOpenError)
    expect(send).not.toHaveBeenCalled()
  })

  test('a rejected resend keeps the attempt open: the first send may still be pending', async () => {
    const row = await failedSend()
    send.mockImplementationOnce(async () => {
      throw new Error('AA21 did not pay prefund')
    })
    await expect(sendAttested(pinned({ resumeAttemptId: row.id }))).rejects.toThrow('AA21')
    expect(rows[0]!.status).toBe('sending')
  })

  test('a used pinned nonce keeps the attempt open: it can be this send having landed', async () => {
    send.mockImplementationOnce(async () => {
      throw new Error('nonce too low')
    })
    await expect(sendAttested(pinned())).rejects.toThrow('nonce too low')
    expect(rows[0]!.status).toBe('sending')
  })
})

describe('sendAttested: a direct EAS step', () => {
  test('keeps its step on the attempt', async () => {
    await sendAttested({ ...attempt(), step: 'version' })
    expect(rows[0]).toMatchObject({ step: 'version' })
  })

  test('a resume of another step is refused', async () => {
    const pinnedSender = { address: SENDER as `0x${string}`, pinsNonceOn: ENTRY_POINT }
    send.mockImplementationOnce(async () => {
      throw new Error('Timeout')
    })
    await expect(sendAttested({ ...attempt(), sender: pinnedSender, step: 'seed' })).rejects.toThrow('Timeout')
    send.mockClear()
    await expect(
      sendAttested({ ...attempt(), sender: pinnedSender, step: 'version', resumeAttemptId: rows[0]!.id }),
    ).rejects.toBeInstanceOf(AttestationAttemptOpenError)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('waitForAttemptReceipt', () => {
  test('a receipt moves the attempt to landed, still open until recorded', async () => {
    const { attemptId } = await sendAttested(attempt())
    await waitForAttemptReceipt(attemptId, HASH)
    expect(rows[0]!.status).toBe('landed')
    await expect(sendAttested(attempt())).rejects.toBeInstanceOf(AttestationAttemptOpenError)
  })

  test('a lost receipt leaves the attempt open, so a retry cannot send again', async () => {
    const { attemptId } = await sendAttested(attempt())
    receipt = async () => {
      throw new Error('fetch failed')
    }
    await expect(waitForAttemptReceipt(attemptId, HASH)).rejects.toThrow('fetch failed')
    expect(rows[0]!.status).toBe('sent')
    await expect(sendAttested(attempt())).rejects.toBeInstanceOf(AttestationAttemptOpenError)
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('a revert closes the attempt: nothing was attested', async () => {
    const { attemptId } = await sendAttested(attempt())
    receipt = async () => {
      throw new PublishTransactionRevertedError(HASH, {})
    }
    await expect(waitForAttemptReceipt(attemptId, HASH)).rejects.toBeInstanceOf(PublishTransactionRevertedError)
    expect(rows[0]!.status).toBe('reverted')
    await sendAttested(attempt())
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('attemptStatusAfterFailedSend', () => {
  const wrapped = (message: string) => new Error('ManagedAccount UserOp failed', { cause: new Error(message) })

  test.each([
    ['a rejected prompt', new Error('User denied transaction signature')],
    ['ethers rejection', Object.assign(new Error('rejected'), { code: 'ACTION_REJECTED' })],
    ['no funds', wrapped('insufficient funds for gas * price + value')],
    ['a used nonce', wrapped('nonce too low')],
    ['bundler validation', wrapped('UserOperation rejected: AA21 did not pay prefund')],
  ])('%s: not sent', (_name, err) => {
    expect(attemptStatusAfterFailedSend(err)).toBe('notSent')
  })

  test('a failed UserOp: reverted', () => {
    const err = new ManagedAccountPublishError('failed', 'USEROP_REVERTED', SENDER)
    expect(attemptStatusAfterFailedSend(err)).toBe('reverted')
  })

  test.each([
    ['a timeout', new Error('Timed out while waiting for User Operation')],
    ['a network failure', wrapped('fetch failed')],
    ['a used EntryPoint nonce, which can be this send landing', wrapped('AA25 invalid account nonce')],
  ])('%s: unknown', (_name, err) => {
    expect(attemptStatusAfterFailedSend(err)).toBeUndefined()
  })
})

describe('sendAttested: a host nonce key', () => {
  test('every try with the same host key sends under one key, whatever its seed and attempt', async () => {
    await sendAttested(pinned({ hostNonceKey: 'run-7' }))
    rows = [] // a new process: no rows from the first try
    await sendAttested(pinned({ seedLocalId: 'post2', requests: [{ localId: 'post2' }], hostNonceKey: 'run-7' }))
    const keys = send.mock.calls.map(([key]) => key as unknown as bigint)
    expect(keys).toEqual([publishNonceKey('run-7'), publishNonceKey('run-7')])
    expect(rows[0]!.nonceKey).toBe(publishNonceKey('run-7').toString())
  })

  test('a key an earlier try landed under sends nothing and claims no attempt', async () => {
    chainNonce = pinnedNonce(publishNonceKey('run-7')) + 1n
    await expect(sendAttested(pinned({ hostNonceKey: 'run-7' }))).rejects.toMatchObject({
      name: 'PublishNonceKeyError',
      code: 'NONCE_KEY_SPENT',
    })
    expect(send).not.toHaveBeenCalled()
    expect(rows).toEqual([])
  })

  test('a sender that does not pin, or a direct EAS step, is refused before the send', async () => {
    await expect(sendAttested({ ...attempt(), hostNonceKey: 'run-7' })).rejects.toMatchObject({
      code: 'NONCE_KEY_NOT_PINNED',
    })
    await expect(sendAttested(pinned({ hostNonceKey: 'run-7', step: 'seed' }))).rejects.toMatchObject({
      code: 'NONCE_KEY_DIRECT_EAS',
    })
    expect(send).not.toHaveBeenCalled()
    expect(rows).toEqual([])
  })
})

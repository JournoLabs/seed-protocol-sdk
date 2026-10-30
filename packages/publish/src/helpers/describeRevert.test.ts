import { describe, expect, test } from 'bun:test'
import { decodeErrorResult, encodeErrorResult, type Hex } from 'viem'
import { seedErrorsAbi } from './abi/seedErrors'
import { isManagedAccountPublishError, type ManagedAccountPublishError } from '../errors'
import { describeFailedUserOp, describeRevert, explainUserOpError } from './describeRevert'

const TX = `0x${'ab'.repeat(32)}`
const SENDER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const outOfBounds = encodeErrorResult({
  abi: seedErrorsAbi,
  errorName: 'PublishIndexOutOfBounds',
  args: [3n, 2n],
})

/** What thirdweb throws for a logged custom error: it decodes the reason without an ABI. */
function thirdwebUndecodedError(data: Hex): unknown {
  try {
    decodeErrorResult({ data })
  } catch (err) {
    return err
  }
  throw new Error('expected decodeErrorResult to throw')
}

describe('describeRevert', () => {
  test('names a value mismatch with the amounts', () => {
    const data = encodeErrorResult({ abi: seedErrorsAbi, errorName: 'PublishValueMismatch', args: [5n, 0n] })
    expect(describeRevert(data)).toBe('reverted with PublishValueMismatch(5, 0)')
  })

  test('decodes Seed errors with their arguments', () => {
    expect(describeRevert(outOfBounds)).toBe('reverted with PublishIndexOutOfBounds(3, 2)')
  })

  test("decodes the three-phase multiPublish's reference errors", () => {
    const schema = `0x${'05'.repeat(32)}` as Hex
    const found = `0x${'00'.repeat(31)}02` as Hex
    const mismatch = encodeErrorResult({
      abi: seedErrorsAbi,
      errorName: 'PlaceholderMismatch',
      args: [0n, 1n, schema, found],
    })
    expect(describeRevert(mismatch)).toBe(`reverted with PlaceholderMismatch(0, 1, ${schema}, ${found})`)
    const pastEnd = encodeErrorResult({
      abi: seedErrorsAbi,
      errorName: 'ListElementOutOfBounds',
      args: [1n, schema, 4n, 2n],
    })
    expect(describeRevert(pastEnd)).toBe(`reverted with ListElementOutOfBounds(1, ${schema}, 4, 2)`)
  })

  test('decodes Error(string)', () => {
    const data = encodeErrorResult({
      abi: [{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }],
      errorName: 'Error',
      args: ['Router: function does not exist'],
    })
    expect(describeRevert(data)).toBe('reverted with Error(Router: function does not exist)')
  })

  test('falls back to the raw data for unknown errors', () => {
    expect(describeRevert('0xdeadbeef')).toBe('reverted with data 0xdeadbeef')
  })
})

describe('describeFailedUserOp', () => {
  test('points at running out of gas when there is no revert data', () => {
    const message = describeFailedUserOp(TX)
    expect(message).toContain('ran out of gas')
    expect(message).toContain(`seed:explain-userop --network <network> --tx ${TX}`)
  })

  test('decodes revert data when there is some', () => {
    expect(describeFailedUserOp(TX, outOfBounds)).toContain('reverted with PublishIndexOutOfBounds(3, 2)')
  })
})

describe('explainUserOpError', () => {
  test('explains thirdweb\'s bare "UserOp failed at txHash" as USEROP_FAILED_NO_REASON', () => {
    const original = new Error(`UserOp failed at txHash: ${TX}`)
    const explained = explainUserOpError(original, SENDER) as ManagedAccountPublishError
    expect(isManagedAccountPublishError(explained)).toBe(true)
    expect(explained.code).toBe('USEROP_FAILED_NO_REASON')
    expect(explained.message).toContain('ran out of gas')
    expect(explained.message).toContain(TX)
    expect(explained.managedAddress).toBe(SENDER)
    expect(explained.underlyingCause).toBe(original)
  })

  test('finds the message further down the cause chain', () => {
    const original = new Error('send failed', { cause: new Error(`UserOp failed at txHash: ${TX}`) })
    expect(explainUserOpError(original)).toMatchObject({ code: 'USEROP_FAILED_NO_REASON' })
  })

  test('names a custom error thirdweb could not decode', () => {
    const original = thirdwebUndecodedError(outOfBounds)
    const explained = explainUserOpError(original) as ManagedAccountPublishError
    expect(explained.code).toBe('USEROP_REVERTED')
    expect(explained.message).toContain('reverted with PublishIndexOutOfBounds')
    expect(explained.underlyingCause).toBe(original)
  })

  test('leaves other errors alone', () => {
    const withReason = new Error(`UserOp failed with reason: 'nope' at txHash: ${TX}`)
    expect(explainUserOpError(withReason)).toBe(withReason)
    const unrelated = thirdwebUndecodedError('0xdeadbeef')
    expect(explainUserOpError(unrelated)).toBe(unrelated)
    expect(explainUserOpError('boom')).toBe('boom')
  })
})

import { describe, expect, test } from 'bun:test'
import { PublishMachineStates } from './constants'
import {
  describePublishRun,
  getPublishMachineValueForUi,
  PUBLISH_RUN_STATE_PHASES,
  resolvePublishDisplayValue,
} from './publishDisplayHelpers'
import { publishMachine } from '../services/publish'

describe('resolvePublishDisplayValue', () => {
  test('returns undefined for interrupted rows when no live actor', () => {
    const value = resolvePublishDisplayValue(
      null,
      { status: 'interrupted' },
      'creatingAttestations',
    )
    expect(value).toBeUndefined()
  })
})

describe('getPublishMachineValueForUi', () => {
  test('returns undefined for interrupted rows even if completedAt exists', () => {
    const value = getPublishMachineValueForUi({
      status: 'interrupted',
      persistedSnapshot: JSON.stringify({
        status: 'done',
        value: PublishMachineStates.SUCCESS,
      }),
      completedAt: Date.now(),
    })
    expect(value).toBeUndefined()
  })
})

describe('describePublishRun', () => {
  test('maps every publish machine state', () => {
    const states = Object.keys(publishMachine.config.states ?? {})
    expect(states.length).toBeGreaterThan(0)
    const unmapped = states.filter((state) => !Object.hasOwn(PUBLISH_RUN_STATE_PHASES, state))
    expect(unmapped).toEqual([])
    // No stale names either: every mapped state exists in the machine.
    expect(Object.keys(PUBLISH_RUN_STATE_PHASES).filter((state) => !states.includes(state))).toEqual([])
  })

  test('the machine has no nested states, so its value is a state name', () => {
    for (const [name, state] of Object.entries(publishMachine.config.states ?? {})) {
      expect([name, (state as { states?: unknown }).states]).toEqual([name, undefined])
    }
  })

  test('flags exactly the states that accept retry as awaitingRetry', () => {
    for (const [name, state] of Object.entries(publishMachine.config.states ?? {})) {
      const acceptsRetry = Object.hasOwn((state as { on?: object }).on ?? {}, 'retry')
      expect([name, describePublishRun(name).awaitingRetry]).toEqual([name, acceptsRetry])
    }
  })

  test('marks exactly the final states terminal', () => {
    for (const [name, state] of Object.entries(publishMachine.config.states ?? {})) {
      const final = (state as { type?: string }).type === 'final'
      expect([name, describePublishRun(name).terminal]).toEqual([name, final])
    }
  })

  test('places the states a UI shows', () => {
    expect(describePublishRun('authorizing').phase).toBe('preparing')
    expect(describePublishRun('preparingHtmlEmbedded').phase).toBe('preparing')
    expect(describePublishRun('rewritingHtmlEmbedded').phase).toBe('uploading')
    expect(describePublishRun('uploadingViaBundlerPhase2').phase).toBe('uploading')
    expect(describePublishRun('creatingAttestationsDirectToEas').phase).toBe('attesting')
    expect(describePublishRun('revokingRetractedProperties')).toEqual({
      phase: 'retracting',
      awaitingRetry: false,
      terminal: false,
    })
    expect(describePublishRun('retractionFailureRecoverable')).toEqual({
      phase: 'retracting',
      awaitingRetry: true,
      terminal: false,
    })
    expect(describePublishRun('attestationFailureRecoverable')).toEqual({
      phase: 'attesting',
      awaitingRetry: true,
      terminal: false,
    })
    expect(describePublishRun(PublishMachineStates.SUCCESS)).toEqual({ phase: 'done', awaitingRetry: false, terminal: true })
    expect(describePublishRun(PublishMachineStates.FAILURE)).toEqual({ phase: 'failed', awaitingRetry: false, terminal: true })
    expect(describePublishRun('stopping')).toEqual({ phase: 'stopped', awaitingRetry: false, terminal: true })
  })

  test('reads no value, or an unknown one, as a run that has not ended', () => {
    expect(describePublishRun(undefined)).toEqual({ phase: 'preparing', awaitingRetry: false, terminal: false })
    expect(describePublishRun('toString')).toEqual({ phase: 'preparing', awaitingRetry: false, terminal: false })
  })
})

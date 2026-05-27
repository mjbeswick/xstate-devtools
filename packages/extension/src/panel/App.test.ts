import { describe, expect, it } from 'vitest'
import {
  getBrowserTransportStatus,
  registerBrowserReconnectFailure,
  shouldResetPanelAfterNavigation,
  shouldResetBrowserStateOnFirstMessage,
} from './App.js'

describe('shouldResetBrowserStateOnFirstMessage', () => {
  it('resets stale actors when the first reconnect message is a resync payload', () => {
    expect(
      shouldResetBrowserStateOnFirstMessage(
        {
          type: 'XSTATE_ACTOR_REGISTERED',
          sessionId: 'next',
          machine: null,
          snapshot: { value: null, context: {}, status: 'active' },
          globalSeq: 1,
          timestamp: 1000,
        },
        3,
        true,
      ),
    ).toBe(true)
  })

  it('does not reset when navigation already delivered the explicit clear signal', () => {
    expect(shouldResetBrowserStateOnFirstMessage({ type: 'XSTATE_PAGE_NAVIGATED' }, 3, true)).toBe(
      false,
    )
  })

  it('does not reset when there is no stale actor state to clear', () => {
    expect(
      shouldResetBrowserStateOnFirstMessage(
        {
          type: 'XSTATE_ACTOR_REGISTERED',
          sessionId: 'next',
          machine: null,
          snapshot: { value: null, context: {}, status: 'active' },
          globalSeq: 1,
          timestamp: 1000,
        },
        0,
        true,
      ),
    ).toBe(false)
  })
})

describe('shouldResetPanelAfterNavigation', () => {
  it('waits for the first real actor payload after navigation before clearing stale state', () => {
    expect(shouldResetPanelAfterNavigation({ type: 'XSTATE_PAGE_NAVIGATED' }, true)).toBe(false)
    expect(shouldResetPanelAfterNavigation({ type: 'XSTATE_ADAPTER_READY' }, true)).toBe(false)
    expect(
      shouldResetPanelAfterNavigation(
        {
          type: 'XSTATE_ACTOR_REGISTERED',
          sessionId: 'next',
          machine: null,
          snapshot: { value: null, context: {}, status: 'active' },
          globalSeq: 1,
          timestamp: 1000,
        },
        true,
      ),
    ).toBe(true)
  })

  it('does not reset when navigation is not pending', () => {
    expect(
      shouldResetPanelAfterNavigation(
        {
          type: 'XSTATE_ACTOR_REGISTERED',
          sessionId: 'next',
          machine: null,
          snapshot: { value: null, context: {}, status: 'active' },
          globalSeq: 1,
          timestamp: 1000,
        },
        false,
      ),
    ).toBe(false)
  })
})

describe('getBrowserTransportStatus', () => {
  it('reports disconnected when the extension port is down', () => {
    expect(getBrowserTransportStatus(false, 0, 'idle')).toBe('disconnected')
    expect(getBrowserTransportStatus(false, 3, 'idle')).toBe('disconnected')
  })

  it('reports waiting until the inspected page sends adapter traffic', () => {
    expect(getBrowserTransportStatus(true, 0, 'idle')).toBe('waiting')
  })

  it('reports connected after the inspected page sends messages', () => {
    expect(getBrowserTransportStatus(true, 1, 'idle')).toBe('connected')
  })

  it('reports connected when the server adapter socket is open', () => {
    expect(getBrowserTransportStatus(true, 0, 'open')).toBe('connected')
  })

  it('reports disconnected when the server adapter closes before any app traffic arrives', () => {
    expect(getBrowserTransportStatus(true, 0, 'closed')).toBe('disconnected')
    expect(getBrowserTransportStatus(true, 0, 'error')).toBe('disconnected')
  })
})

describe('registerBrowserReconnectFailure', () => {
  it('does not warn before reconnect failure thresholds are reached', () => {
    const first = registerBrowserReconnectFailure(null, 1_000)
    expect(first.next.attempts).toBe(1)
    expect(first.shouldWarn).toBe(false)
    expect(first.elapsedMs).toBe(0)

    const second = registerBrowserReconnectFailure(first.next, 1_500)
    expect(second.next.attempts).toBe(2)
    expect(second.shouldWarn).toBe(false)
    expect(second.elapsedMs).toBe(500)
  })

  it('warns once when attempt threshold is reached', () => {
    let state = null
    let warnedAtAttempt = 0

    for (let i = 1; i <= 6; i += 1) {
      const result = registerBrowserReconnectFailure(state, 2_000 + i)
      state = result.next
      if (result.shouldWarn) warnedAtAttempt = i
    }

    expect(warnedAtAttempt).toBe(5)
  })

  it('warns once when elapsed threshold is reached', () => {
    const first = registerBrowserReconnectFailure(null, 10_000)
    const warned = registerBrowserReconnectFailure(first.next, 20_001)
    const later = registerBrowserReconnectFailure(warned.next, 21_000)

    expect(warned.shouldWarn).toBe(true)
    expect(warned.elapsedMs).toBe(10_001)
    expect(later.shouldWarn).toBe(false)
  })
})

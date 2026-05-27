import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener<T extends (...args: any[]) => void> = T

function createEvent<T extends (...args: any[]) => void>() {
  const listeners = new Set<Listener<T>>()

  return {
    addListener(listener: Listener<T>) {
      listeners.add(listener)
    },
    removeListener(listener: Listener<T>) {
      listeners.delete(listener)
    },
    emit(...args: Parameters<T>) {
      for (const listener of listeners) {
        listener(...args)
      }
    },
  }
}

function createPort(name: string, tabId?: number) {
  return {
    name,
    sender: tabId === undefined ? undefined : { tab: { id: tabId } },
    onMessage: createEvent<(message: unknown) => void>(),
    onDisconnect: createEvent<() => void>(),
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  }
}

describe('background reload handling', () => {
  const runtimeOnConnect = createEvent<(port: chrome.runtime.Port) => void>()
  const runtimeOnMessage = createEvent<
    (message: unknown, sender: chrome.runtime.MessageSender) => void
  >()
  const tabsOnRemoved = createEvent<(tabId: number) => void>()
  const tabsOnUpdated = createEvent<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void
  >()
  const tabsSendMessage = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    runtimeOnConnect.emit = runtimeOnConnect.emit.bind(runtimeOnConnect)
    runtimeOnMessage.emit = runtimeOnMessage.emit.bind(runtimeOnMessage)
    tabsOnRemoved.emit = tabsOnRemoved.emit.bind(tabsOnRemoved)
    tabsOnUpdated.emit = tabsOnUpdated.emit.bind(tabsOnUpdated)
    tabsSendMessage.mockReset()

    vi.stubGlobal('chrome', {
      runtime: {
        onConnect: runtimeOnConnect,
        onMessage: runtimeOnMessage,
        lastError: null,
      },
      tabs: {
        onRemoved: tabsOnRemoved,
        onUpdated: tabsOnUpdated,
        sendMessage: tabsSendMessage,
      },
    })

    await import('./index.js')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores late messages from a superseded content port after reload reconnect', () => {
    const panelPort = createPort('xstate-panel-7')
    const oldContentPort = createPort('xstate-content', 7)
    const newContentPort = createPort('xstate-content', 7)

    runtimeOnConnect.emit(panelPort as unknown as chrome.runtime.Port)
    runtimeOnConnect.emit(oldContentPort as unknown as chrome.runtime.Port)
    runtimeOnConnect.emit(newContentPort as unknown as chrome.runtime.Port)

    oldContentPort.onMessage.emit({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'web:stale',
      machine: null,
      snapshot: { value: null, context: {}, status: 'active' },
      globalSeq: 1,
      timestamp: 1000,
    })

    newContentPort.onMessage.emit({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'web:fresh',
      machine: null,
      snapshot: { value: null, context: {}, status: 'active' },
      globalSeq: 2,
      timestamp: 2000,
    })

    expect(panelPort.postMessage).toHaveBeenCalledTimes(1)
    expect(panelPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'XSTATE_ACTOR_REGISTERED',
        sessionId: 'web:fresh',
        __xstateDevtools: true,
      }),
    )
  })

  it('falls back to tabs.sendMessage when reload resync hits a stale content port', () => {
    const panelPort = createPort('xstate-panel-7')
    const staleContentPort = createPort('xstate-content', 7)
    staleContentPort.postMessage.mockImplementation(() => {
      throw new Error('Attempting to use a disconnected port object')
    })

    runtimeOnConnect.emit(panelPort as unknown as chrome.runtime.Port)
    tabsSendMessage.mockClear()
    runtimeOnConnect.emit(staleContentPort as unknown as chrome.runtime.Port)

    tabsOnUpdated.emit(7, { status: 'complete' })
    vi.runAllTimers()

    expect(tabsSendMessage).toHaveBeenCalledWith(
      7,
      { type: 'XSTATE_PANEL_CONNECTED', __xstateDevtools: true },
      expect.any(Function),
    )
  })
})
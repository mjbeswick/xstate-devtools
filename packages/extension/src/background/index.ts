// packages/extension/src/background/index.ts

import { debugLog, infoLog, summarizeMessage } from '../shared/debug.js'
import type {
  EventLogNativeMenuAction,
  EventLogNativeMenuContext,
  EventLogNativeMenuActionMessage,
  EventLogPanelToBackgroundMessage,
  ExtensionToPageMessage,
  MarkedExtensionMessage,
  MarkedPageMessage,
  NativePanelMenuActionMessage,
  NativePanelMenuItem,
  NativePanelMenuSetMessage,
  PageToExtensionMessage,
  PanelToBackgroundMessage,
} from '../shared/types.js'

// tabId → devtools panel port
const panelPorts = new Map<number, chrome.runtime.Port>()

// tabId → content-script persistent port (see content/index.ts)
const contentPorts = new Map<number, chrome.runtime.Port>()

// tabId → buffered messages (panel may not be open yet)
const pendingMessages = new Map<number, MarkedPageMessage[]>()
const MAX_PENDING = 200
const NATIVE_MENU_ROOT_ID = 'xstate-devtools.native'
const NATIVE_MENU_COPY_VISIBLE_EVENTS_ID = 'xstate-devtools.copy-visible-events-json'
const NATIVE_MENU_CLEAR_EVENTS_ID = 'xstate-devtools.clear-all-events'
const NATIVE_MENU_TIME_TRAVEL_ID = 'xstate-devtools.time-travel-toggle-event'
const NATIVE_MENU_COPY_EVENT_JSON_ID = 'xstate-devtools.copy-event-json'
const NATIVE_MENU_COPY_EVENT_TYPE_ID = 'xstate-devtools.copy-event-type'
const NATIVE_MENU_COPY_ACTOR_SESSION_ID = 'xstate-devtools.copy-actor-session-id'
const NATIVE_MENU_CUSTOM_SEPARATOR_ID = 'xstate-devtools.custom-separator'
const NATIVE_MENU_CUSTOM_SLOT_PREFIX = 'xstate-devtools.custom-slot-'
const MAX_NATIVE_MENU_CUSTOM_SLOTS = 8

let latestEventLogContext: {
  inspectedTabId: number
  context: EventLogNativeMenuContext
} | null = null

let latestNativePanelMenu: {
  inspectedTabId: number
  items: NativePanelMenuItem[]
} | null = null

const PAGE_MESSAGE_TYPES = new Set([
  'XSTATE_ACTOR_REGISTERED',
  'XSTATE_SNAPSHOT',
  'XSTATE_EVENT',
  'XSTATE_ACTOR_STOPPED',
  'XSTATE_ADAPTER_READY',
])

function asPageMessage(data: unknown): MarkedPageMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string' || !PAGE_MESSAGE_TYPES.has(type)) return null
  const page = data as PageToExtensionMessage
  return { ...page, __xstateDevtools: true }
}

function asDispatchMessage(data: unknown): MarkedExtensionMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (type !== 'XSTATE_DISPATCH' && type !== 'XSTATE_SET_ACTIVE_STATE') return null
  const dispatch = data as ExtensionToPageMessage
  return { ...dispatch, __xstateDevtools: true }
}

function asPanelToBackgroundMessage(data: unknown): PanelToBackgroundMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  const sourceLocation = (data as { sourceLocation?: unknown }).sourceLocation
  if (type !== 'XSTATE_OPEN_SOURCE' || typeof sourceLocation !== 'string') return null
  return {
    type,
    sourceLocation,
  }
}

function asEventLogPanelContextMessage(data: unknown): EventLogPanelToBackgroundMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  const inspectedTabId = (data as { inspectedTabId?: unknown }).inspectedTabId
  const context = (data as { context?: unknown }).context

  if (type !== 'XSTATE_EVENT_LOG_SET_NATIVE_MENU_CONTEXT') return null
  if (typeof inspectedTabId !== 'number' || !Number.isFinite(inspectedTabId)) return null
  if (!context || typeof context !== 'object') return null

  const scope = (context as { scope?: unknown }).scope
  const eventGlobalSeq = (context as { eventGlobalSeq?: unknown }).eventGlobalSeq
  const sessionId = (context as { sessionId?: unknown }).sessionId

  if (scope !== 'list' && scope !== 'event') return null
  if (eventGlobalSeq !== undefined && typeof eventGlobalSeq !== 'number') return null
  if (sessionId !== undefined && typeof sessionId !== 'string') return null

  return {
    type,
    inspectedTabId,
    context: {
      scope,
      eventGlobalSeq,
      sessionId,
    },
  }
}

function asNativePanelMenuSetMessage(data: unknown): NativePanelMenuSetMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  const inspectedTabId = (data as { inspectedTabId?: unknown }).inspectedTabId
  const items = (data as { items?: unknown }).items

  if (type !== 'XSTATE_NATIVE_PANEL_MENU_SET') return null
  if (typeof inspectedTabId !== 'number' || !Number.isFinite(inspectedTabId)) return null
  if (!Array.isArray(items)) return null

  const normalizedItems: NativePanelMenuItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') return null
    const id = (item as { id?: unknown }).id
    const label = (item as { label?: unknown }).label
    const disabled = (item as { disabled?: unknown }).disabled

    if (typeof id !== 'string' || !id) return null
    if (typeof label !== 'string' || !label) return null
    if (disabled !== undefined && typeof disabled !== 'boolean') return null

    normalizedItems.push({ id, label, disabled })
  }

  return {
    type,
    inspectedTabId,
    items: normalizedItems,
  }
}

function getCustomSlotMenuId(index: number): string {
  return `${NATIVE_MENU_CUSTOM_SLOT_PREFIX}${index}`
}

function getCustomSlotIndex(menuItemId: unknown): number | null {
  if (typeof menuItemId !== 'string') return null
  if (!menuItemId.startsWith(NATIVE_MENU_CUSTOM_SLOT_PREFIX)) return null

  const suffix = menuItemId.slice(NATIVE_MENU_CUSTOM_SLOT_PREFIX.length)
  const index = Number.parseInt(suffix, 10)
  if (!Number.isFinite(index) || index < 0 || index >= MAX_NATIVE_MENU_CUSTOM_SLOTS) return null
  return index
}

function updateNativePanelMenuItems(items: NativePanelMenuItem[]): void {
  if (!chrome.contextMenus) {
    return
  }

  const visibleCount = Math.min(items.length, MAX_NATIVE_MENU_CUSTOM_SLOTS)

  chrome.contextMenus.update(NATIVE_MENU_CUSTOM_SEPARATOR_ID, { visible: visibleCount > 0 })

  for (let index = 0; index < MAX_NATIVE_MENU_CUSTOM_SLOTS; index += 1) {
    const slotId = getCustomSlotMenuId(index)
    const item = index < visibleCount ? items[index] : null

    chrome.contextMenus.update(slotId, {
      title: item?.label ?? '',
      enabled: item ? !item.disabled : false,
      visible: item !== null,
    })
  }
}

function getNativeMenuAction(menuItemId: unknown): EventLogNativeMenuAction | null {
  switch (menuItemId) {
    case NATIVE_MENU_COPY_VISIBLE_EVENTS_ID:
      return 'copy-visible-events-json'
    case NATIVE_MENU_CLEAR_EVENTS_ID:
      return 'clear-all-events'
    case NATIVE_MENU_TIME_TRAVEL_ID:
      return 'time-travel-toggle-event'
    case NATIVE_MENU_COPY_EVENT_JSON_ID:
      return 'copy-event-json'
    case NATIVE_MENU_COPY_EVENT_TYPE_ID:
      return 'copy-event-type'
    case NATIVE_MENU_COPY_ACTOR_SESSION_ID:
      return 'copy-actor-session-id'
    default:
      return null
  }
}

function createNativeContextMenus() {
  if (!chrome.contextMenus) {
    return
  }

  chrome.contextMenus.removeAll(() => {
    const menuError = chrome.runtime.lastError
    if (menuError) {
      infoLog('background', 'failed to clear existing native menus', { error: menuError.message })
      return
    }

    const contexts: chrome.contextMenus.ContextType[] = ['all']

    chrome.contextMenus.create({
      id: NATIVE_MENU_ROOT_ID,
      title: 'XState DevTools',
      contexts,
    })

    chrome.contextMenus.create({
      id: NATIVE_MENU_COPY_VISIBLE_EVENTS_ID,
      parentId: NATIVE_MENU_ROOT_ID,
      title: 'Copy visible events JSON',
      contexts,
    })

    chrome.contextMenus.create({
      id: NATIVE_MENU_CLEAR_EVENTS_ID,
      parentId: NATIVE_MENU_ROOT_ID,
      title: 'Clear all events',
      contexts,
    })

    chrome.contextMenus.create({
      id: NATIVE_MENU_TIME_TRAVEL_ID,
      parentId: NATIVE_MENU_ROOT_ID,
      title: 'Time travel to event / Back to live',
      contexts,
    })

    chrome.contextMenus.create({
      id: NATIVE_MENU_COPY_EVENT_JSON_ID,
      parentId: NATIVE_MENU_ROOT_ID,
      title: 'Copy event JSON',
      contexts,
    })

    chrome.contextMenus.create({
      id: NATIVE_MENU_COPY_EVENT_TYPE_ID,
      parentId: NATIVE_MENU_ROOT_ID,
      title: 'Copy event type',
      contexts,
    })

    chrome.contextMenus.create({
      id: NATIVE_MENU_COPY_ACTOR_SESSION_ID,
      parentId: NATIVE_MENU_ROOT_ID,
      title: 'Copy actor session id',
      contexts,
    })

    chrome.contextMenus.create({
      id: NATIVE_MENU_CUSTOM_SEPARATOR_ID,
      parentId: NATIVE_MENU_ROOT_ID,
      type: 'separator',
      visible: false,
      contexts,
    })

    for (let index = 0; index < MAX_NATIVE_MENU_CUSTOM_SLOTS; index += 1) {
      chrome.contextMenus.create({
        id: getCustomSlotMenuId(index),
        parentId: NATIVE_MENU_ROOT_ID,
        title: `Custom action ${index + 1}`,
        visible: false,
        contexts,
      })
    }
  })
}

/** Forward a page message to the panel, or buffer it if the panel is not open. */
function forwardToPanel(tabId: number, normalized: MarkedPageMessage): void {
  const port = panelPorts.get(tabId)
  if (port) {
    debugLog('background', 'forwarding page message to panel', {
      tabId,
      message: summarizeMessage(normalized),
    })
    port.postMessage(normalized)
  } else {
    const buf = pendingMessages.get(tabId) ?? []
    buf.push(normalized)
    if (buf.length > MAX_PENDING) buf.shift()
    pendingMessages.set(tabId, buf)
    debugLog('background', 'buffered page message; panel not connected', {
      tabId,
      pendingCount: buf.length,
      message: summarizeMessage(normalized),
    })
  }
}

/**
 * Send XSTATE_PANEL_CONNECTED to the content script for the given tab.
 * Prefers the persistent content-script port (reliable across service-worker
 * restarts) and falls back to chrome.tabs.sendMessage for first-load cases
 * where the content script hasn't yet opened its port.
 */
function sendPanelConnected(tabId: number): void {
  const csPort = contentPorts.get(tabId)
  if (csPort) {
    try {
      infoLog('background', 'sending PANEL_CONNECTED via content port', { tabId })
      csPort.postMessage({ type: 'XSTATE_PANEL_CONNECTED', __xstateDevtools: true })
      return
    } catch (error) {
      if (contentPorts.get(tabId) === csPort) contentPorts.delete(tabId)
      infoLog('background', 'content port unavailable for PANEL_CONNECTED; falling back', {
        tabId,
        error,
      })
    }
  }

  infoLog('background', 'sending PANEL_CONNECTED via chrome.tabs.sendMessage (fallback)', {
    tabId,
  })
  chrome.tabs.sendMessage(
    tabId,
    { type: 'XSTATE_PANEL_CONNECTED', __xstateDevtools: true },
    () => void chrome.runtime.lastError,
  )
}

function queuePanelResync(tabId: number): void {
  const delays = [0, 300, 1000]

  delays.forEach((delayMs) => {
    setTimeout(() => {
      if (!panelPorts.has(tabId)) return

      infoLog('background', 'post-navigation PANEL_CONNECTED retry', {
        tabId,
        delayMs,
        hasContentPort: contentPorts.has(tabId),
      })
      sendPanelConnected(tabId)
    }, delayMs)
  })
}

function normalizeFilePath(filePath: string): string | null {
  const trimmed = filePath.trim()
  if (!trimmed) return null

  const normalizedPlaceholder = trimmed.toLowerCase()
  const slashlessPlaceholder = normalizedPlaceholder.replace(/^[./\\]+/, '')
  if (
    slashlessPlaceholder === '<anonymous>' ||
    slashlessPlaceholder === 'anonymous' ||
    slashlessPlaceholder === '(anonymous)' ||
    slashlessPlaceholder === 'eval' ||
    slashlessPlaceholder === '<eval>' ||
    slashlessPlaceholder === '[native code]'
  ) {
    return null
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return trimmed.replace(/\\/g, '/')
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const pathname = decodeURIComponent(url.pathname)

      if (url.protocol === 'file:') {
        return pathname || null
      }

      if (pathname.startsWith('/@fs/')) {
        return pathname.slice('/@fs'.length)
      }

      // Non-file URLs without /@fs/ are browser paths, not local filesystem paths.
      return null
    } catch {
      return null
    }
  }

  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) &&
    !/^[a-zA-Z]:[\\/]/.test(trimmed) &&
    !trimmed.startsWith('/') &&
    !trimmed.startsWith('./') &&
    !trimmed.startsWith('../')
  ) {
    return null
  }

  return trimmed.replace(/[?#].*$/, '')
}

function parseSourceLocation(sourceLocation: string) {
  const trimmed = sourceLocation.trim()
  const unwrapped = trimmed.match(/\((.*)\)$/)?.[1] ?? trimmed
  const normalizedFrame = unwrapped
    .replace(/^at\s+/, '')
    .replace(/^[^@\s]+@(?=[a-zA-Z][a-zA-Z\d+.-]*:\/\/)/, '')
  const match = normalizedFrame.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/)

  if (!match) return null

  const [, rawFilePath, line, column] = match
  const filePath = rawFilePath ? normalizeFilePath(rawFilePath) : null
  if (!filePath) return null

  return {
    filePath,
    line: line ? Number(line) : undefined,
    column: column ? Number(column) : undefined,
  }
}

function getSourceHref(sourceLocation: string): string | null {
  const parsed = parseSourceLocation(sourceLocation)
  if (!parsed) return null

  const encodedPath = encodeURI(parsed.filePath)
  const pathPrefix = parsed.filePath.startsWith('/') ? '' : '/'
  const suffix = parsed.line ? `:${parsed.line}${parsed.column ? `:${parsed.column}` : ''}` : ''

  return `vscode://file${pathPrefix}${encodedPath}${suffix}`
}

function openSourceLocation(sourceLocation: string): void {
  const href = getSourceHref(sourceLocation)
  if (!href) return

  chrome.tabs.create({ url: href }, () => {
    const error = chrome.runtime.lastError
    if (error) {
      infoLog('background', 'failed to open source location', {
        sourceLocation,
        href,
        error: error.message,
      })
    }
  })
}

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  // ── Content-script persistent port ──────────────────────────────────────
  if (port.name === 'xstate-content') {
    const tabId = port.sender?.tab?.id
    if (tabId == null) return

    contentPorts.set(tabId, port)
    infoLog('background', 'content script port connected', { tabId })

    // If the devtools panel is already open for this tab, trigger a resync
    // immediately.  This handles the case where the MV3 service worker was
    // killed while the panel was open: the content script reconnects ~250 ms
    // later and the panel's actor list needs to be repopulated.
    if (panelPorts.has(tabId)) {
      infoLog(
        'background',
        'panel already connected; sending PANEL_CONNECTED via new content port',
        { tabId },
      )
      sendPanelConnected(tabId)
    }

    // Content script → panel: page inspection events arrive via this port.
    port.onMessage.addListener((message: MarkedPageMessage | PageToExtensionMessage) => {
      if (contentPorts.get(tabId) !== port) {
        debugLog('background', 'ignoring message from superseded content port', {
          tabId,
          message: summarizeMessage(message as PageToExtensionMessage),
        })
        return
      }

      const normalized = asPageMessage(message)
      if (!normalized) return

      if (normalized.type === 'XSTATE_ADAPTER_READY') {
        if (panelPorts.has(tabId)) {
          infoLog('background', 'adapter ready; sending PANEL_CONNECTED for resync', { tabId })
          sendPanelConnected(tabId)
        }
        return
      }

      forwardToPanel(tabId, normalized)
    })

    port.onDisconnect.addListener(() => {
      if (contentPorts.get(tabId) === port) contentPorts.delete(tabId)
      infoLog('background', 'content script port disconnected', { tabId })
    })
    return
  }

  // ── Devtools panel port ──────────────────────────────────────────────────
  const match = port.name.match(/^xstate-panel-(\d+)$/)
  if (!match) return

  const tabId = parseInt(match[1], 10)
  panelPorts.set(tabId, port)

  // Re-register native menus when the panel connects. This guards against
  // cases where the service worker started without menu state.
  createNativeContextMenus()

  infoLog('background', 'panel connected', { tabId, portName: port.name })

  // Flush buffered messages to the newly connected panel
  const pending = pendingMessages.get(tabId) ?? []
  infoLog('background', 'flushing buffered messages to panel', {
    tabId,
    pendingCount: pending.length,
  })
  pending.forEach((msg) => port.postMessage(msg))
  pendingMessages.delete(tabId)

  // Notify the page that the devtools panel is now connected so the adapter
  // can re-broadcast existing state.
  sendPanelConnected(tabId)

  // Guard against old-port onDisconnect firing after a new port is registered
  // (MV3 timing race): only remove if the disconnecting port is still current.
  port.onDisconnect.addListener(() => {
    if (panelPorts.get(tabId) === port) panelPorts.delete(tabId)
    infoLog('background', 'panel disconnected', { tabId, portName: port.name })
  })

  // Panel → content script (dispatch events) or other panel-specific messages
  port.onMessage.addListener((message: unknown) => {
    const obj = message as { type?: string; sourceLocation?: string }

    // Handle XSTATE_OPEN_SOURCE from panel
    if (obj.type === 'XSTATE_OPEN_SOURCE' && typeof obj.sourceLocation === 'string') {
      debugLog('background', 'opening source location from panel', {
        tabId,
        sourceLocation: obj.sourceLocation,
      })
      openSourceLocation(obj.sourceLocation)
      return
    }

    // Handle dispatch messages to content script
    const nativeContextUpdate = asEventLogPanelContextMessage(message)
    if (nativeContextUpdate) {
      latestEventLogContext = {
        inspectedTabId: nativeContextUpdate.inspectedTabId,
        context: nativeContextUpdate.context,
      }
      return
    }

    const nativePanelMenuUpdate = asNativePanelMenuSetMessage(message)
    if (nativePanelMenuUpdate) {
      latestNativePanelMenu = {
        inspectedTabId: nativePanelMenuUpdate.inspectedTabId,
        items: nativePanelMenuUpdate.items,
      }
      updateNativePanelMenuItems(nativePanelMenuUpdate.items)
      return
    }

    const dispatch = asDispatchMessage(message)
    if (dispatch) {
      debugLog('background', 'forwarding dispatch from panel to tab', {
        tabId,
        message: summarizeMessage(dispatch),
      })
      const csPort = contentPorts.get(tabId)
      if (csPort) {
        csPort.postMessage(dispatch)
      } else {
        chrome.tabs.sendMessage(tabId, dispatch, () => void chrome.runtime.lastError)
      }
    }
  })
})

createNativeContextMenus()

if (chrome.contextMenus) {
  chrome.runtime.onInstalled.addListener(() => {
    createNativeContextMenus()
  })

  chrome.contextMenus.onClicked.addListener((info) => {
    const customSlotIndex = getCustomSlotIndex(info.menuItemId)
    if (customSlotIndex !== null && latestNativePanelMenu) {
      const selectedItem = latestNativePanelMenu.items[customSlotIndex]
      if (!selectedItem || selectedItem.disabled) {
        return
      }

      const customActionMessage: NativePanelMenuActionMessage = {
        type: 'XSTATE_NATIVE_PANEL_MENU_ACTION',
        inspectedTabId: latestNativePanelMenu.inspectedTabId,
        itemId: selectedItem.id,
      }

      chrome.runtime.sendMessage(customActionMessage, () => void chrome.runtime.lastError)
      return
    }

    const action = getNativeMenuAction(info.menuItemId)
    if (!action || !latestEventLogContext) {
      return
    }

    const message: EventLogNativeMenuActionMessage = {
      type: 'XSTATE_EVENT_LOG_NATIVE_MENU_ACTION',
      inspectedTabId: latestEventLogContext.inspectedTabId,
      action,
      context: latestEventLogContext.context,
    }

    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError)
  })
}

// Clean up when tab is closed or navigated
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingMessages.delete(tabId)
  panelPorts.delete(tabId)
  contentPorts.delete(tabId)
  infoLog('background', 'tab removed; cleared panel state', { tabId })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Tab navigated — stale buffered messages are no longer valid.
    // Also tell the panel so it clears stale actors from the previous page.
    pendingMessages.delete(tabId)
    const panelPort = panelPorts.get(tabId)
    if (panelPort) {
      try {
        panelPort.postMessage({ type: 'XSTATE_PAGE_NAVIGATED' })
      } catch {
        /* port closing */
      }
    }
    infoLog('background', 'tab started loading; cleared pending messages', { tabId })
    return
  }

  if (changeInfo.status === 'complete' && panelPorts.has(tabId)) {
    // Some reloads race page boot against the initial PANEL_CONNECTED signal.
    // Retry a few times after the navigation completes so the freshly loaded
    // adapter can resync once its bridge and actors are ready.
    queuePanelResync(tabId)
  }
})

// Fallback: content script → panel via chrome.runtime.sendMessage.
// Used during the ~250 ms reconnect window when the persistent port is not yet
// re-established after a service-worker restart.
chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender) => {
  const panelMessage = asPanelToBackgroundMessage(message)
  if (panelMessage) {
    infoLog('background', 'opening source location from runtime message', {
      sourceLocation: panelMessage.sourceLocation,
    })
    openSourceLocation(panelMessage.sourceLocation)
    return
  }

  const normalized = asPageMessage(message)
  if (!normalized) return
  const tabId = sender.tab?.id
  if (tabId == null) return

  if (normalized.type === 'XSTATE_ADAPTER_READY') {
    if (panelPorts.has(tabId)) {
      infoLog(
        'background',
        'adapter ready (sendMessage fallback); sending PANEL_CONNECTED for resync',
        { tabId },
      )
      sendPanelConnected(tabId)
    }
    return
  }

  forwardToPanel(tabId, normalized)
})

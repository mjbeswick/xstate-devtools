import type {
  ExtensionToPageMessage,
  MarkedExtensionMessage,
  MarkedPageMessage,
  PageToExtensionMessage,
} from './types.js'

type ProtocolMessage =
  | ExtensionToPageMessage
  | MarkedExtensionMessage
  | MarkedPageMessage
  | PageToExtensionMessage

function isProtocolMessage(value: unknown): value is ProtocolMessage {
  return typeof value === 'object' && value !== null && 'type' in value
}

export function summarizeMessage(message: unknown) {
  if (!isProtocolMessage(message)) return message

  const summary: Record<string, unknown> = {
    type: message.type,
  }

  if ('sessionId' in message) summary.sessionId = message.sessionId
  if ('parentSessionId' in message && message.parentSessionId) {
    summary.parentSessionId = message.parentSessionId
  }
  if ('globalSeq' in message) summary.globalSeq = message.globalSeq
  if ('timestamp' in message) summary.timestamp = message.timestamp
  if ('event' in message && message.event && typeof message.event === 'object' && 'type' in message.event) {
    summary.eventType = message.event.type
  }

  return summary
}

export function debugLog(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.debug(`[xstate-devtools:${scope}] ${message}`)
    return
  }
  console.debug(`[xstate-devtools:${scope}] ${message}`, details)
}

export function infoLog(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[xstate-devtools:${scope}] ${message}`)
    return
  }
  console.info(`[xstate-devtools:${scope}] ${message}`, details)
}

export function warnLog(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.warn(`[xstate-devtools:${scope}] ${message}`)
    return
  }
  console.warn(`[xstate-devtools:${scope}] ${message}`, details)
}
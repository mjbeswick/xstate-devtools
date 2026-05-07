// Transport-agnostic XState inspection core.
// Browser and server entrypoints supply their own transports.
import type { AnyActorRef } from 'xstate'
import type {
  ExtensionToPageMessage, PageToExtensionMessage, SerializedSnapshot,
} from '../../extension/src/shared/types.js'
import { serializeMachine } from './serialize.js'
import { sanitize } from './sanitize.js'

export type Source = 'web' | 'srv'

export interface Transport {
  /** Send a protocol message outbound (toward the panel). */
  send: (message: PageToExtensionMessage) => void
  /** Subscribe to inbound dispatch messages from the panel. Returns a teardown. */
  subscribe: (handler: (message: ExtensionToPageMessage) => void) => () => void
}

function summarizeMessage(message: ExtensionToPageMessage | PageToExtensionMessage) {
  const summary: Record<string, unknown> = { type: message.type }
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

function summarizeInspectionEvent(event: any) {
  return {
    type: event?.type,
    sessionId: event?.actorRef?.sessionId,
    eventType:
      event?.type === '@xstate.event' && event?.event && typeof event.event === 'object'
        ? event.event.type
        : undefined,
  }
}

function debugLog(source: Source, message: string, details?: unknown) {
  if (details === undefined) {
    console.debug(`[xstate-devtools:${source}:adapter] ${message}`)
    return
  }
  console.debug(`[xstate-devtools:${source}:adapter] ${message}`, details)
}

function infoLog(source: Source, message: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[xstate-devtools:${source}:adapter] ${message}`)
    return
  }
  console.info(`[xstate-devtools:${source}:adapter] ${message}`, details)
}

function warnLog(source: Source, message: string, details?: unknown) {
  if (details === undefined) {
    console.warn(`[xstate-devtools:${source}:adapter] ${message}`)
    return
  }
  console.warn(`[xstate-devtools:${source}:adapter] ${message}`, details)
}

function getSourceLocation(): string | undefined {
  try {
    const lines = new Error().stack?.split('\n') ?? []
    const callerLine = lines.find(
      (l, i) => i > 3 && !l.includes('xstate') && !l.includes('adapter')
    )
    return callerLine?.trim().replace(/^at\s+/, '')
  } catch {
    return undefined
  }
}

function serializeSnapshot(snapshot: any): SerializedSnapshot {
  return {
    value: snapshot?.value ?? null,
    context: sanitize(snapshot?.context),
    status: snapshot?.status ?? 'active',
    error: snapshot?.error ? sanitize(snapshot.error) : undefined,
  }
}

function safeSerializeSnapshot(actorRef: AnyActorRef): SerializedSnapshot {
  try {
    return serializeSnapshot(actorRef.getSnapshot())
  } catch {
    return { value: null, context: undefined, status: 'active' }
  }
}

// Cached on globalThis so HMR re-evaluating this module doesn't reset the
// monotonic seq counter mid-session. The panel re-numbers messages on ingest
// to merge multiple sources, but keeping a stable per-process seq still helps
// when the panel reconnects to an already-running adapter.
const SEQ_KEY = '__xstate_devtools_global_seq__'
function nextSeq(): number {
  const g = globalThis as Record<string, unknown>
  const cur = (g[SEQ_KEY] as number | undefined) ?? 0
  const next = cur + 1
  g[SEQ_KEY] = next
  return next
}

export function createInspector(transport: Transport, source: Source) {
  const actorRefs = new Map<string, AnyActorRef>()
  const prefix = source + ':'
  const tag = (sessionId: string) => prefix + sessionId
  const tagOptional = (id: string | undefined) => (id ? prefix + id : undefined)
  const stripIfMine = (id: string): string | null =>
    id.startsWith(prefix) ? id.slice(prefix.length) : null

  function checkAndNotifyStop(actorRef: AnyActorRef) {
    let snap: any
    try { snap = actorRef.getSnapshot() } catch { return }
    if (snap?.status !== 'active') {
      const message: PageToExtensionMessage = {
        type: 'XSTATE_ACTOR_STOPPED',
        sessionId: tag(actorRef.sessionId),
      }
      debugLog(source, 'actor stopped; notifying transport', summarizeMessage(message))
      transport.send(message)
      actorRefs.delete(actorRef.sessionId)
    }
  }

  const unsubscribe = transport.subscribe((message) => {
    debugLog(source, 'received message from transport', summarizeMessage(message))
    if (message.type === 'XSTATE_PANEL_CONNECTED') {
      // The devtools panel just connected (or reconnected).  Re-broadcast every
      // currently-active actor so the panel is never blank because the MV3
      // service worker was killed between page load and panel open.
      infoLog(source, 'panel connected; resyncing actors', { actorCount: actorRefs.size })
      actorRefs.forEach((actorRef, sessionId) => {
        const actorLogic = (actorRef as { logic?: unknown }).logic as any
        const machine = actorLogic?.root
          ? serializeMachine(actorLogic, getSourceLocation())
          : null
        const resyncMessage: PageToExtensionMessage = {
          type: 'XSTATE_ACTOR_REGISTERED',
          sessionId: tag(sessionId),
          parentSessionId: tagOptional((actorRef as any)._parent?.sessionId),
          machine,
          snapshot: safeSerializeSnapshot(actorRef),
          globalSeq: nextSeq(),
          timestamp: Date.now(),
        }
        debugLog(source, 'resyncing actor', summarizeMessage(resyncMessage))
        transport.send(resyncMessage)
      })
      return
    }
    if (message.type === 'XSTATE_DISPATCH') {
      const local = stripIfMine(message.sessionId)
      if (local === null) {
        debugLog(source, 'ignoring dispatch for different source', summarizeMessage(message))
        return // not for this transport source
      }
      const ref = actorRefs.get(local)
      if (ref) {
        try {
          debugLog(source, 'dispatching event to actor', {
            sessionId: local,
            eventType:
              message.event && typeof message.event === 'object' && 'type' in message.event
                ? message.event.type
                : undefined,
          })
          ref.send(message.event)
        } catch (e) {
          warnLog(source, 'dispatch error', { error: e, sessionId: local })
        }
      } else {
        warnLog(source, 'received dispatch for unknown actor', {
          sessionId: local,
          knownActors: actorRefs.size,
        })
      }
    }
  })

  // Notify the extension that the adapter is ready
  transport.send({ type: 'XSTATE_ADAPTER_READY' })

  infoLog(source, 'inspector created')

  const inspect = (inspectionEvent: any) => {
    debugLog(source, 'inspect callback invoked', summarizeInspectionEvent(inspectionEvent))
    if (inspectionEvent.type === '@xstate.actor') {
      const actorRef: AnyActorRef = inspectionEvent.actorRef
      const sessionId: string = actorRef.sessionId
      actorRefs.set(sessionId, actorRef)

      const actorLogic = (actorRef as { logic?: unknown }).logic as any
      const machine = actorLogic?.root
        ? serializeMachine(actorLogic, getSourceLocation())
        : null

      const message: PageToExtensionMessage = {
        type: 'XSTATE_ACTOR_REGISTERED',
        sessionId: tag(sessionId),
        parentSessionId: tagOptional((actorRef as any)._parent?.sessionId),
        machine,
        snapshot: safeSerializeSnapshot(actorRef),
        globalSeq: nextSeq(),
        timestamp: Date.now(),
      }
      infoLog(source, 'registering actor with transport', {
        message: summarizeMessage(message),
        actorCount: actorRefs.size,
        hasMachine: machine !== null,
      })
      transport.send(message)
    } else if (inspectionEvent.type === '@xstate.snapshot') {
      const message: PageToExtensionMessage = {
        type: 'XSTATE_SNAPSHOT',
        sessionId: tag(inspectionEvent.actorRef.sessionId),
        snapshot: serializeSnapshot(inspectionEvent.snapshot),
        timestamp: Date.now(),
        globalSeq: nextSeq(),
      }
      debugLog(source, 'sending snapshot to transport', summarizeMessage(message))
      transport.send(message)
      checkAndNotifyStop(inspectionEvent.actorRef)
    } else if (inspectionEvent.type === '@xstate.event') {
      const message: PageToExtensionMessage = {
        type: 'XSTATE_EVENT',
        sessionId: tag(inspectionEvent.actorRef.sessionId),
        event: inspectionEvent.event,
        snapshotAfter: safeSerializeSnapshot(inspectionEvent.actorRef),
        timestamp: Date.now(),
        globalSeq: nextSeq(),
      }
      debugLog(source, 'sending event to transport', summarizeMessage(message))
      transport.send(message)
      checkAndNotifyStop(inspectionEvent.actorRef)
    } else {
      debugLog(source, 'ignoring unsupported inspection event', summarizeInspectionEvent(inspectionEvent))
    }
  }

  function dispose() {
    infoLog(source, 'disposing inspector', { actorCount: actorRefs.size })
    unsubscribe()
    actorRefs.clear()
  }

  return { inspect, dispose }
}

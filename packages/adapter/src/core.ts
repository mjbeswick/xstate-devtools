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
      transport.send({ type: 'XSTATE_ACTOR_STOPPED', sessionId: tag(actorRef.sessionId) })
      actorRefs.delete(actorRef.sessionId)
    }
  }

  const unsubscribe = transport.subscribe((message) => {
    if (message.type === 'XSTATE_DISPATCH') {
      const local = stripIfMine(message.sessionId)
      if (local === null) return // not for this transport source
      const ref = actorRefs.get(local)
      if (ref) {
        try { ref.send(message.event) } catch (e) {
          console.warn('[xstate-devtools] dispatch error:', e)
        }
      }
    }
  })

  const inspect = (inspectionEvent: any) => {
    if (inspectionEvent.type === '@xstate.actor') {
      const actorRef: AnyActorRef = inspectionEvent.actorRef
      const sessionId: string = actorRef.sessionId
      actorRefs.set(sessionId, actorRef)

      const machine = actorRef.logic?.root
        ? serializeMachine(actorRef.logic as any, getSourceLocation())
        : null

      transport.send({
        type: 'XSTATE_ACTOR_REGISTERED',
        sessionId: tag(sessionId),
        parentSessionId: tagOptional((actorRef as any)._parent?.sessionId),
        machine,
        snapshot: safeSerializeSnapshot(actorRef),
        globalSeq: nextSeq(),
        timestamp: Date.now(),
      })
    } else if (inspectionEvent.type === '@xstate.snapshot') {
      transport.send({
        type: 'XSTATE_SNAPSHOT',
        sessionId: tag(inspectionEvent.actorRef.sessionId),
        snapshot: serializeSnapshot(inspectionEvent.snapshot),
        timestamp: Date.now(),
        globalSeq: nextSeq(),
      })
      checkAndNotifyStop(inspectionEvent.actorRef)
    } else if (inspectionEvent.type === '@xstate.event') {
      transport.send({
        type: 'XSTATE_EVENT',
        sessionId: tag(inspectionEvent.actorRef.sessionId),
        event: inspectionEvent.event,
        snapshotAfter: safeSerializeSnapshot(inspectionEvent.actorRef),
        timestamp: Date.now(),
        globalSeq: nextSeq(),
      })
      checkAndNotifyStop(inspectionEvent.actorRef)
    }
  }

  function dispose() {
    unsubscribe()
    actorRefs.clear()
  }

  return { inspect, dispose }
}

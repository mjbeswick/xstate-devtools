// Transport-agnostic XState inspection core.
// Browser and server entrypoints supply their own transports.
import type { AnyActorRef } from 'xstate'
import type {
  ExtensionToPageMessage, PageToExtensionMessage, SerializedSnapshot,
} from '../../extension/src/shared/types.js'
import { serializeMachine } from './serialize.js'
import { sanitize } from './sanitize.js'

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

let globalSeq = 0

export function createInspector(transport: Transport) {
  const actorRefs = new Map<string, AnyActorRef>()

  function checkAndNotifyStop(actorRef: AnyActorRef) {
    let snap: any
    try { snap = actorRef.getSnapshot() } catch { return }
    if (snap?.status !== 'active') {
      transport.send({ type: 'XSTATE_ACTOR_STOPPED', sessionId: actorRef.sessionId })
      actorRefs.delete(actorRef.sessionId)
    }
  }

  const unsubscribe = transport.subscribe((message) => {
    if (message.type === 'XSTATE_DISPATCH') {
      const ref = actorRefs.get(message.sessionId)
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

      globalSeq++
      transport.send({
        type: 'XSTATE_ACTOR_REGISTERED',
        sessionId,
        parentSessionId: (actorRef as any)._parent?.sessionId,
        machine,
        snapshot: safeSerializeSnapshot(actorRef),
        globalSeq,
        timestamp: Date.now(),
      })
    } else if (inspectionEvent.type === '@xstate.snapshot') {
      globalSeq++
      transport.send({
        type: 'XSTATE_SNAPSHOT',
        sessionId: inspectionEvent.actorRef.sessionId,
        snapshot: serializeSnapshot(inspectionEvent.snapshot),
        timestamp: Date.now(),
        globalSeq,
      })
      checkAndNotifyStop(inspectionEvent.actorRef)
    } else if (inspectionEvent.type === '@xstate.event') {
      globalSeq++
      transport.send({
        type: 'XSTATE_EVENT',
        sessionId: inspectionEvent.actorRef.sessionId,
        event: inspectionEvent.event,
        snapshotAfter: safeSerializeSnapshot(inspectionEvent.actorRef),
        timestamp: Date.now(),
        globalSeq,
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

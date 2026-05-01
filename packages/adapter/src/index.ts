// packages/adapter/src/index.ts
import type { AnyActorRef } from 'xstate'
import type { SerializedSnapshot } from '../../extension/src/shared/types.js'
import { serializeMachine } from './serialize.js'
import { sanitize } from './sanitize.js'

declare global {
  interface Window {
    __XSTATE_DEVTOOLS__?: {
      send: (message: unknown) => void
    }
  }
}

function getSourceLocation(): string | undefined {
  try {
    const lines = new Error().stack?.split('\n') ?? []
    // skip Error, getSourceLocation, inspect callback, xstate internals (3-4 frames)
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

let globalSeq = 0

export function createAdapter() {
  const actorRefs = new Map<string, AnyActorRef>()

  function postToExtension(message: unknown) {
    window.__XSTATE_DEVTOOLS__?.send({ ...message as object, __xstateDevtools: true })
  }

  function checkAndNotifyStop(actorRef: AnyActorRef) {
    const snap = actorRef.getSnapshot()
    if (snap?.status !== 'active') {
      postToExtension({
        type: 'XSTATE_ACTOR_STOPPED',
        sessionId: actorRef.sessionId,
      })
      actorRefs.delete(actorRef.sessionId)
    }
  }

  function handleDispatch(evt: MessageEvent) {
    if (evt.source !== window) return
    const data = evt.data
    if (!data?.__xstateDevtools) return
    if (data.type === 'XSTATE_DISPATCH') {
      const ref = actorRefs.get(data.sessionId)
      if (ref) {
        try { ref.send(data.event) } catch (e) {
          console.warn('[xstate-devtools] dispatch error:', e)
        }
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', handleDispatch)
  }

  const inspect = (inspectionEvent: any) => {
    if (typeof window === 'undefined' || !window.__XSTATE_DEVTOOLS__) return

    if (inspectionEvent.type === '@xstate.actor') {
      const actorRef: AnyActorRef = inspectionEvent.actorRef
      const sessionId: string = actorRef.sessionId
      actorRefs.set(sessionId, actorRef)

      const machine = actorRef.logic?.root
        ? serializeMachine(actorRef.logic as any, getSourceLocation())
        : null

      const snapshot = serializeSnapshot(actorRef.getSnapshot())

      globalSeq++
      postToExtension({
        type: 'XSTATE_ACTOR_REGISTERED',
        sessionId,
        parentSessionId: (actorRef as any)._parent?.sessionId,
        machine,
        snapshot,
        globalSeq,
        timestamp: Date.now(),
      })
    } else if (inspectionEvent.type === '@xstate.snapshot') {
      globalSeq++
      postToExtension({
        type: 'XSTATE_SNAPSHOT',
        sessionId: inspectionEvent.actorRef.sessionId,
        snapshot: serializeSnapshot(inspectionEvent.snapshot),
        timestamp: Date.now(),
        globalSeq,
      })
      checkAndNotifyStop(inspectionEvent.actorRef)
    } else if (inspectionEvent.type === '@xstate.event') {
      globalSeq++
      postToExtension({
        type: 'XSTATE_EVENT',
        sessionId: inspectionEvent.actorRef.sessionId,
        event: inspectionEvent.event,
        snapshotAfter: serializeSnapshot(inspectionEvent.actorRef.getSnapshot()),
        timestamp: Date.now(),
        globalSeq,
      })
      checkAndNotifyStop(inspectionEvent.actorRef)
    }
  }

  function dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', handleDispatch)
    }
    actorRefs.clear()
  }

  return { inspect, dispose }
}

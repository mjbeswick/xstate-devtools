// Transport-agnostic XState inspection core.
// Browser and server entrypoints supply their own transports.
import type { AnyActorRef } from 'xstate'
import type {
  ExtensionToPageMessage,
  PageToExtensionMessage,
  SerializedSnapshot,
} from '../../extension/src/shared/types.js'
import {
  debugLog as baseDebugLog,
  infoLog as baseInfoLog,
  warnLog as baseWarnLog,
} from './logging.js'
import { sanitize } from './sanitize.js'
import { serializeMachine } from './serialize.js'

export type Source = 'web' | 'srv'

export interface Transport {
  /** Send a protocol message outbound (toward the panel). */
  send: (message: PageToExtensionMessage) => void
  /** Subscribe to inbound dispatch messages from the panel. Returns a teardown. */
  subscribe: (handler: (message: ExtensionToPageMessage) => void) => () => void
}

type StateValue = string | { [key: string]: StateValue }

interface StateNodeLike {
  id: string
  key: string
  type: 'atomic' | 'compound' | 'parallel' | 'final' | 'history' | string
  parent?: StateNodeLike
  states?: Record<string, StateNodeLike>
  initial?: string | { target?: StateNodeLike[] }
}

interface MachineLike {
  root: StateNodeLike
  getStateNodeById: (id: string) => StateNodeLike
  resolveState: (snapshot: {
    value: unknown
    context?: unknown
    status?: string
    output?: unknown
    error?: unknown
    historyValue?: unknown
  }) => unknown
}

interface MutableActorRef extends AnyActorRef {
  logic?: MachineLike
  update?: (snapshot: unknown, event: { type: string; stateNodeId: string }) => void
}

function summarizeMessage(message: ExtensionToPageMessage | PageToExtensionMessage) {
  const summary: Record<string, unknown> = { type: message.type }
  if ('sessionId' in message) summary.sessionId = message.sessionId
  if ('stateNodeId' in message) summary.stateNodeId = message.stateNodeId
  if ('parentSessionId' in message && message.parentSessionId) {
    summary.parentSessionId = message.parentSessionId
  }
  if ('globalSeq' in message) summary.globalSeq = message.globalSeq
  if ('timestamp' in message) summary.timestamp = message.timestamp
  if (
    'event' in message &&
    message.event &&
    typeof message.event === 'object' &&
    'type' in message.event
  ) {
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
  baseDebugLog(`${source}:adapter`, message, details)
}

function infoLog(source: Source, message: string, details?: unknown) {
  baseInfoLog(`${source}:adapter`, message, details)
}

function warnLog(source: Source, message: string, details?: unknown) {
  baseWarnLog(`${source}:adapter`, message, details)
}

function getSourceLocation(): string | undefined {
  try {
    const lines = new Error().stack?.split('\n') ?? []
    const callerLine = lines.find(
      (l, i) => i > 3 && !l.includes('xstate') && !l.includes('adapter'),
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

function getActorDisplayName(actorRef: AnyActorRef): string | undefined {
  const actor = actorRef as {
    logic?: { id?: string; src?: unknown; name?: string } | undefined
    src?: unknown
  }

  const src = actor.src ?? actor.logic?.src
  if (typeof src === 'string' && src.length > 0) return src
  if (typeof actor.logic?.id === 'string' && actor.logic.id.length > 0) return actor.logic.id
  if (typeof actor.logic?.name === 'string' && actor.logic.name.length > 0) return actor.logic.name
  if (src && typeof src === 'object') {
    const namedSrc = src as { id?: string; name?: string }
    if (typeof namedSrc.id === 'string' && namedSrc.id.length > 0) return namedSrc.id
    if (typeof namedSrc.name === 'string' && namedSrc.name.length > 0) return namedSrc.name
  }
  return undefined
}

function getNodeInitialChild(node: StateNodeLike): StateNodeLike | null {
  if (!node.states) return null
  if (typeof node.initial === 'string') {
    return node.states[node.initial] ?? null
  }

  const target = Array.isArray(node.initial?.target) ? node.initial.target[0] : null
  return target ?? null
}

function encodeChildValue(child: StateNodeLike, childValue: StateValue): StateValue {
  if (child.type === 'atomic' || child.type === 'final' || child.type === 'history') {
    return child.key
  }

  return { [child.key]: childValue }
}

function getDefaultStateValue(node: StateNodeLike): StateValue {
  if (node.type === 'parallel') {
    const value: Record<string, StateValue> = {}
    for (const child of Object.values(node.states ?? {})) {
      value[child.key] = getDefaultSelectionValue(child)
    }
    return value
  }

  const initialChild = getNodeInitialChild(node)
  if (!initialChild) return {}
  return encodeChildValue(initialChild, getDefaultStateValue(initialChild))
}

function getDefaultSelectionValue(node: StateNodeLike): StateValue {
  if (node.type === 'atomic' || node.type === 'final' || node.type === 'history') {
    return node.key
  }

  return getDefaultStateValue(node)
}

function getExistingChildValue(value: unknown, childKey: string): StateValue | undefined {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, StateValue>)[childKey]
}

function getPathToRoot(target: StateNodeLike, root: StateNodeLike): StateNodeLike[] {
  const path: StateNodeLike[] = []
  let current: StateNodeLike | undefined = target

  while (current) {
    path.unshift(current)
    if (current.id === root.id) return path
    current = current.parent
  }

  throw new Error(`State node '${target.id}' is not part of machine '${root.id}'`)
}

function buildTargetStateValue(
  node: StateNodeLike,
  path: StateNodeLike[],
  currentValue: unknown,
): StateValue {
  const [, ...restPath] = path

  if (restPath.length === 0) {
    if (node.type === 'parallel') {
      const next: Record<string, StateValue> = {}
      for (const child of Object.values(node.states ?? {})) {
        next[child.key] =
          getExistingChildValue(currentValue, child.key) ?? getDefaultSelectionValue(child)
      }
      return next
    }

    if (node.type === 'compound') {
      return getDefaultStateValue(node)
    }

    return node.key
  }

  const child = restPath[0]
  if (node.type === 'parallel') {
    const next: Record<string, StateValue> = {}
    for (const sibling of Object.values(node.states ?? {})) {
      if (sibling.key === child.key) {
        next[sibling.key] = buildTargetStateValue(
          sibling,
          restPath,
          getExistingChildValue(currentValue, sibling.key),
        )
      } else {
        next[sibling.key] =
          getExistingChildValue(currentValue, sibling.key) ?? getDefaultSelectionValue(sibling)
      }
    }
    return next
  }

  const childValue = buildTargetStateValue(
    child,
    restPath,
    getExistingChildValue(currentValue, child.key),
  )
  return encodeChildValue(child, childValue)
}

function setActiveState(actorRef: AnyActorRef, stateNodeId: string): void {
  const mutableActorRef = actorRef as MutableActorRef
  const machine = mutableActorRef.logic
  if (!machine?.getStateNodeById || !machine.resolveState || typeof mutableActorRef.update !== 'function') {
    throw new Error('Actor does not expose machine state mutation internals')
  }

  const currentSnapshot = actorRef.getSnapshot() as {
    value: unknown
    context?: unknown
    status?: string
    output?: unknown
    error?: unknown
    historyValue?: unknown
  }
  const targetNode = machine.getStateNodeById(stateNodeId)
  const path = getPathToRoot(targetNode, machine.root)
  const targetValue = buildTargetStateValue(machine.root, path, currentSnapshot?.value)

  const nextSnapshot = machine.resolveState({
    value: targetValue,
    context: currentSnapshot?.context,
    status: currentSnapshot?.status,
    output: currentSnapshot?.output,
    error: currentSnapshot?.error,
    historyValue: currentSnapshot?.historyValue,
  })

  mutableActorRef.update(nextSnapshot, {
    type: 'xstate.devtools.set-active-state',
    stateNodeId,
  })
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
  const prefix = `${source}:`
  const tag = (sessionId: string) => prefix + sessionId
  const tagOptional = (id: string | undefined) => (id ? prefix + id : undefined)
  const stripIfMine = (id: string): string | null =>
    id.startsWith(prefix) ? id.slice(prefix.length) : null

  function checkAndNotifyStop(actorRef: AnyActorRef) {
    let snap: any
    try {
      snap = actorRef.getSnapshot()
    } catch {
      return
    }
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
        const machine = actorLogic?.root ? serializeMachine(actorLogic, getSourceLocation()) : null
        const resyncMessage: PageToExtensionMessage = {
          type: 'XSTATE_ACTOR_REGISTERED',
          sessionId: tag(sessionId),
          parentSessionId: tagOptional((actorRef as any)._parent?.sessionId),
          displayName: getActorDisplayName(actorRef),
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
      return
    }
    if (message.type === 'XSTATE_SET_ACTIVE_STATE') {
      const local = stripIfMine(message.sessionId)
      if (local === null) {
        debugLog(source, 'ignoring state activation for different source', summarizeMessage(message))
        return
      }

      const ref = actorRefs.get(local)
      if (!ref) {
        warnLog(source, 'received state activation for unknown actor', {
          sessionId: local,
          knownActors: actorRefs.size,
        })
        return
      }

      try {
        debugLog(source, 'setting active state on actor', summarizeMessage(message))
        setActiveState(ref, message.stateNodeId)
      } catch (error) {
        warnLog(source, 'failed to set active state', {
          error,
          sessionId: local,
          stateNodeId: message.stateNodeId,
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
      const machine = actorLogic?.root ? serializeMachine(actorLogic, getSourceLocation()) : null

      const message: PageToExtensionMessage = {
        type: 'XSTATE_ACTOR_REGISTERED',
        sessionId: tag(sessionId),
        parentSessionId: tagOptional((actorRef as any)._parent?.sessionId),
        displayName: getActorDisplayName(actorRef),
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
        event: sanitize(inspectionEvent.event),
        snapshotAfter: safeSerializeSnapshot(inspectionEvent.actorRef),
        timestamp: Date.now(),
        globalSeq: nextSeq(),
      }
      debugLog(source, 'sending event to transport', summarizeMessage(message))
      transport.send(message)
      checkAndNotifyStop(inspectionEvent.actorRef)
    } else {
      debugLog(
        source,
        'ignoring unsupported inspection event',
        summarizeInspectionEvent(inspectionEvent),
      )
    }
  }

  function dispose() {
    infoLog(source, 'disposing inspector', { actorCount: actorRefs.size })
    unsubscribe()
    actorRefs.clear()
  }

  return { inspect, dispose }
}

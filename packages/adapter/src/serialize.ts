// packages/adapter/src/serialize.ts
import type { AnyStateMachine } from 'xstate'
import type {
  SerializedInvoke,
  SerializedMachine,
  SerializedStateNode,
  SerializedTransition,
} from '../../extension/src/shared/types.js'

const MAX_SERIALIZED_NODES = 500
const MAX_TRANSITIONS_PER_NODE = 100
const MAX_CHILD_STATES = 100
const MAX_ACTIONS_PER_TRANSITION = 20
const MAX_ENTRY_EXIT_ACTIONS = 20
const MAX_INVOKES_PER_NODE = 20

function serializeGuard(guard: unknown): string | undefined {
  if (!guard) return undefined
  if (typeof guard === 'string') return guard
  if (typeof guard === 'function') return (guard as Function).name || '(inline)'
  if (typeof guard === 'object' && guard !== null) {
    const g = guard as any
    return g.type ?? g.name ?? '(inline)'
  }
  return '(inline)'
}

function serializeAction(action: unknown): string {
  if (typeof action === 'string') return action
  if (typeof action === 'function') return (action as Function).name || '(anonymous)'
  if (typeof action === 'object' && action !== null) {
    const a = action as any
    return a.type ?? a.name ?? String(action)
  }
  return String(action)
}

function serializeTransitionList(transitions: any[]): SerializedTransition[] {
  return transitions.slice(0, MAX_TRANSITIONS_PER_NODE).map((t: any) => ({
    eventType: t.eventType ?? '',
    targets: (t.target ?? []).map((n: any) => n?.id ?? String(n)).filter(Boolean),
    guard: serializeGuard(t.guard),
    actions: (t.actions ?? [])
      .slice(0, MAX_ACTIONS_PER_TRANSITION)
      .map(serializeAction)
      .filter(Boolean),
  }))
}

function serializeInvokes(node: any): SerializedInvoke[] {
  return (node.invoke as any[]).slice(0, MAX_INVOKES_PER_NODE).map((inv: any) => ({
    id: inv.id ?? '(unknown)',
    src: typeof inv.src === 'string' ? inv.src : (inv.src?.id ?? inv.src?.name ?? '(inline)'),
  }))
}

interface SerializeState {
  seen: WeakSet<object>
  count: number
}

function serializeNode(node: any, state: SerializeState): SerializedStateNode {
  if (!node || typeof node !== 'object') {
    return {
      id: '(unknown)',
      key: '(unknown)',
      type: 'atomic',
      states: {},
      on: [],
      always: [],
      entry: [],
      exit: [],
      invoke: [],
    }
  }

  if (state.count >= MAX_SERIALIZED_NODES) {
    return {
      id: node.id ?? '(truncated)',
      key: node.key ?? '(truncated)',
      type: node.type ?? 'atomic',
      states: {},
      on: [],
      always: [],
      entry: [],
      exit: [],
      invoke: [],
    }
  }

  if (state.seen.has(node)) {
    return {
      id: node.id ?? '(circular)',
      key: node.key ?? '(circular)',
      type: node.type ?? 'atomic',
      states: {},
      on: [],
      always: [],
      entry: [],
      exit: [],
      invoke: [],
    }
  }

  state.seen.add(node)
  state.count += 1

  const allTransitions: SerializedTransition[] = []
  if (node.transitions instanceof Map) {
    for (const [, tList] of node.transitions) {
      if (allTransitions.length >= MAX_TRANSITIONS_PER_NODE) break
      allTransitions.push(...serializeTransitionList(tList))
      if (allTransitions.length >= MAX_TRANSITIONS_PER_NODE) {
        allTransitions.length = MAX_TRANSITIONS_PER_NODE
        break
      }
    }
  }

  const always = Array.isArray(node.always) ? serializeTransitionList(node.always) : []
  const childEntries = Object.entries(node.states ?? {}).slice(0, MAX_CHILD_STATES)

  return {
    id: node.id,
    key: node.key,
    type: node.type,
    initial: node.initial?.target?.[0]?.key,
    states: Object.fromEntries(childEntries.map(([k, v]) => [k, serializeNode(v, state)])),
    on: allTransitions,
    always,
    entry: (node.entry ?? []).slice(0, MAX_ENTRY_EXIT_ACTIONS).map(serializeAction).filter(Boolean),
    exit: (node.exit ?? []).slice(0, MAX_ENTRY_EXIT_ACTIONS).map(serializeAction).filter(Boolean),
    invoke: serializeInvokes(node),
  }
}

export function serializeMachine(
  machine: AnyStateMachine,
  sourceLocation?: string,
): SerializedMachine {
  return {
    id: machine.id,
    root: serializeNode(machine.root, { seen: new WeakSet<object>(), count: 0 }),
    sourceLocation,
  }
}

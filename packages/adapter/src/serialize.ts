// packages/adapter/src/serialize.ts
import type { AnyStateMachine } from 'xstate'
import type { SerializedMachine, SerializedStateNode, SerializedTransition, SerializedInvoke } from '../../extension/src/shared/types.js'

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
  return transitions.map((t: any) => ({
    eventType: t.eventType ?? '',
    targets: (t.target ?? []).map((n: any) => n?.id ?? String(n)).filter(Boolean),
    guard: serializeGuard(t.guard),
    actions: (t.actions ?? []).map(serializeAction).filter(Boolean),
  }))
}

function serializeInvokes(node: any): SerializedInvoke[] {
  const invokes: any[] = Array.isArray(node.config?.invoke)
    ? node.config.invoke
    : node.config?.invoke
    ? [node.config.invoke]
    : []
  return invokes.map((inv: any) => ({
    id: inv.id ?? '(unknown)',
    src: typeof inv.src === 'string'
      ? inv.src
      : inv.src?.type ?? inv.src?.name ?? String(inv.src ?? '(inline)'),
  }))
}

function serializeNode(node: any): SerializedStateNode {
  const allTransitions: SerializedTransition[] = []
  if (node.transitions instanceof Map) {
    for (const [, tList] of node.transitions) {
      allTransitions.push(...serializeTransitionList(tList))
    }
  }

  const always = Array.isArray(node.always) ? serializeTransitionList(node.always) : []

  return {
    id: node.id,
    key: node.key,
    type: node.type ?? 'atomic',
    initial: node.config?.initial,
    states: Object.fromEntries(
      Object.entries(node.states ?? {}).map(([k, v]) => [k, serializeNode(v)])
    ),
    on: allTransitions,
    always,
    entry: (node.entry ?? []).map(serializeAction).filter(Boolean),
    exit: (node.exit ?? []).map(serializeAction).filter(Boolean),
    invoke: serializeInvokes(node),
  }
}

export function serializeMachine(machine: AnyStateMachine, sourceLocation?: string): SerializedMachine {
  return {
    id: machine.id,
    root: serializeNode(machine.root),
    sourceLocation,
  }
}

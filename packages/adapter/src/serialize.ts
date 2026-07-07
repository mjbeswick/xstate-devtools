// packages/adapter/src/serialize.ts
import type { AnyStateMachine } from 'xstate'
import type { SerializedMachine, SerializedStateNode, SerializedTransition, SerializedInvoke } from '@xstate-devtools/protocol'

// XState v5 higher-order guards (`and`/`or`/`not`) resolve to a named function
// carrying `.check` and `.guards` (an array of the inner guards). Flattening
// them to the bare combinator name drops the actual conditions, so recurse and
// compose a readable label — e.g. `or(not(hasNegativeBasketValue), and(a, b))` —
// mirroring the static parser's guard labels.
function serializeGuard(guard: unknown): string | undefined {
  if (!guard) return undefined
  if (typeof guard === 'string') return guard
  if (typeof guard === 'function') {
    const fn = guard as any
    if (Array.isArray(fn.guards) && typeof fn.check === 'function') {
      const parts = (fn.guards as unknown[]).map(g => serializeGuard(g) ?? '(inline)')
      return `${fn.name || '(combinator)'}(${parts.join(', ')})`
    }
    return fn.name || '(inline)'
  }
  if (typeof guard === 'object') {
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
  return (node.invoke as any[]).map((inv: any) => ({
    id: inv.id ?? '(unknown)',
    src: typeof inv.src === 'string'
      ? inv.src
      : inv.src?.id ?? inv.src?.name ?? '(inline)',
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
    type: node.type,
    initial: node.initial?.target?.[0]?.key,
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

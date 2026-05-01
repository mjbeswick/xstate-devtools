// packages/extension/src/panel/active-nodes.ts
import type { SerializedStateNode } from '../shared/types.js'

type StateValue = string | { [key: string]: StateValue }

export function getActiveNodeIds(
  value: StateValue | null | undefined,
  node: SerializedStateNode
): Set<string> {
  const active = new Set<string>()
  if (!value) return active
  walkNode(value, node, active)
  return active
}

function walkNode(
  value: StateValue,
  node: SerializedStateNode,
  active: Set<string>
): void {
  active.add(node.id)

  if (node.type === 'atomic' || node.type === 'final' || node.type === 'history') return

  if (node.type === 'parallel') {
    const obj = value as Record<string, StateValue>
    for (const [childKey, childValue] of Object.entries(obj)) {
      const childNode = node.states[childKey]
      if (childNode) walkNode(childValue, childNode, active)
    }
    return
  }

  // compound: value is either a string (leaf child) or { childKey: childValue }
  if (typeof value === 'string') {
    const childNode = node.states[value]
    if (childNode) walkNode(value, childNode, active)
  } else {
    const [childKey, childValue] = Object.entries(value as Record<string, StateValue>)[0] ?? []
    if (childKey) {
      const childNode = node.states[childKey]
      if (childNode) walkNode(childValue, childNode, active)
    }
  }
}

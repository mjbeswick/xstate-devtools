// packages/extension/src/panel/active-nodes.ts
import type { SerializedStateNode } from '../shared/types.js'

type StateValue = string | { [key: string]: StateValue }

/**
 * Return one path per active leaf — a single chain for compound states,
 * multiple chains for parallel regions. Each path starts at the root.
 */
export function getActivePaths(
  value: StateValue | null | undefined,
  root: SerializedStateNode,
): SerializedStateNode[][] {
  if (!value) return []
  const out: SerializedStateNode[][] = []
  walkPaths(value, root, [root], out)
  return out
}

function walkPaths(
  value: StateValue,
  node: SerializedStateNode,
  prefix: SerializedStateNode[],
  out: SerializedStateNode[][],
): void {
  if (node.type === 'atomic' || node.type === 'final' || node.type === 'history') {
    out.push(prefix)
    return
  }
  if (node.type === 'parallel') {
    const obj = value as Record<string, StateValue>
    for (const [k, v] of Object.entries(obj)) {
      const child = node.states[k]
      if (child) walkPaths(v, child, [...prefix, child], out)
    }
    return
  }
  // compound
  if (typeof value === 'string') {
    const child = node.states[value]
    if (child) walkPaths(value, child, [...prefix, child], out)
    else out.push(prefix)
  } else {
    const entries = Object.entries(value as Record<string, StateValue>)
    if (entries.length === 0) { out.push(prefix); return }
    for (const [k, v] of entries) {
      const child = node.states[k]
      if (child) walkPaths(v, child, [...prefix, child], out)
    }
  }
}

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

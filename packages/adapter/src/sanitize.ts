// packages/adapter/src/sanitize.ts

const MAX_DEPTH = 10
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 100
// Hard ceiling on total nodes across the whole tree. The per-level caps above
// still allow multiplicative blow-up (100^depth) on wide+deep or cross-linked
// objects, which can produce a string too large for JSON.stringify to handle.
// This bounds the output regardless of shape.
const MAX_NODES = 10000

interface Ctx {
  depth: number
  /** Shared mutable node counter — the global budget. */
  budget: { n: number }
  /** Objects/arrays seen on the current path + elsewhere, to break cycles and DAGs. */
  seen: WeakSet<object>
}

function sanitizeInner(value: unknown, ctx: Ctx): unknown {
  if (ctx.depth > MAX_DEPTH) return '[MaxDepth]'
  if (++ctx.budget.n > MAX_NODES) return '[Truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) + '…' : value
  }
  if (typeof value === 'function') return `[Function: ${value.name || '(anonymous)'}]`
  if (typeof value === 'symbol') return `[Symbol: ${value.description ?? ''}]`
  if (typeof value === 'bigint') return `[BigInt: ${value}]`
  if (value instanceof Error) return { __type: 'Error', name: value.name, message: value.message }
  if (value instanceof Date) return { __type: 'Date', iso: value.toISOString() }
  if (value instanceof RegExp) return { __type: 'RegExp', source: value.source, flags: value.flags }
  if (value instanceof Promise) return '[Promise]'
  if (value instanceof WeakMap || value instanceof WeakSet) return '[WeakCollection]'
  if (ArrayBuffer.isView(value)) return `[TypedArray: ${(value as any).constructor.name}]`
  // Detect DOM nodes (works in browser and is safe to check)
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return `[DOMNode: ${(value as Element).tagName ?? value.nodeName}]`
  }

  // From here on we recurse into containers — guard against shared/circular refs.
  if (ctx.seen.has(value as object)) return '[Circular]'
  ctx.seen.add(value as object)
  const child = { ...ctx, depth: ctx.depth + 1 }

  if (value instanceof Map) {
    const entries: [unknown, unknown][] = []
    for (const [k, v] of value as Map<unknown, unknown>) {
      if (entries.length >= MAX_ARRAY_LENGTH) break
      entries.push([sanitizeInner(k, child), sanitizeInner(v, child)])
    }
    return { __type: 'Map', entries }
  }
  if (value instanceof Set) {
    const values: unknown[] = []
    for (const v of value as Set<unknown>) {
      if (values.length >= MAX_ARRAY_LENGTH) break
      values.push(sanitizeInner(v, child))
    }
    return { __type: 'Set', values }
  }
  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_LENGTH)
    const result = sliced.map((v) => sanitizeInner(v, child))
    if (value.length > MAX_ARRAY_LENGTH) result.push(`[…${value.length - MAX_ARRAY_LENGTH} more]`)
    return result
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    let count = 0
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count++ >= MAX_ARRAY_LENGTH) { result['…'] = '[truncated]'; break }
      result[k] = sanitizeInner(v, child)
    }
    return result
  }
  return String(value)
}

export function sanitize(value: unknown): unknown {
  return sanitizeInner(value, { depth: 0, budget: { n: 0 }, seen: new WeakSet() })
}
